const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')

function harness(raw = []) {
  const calls = []
  const model = {
    find(filter) {
      const state = { filter, skip: 0, limit: Infinity }
      calls.push(state)
      const items = () => raw.filter(item => !filter._id || filter._id.$in.includes(item._id))
        .slice(state.skip, state.skip + state.limit).map(item => ({ ...item, toObject: () => ({ ...item }) }))
      const chain = {
        select() { return chain }, populate() { return chain }, sort(value) { state.sort = value; return chain },
        skip(value) { state.skip = value; return chain }, limit(value) { state.limit = value; return chain },
        maxTimeMS() { return chain }, cast() { return filter },
        then(resolve, reject) { return Promise.resolve(items()).then(resolve, reject) },
        cursor() { state.cursor = true; return (async function* () { yield* items() })() }
      }
      return chain
    },
    countDocuments: () => { calls.push({ count: true }); return { maxTimeMS: async () => raw.length } },
    aggregate(pipeline) {
      calls.push({ pipeline })
      return { option: async () => [{ items: raw.slice(1, 2).map(item => ({ _id: item._id })), count: [{ total: 2 }] }] }
    },
    collection: { name: 'related' }
  }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/external-api.controller.js'), 'utf8'), {
    exports, require: name => name === 'mongoose' ? { isValidObjectId: () => true, model: () => model } :
      name.endsWith('.model') ? model : require(name)
  })
  return { controller: exports, calls }
}

async function invoke(controller, method, body) {
  const result = { status: 200 }
  const res = { status(value) { result.status = value; return res }, send(value) { result.body = value; return res } }
  await controller[method]({ body }, res, error => { throw error })
  return result
}

function mark(id, skater, time, extra = {}) {
  return { _id: id, race: '500', country: 'ES', times: [time],
    skater: { _id: skater, gender: 'M' }, competition: { season: '2026', track: { name: 'Track' } }, ...extra }
}

test('registry pagination executes skip/limit and exact count without loading all documents', async () => {
  const h = harness([mark('a', 'a', 1), mark('b', 'b', 2), mark('c', 'c', 3)])
  const result = await invoke(h.controller, 'searchRegistries', { page: 2, limit: 1 })
  assert.equal(result.body.total, 3)
  assert.equal(result.body.items[0]._id, 'b')
  assert.equal(h.calls[0].skip, 1)
  assert.equal(h.calls[0].limit, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].sort)), { date: -1, _id: -1 })
  assert.ok(h.calls.some(call => call.count))
})

test('populate filters are joined before facet pagination and exact count, then only page IDs are hydrated', async () => {
  const h = harness([mark('a', 'a', 1), mark('b', 'b', 2)])
  const result = await invoke(h.controller, 'searchRegistries', { training: false, gender: 'M', page: 2, limit: 1 })
  assert.equal(result.body.total, 2)
  assert.equal(result.body.items[0]._id, 'b')
  const pipeline = h.calls.find(call => call.pipeline).pipeline
  assert.equal(pipeline.filter(stage => stage.$lookup).length, 2)
  const facet = pipeline.at(-1).$facet
  assert.equal(facet.items[1].$skip, 1)
  assert.equal(facet.count[0].$count, 'total')
  assert.equal(h.calls.at(-1).filter._id.$in[0], 'b')
})

test('invalid pagination, booleans, filters and calendar dates return 400', async () => {
  for (const body of [{ page: '2x' }, { page: 0 }, { page: 1.5 }, { limit: -1 }, { limit: null },
    { limit: [] }, { country: {} }, { country: 'ZZ' }, { skater: 'bad' }, { race: true },
    { distance: true }, { distance: -2 }, { dateFrom: '2026-02-30' }, { dateFrom: 123 },
    { dateFrom: '2026-10-01', dateTo: '2026-01-01' }, { training: 'yes' }]) {
    assert.equal((await invoke(harness().controller, 'searchRegistries', body)).status, 400, JSON.stringify(body))
  }
  for (const body of [{ top: '-1' }, { top: '1x' }, { top: 0 }, { groupBy: 'invalid' },
    { bestForSkater: 'yes' }, { limit: 'bad' }]) {
    assert.equal((await invoke(harness().controller, 'searchRecords', body)).status, 400)
  }
  assert.equal((await invoke(harness().controller, 'searchSkaters', { active: 'yes' })).status, 400)
})

test('streamed records preserve original best-per-skater insertion order for ties and positions', async () => {
  const rows = [mark('a-slow', 'a', 50), mark('b', 'b', 10), mark('a-fast', 'a', 10),
    mark('a-tie', 'a', 10), mark('c', 'c', 9), mark('foreign', 'd', 5, { country: 'FR' })]
  const h = harness(rows)
  const result = await invoke(h.controller, 'searchRecords', { top: 2, bestForSkater: true, groupBy: 'country' })
  assert.deepEqual(Array.from(result.body, item => [item._id, item.position]), [['c', 1], ['a-fast', 2], ['foreign', 1]])
  assert.ok(h.calls.some(call => call.cursor))
  const all = await invoke(harness(rows).controller, 'searchRecords', { top: '*', bestForSkater: false })
  assert.deepEqual(Array.from(all.body, item => item._id), ['foreign', 'c', 'b', 'a-fast', 'a-tie', 'a-slow'])
})

function authHarness() {
  const env = { EXTERNAL_API_KEY: 'current', EXTERNAL_API_PREVIOUS_KEYS: 'previous', EXTERNAL_API_RATE_LIMIT: '3' }
  const module = { exports: {} }
  let now = 0
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../middlewares/external-api-auth.js'), 'utf8'), {
    module, require, process: { env }, Date: { now: () => now }
  })
  return { auth: module.exports, env, advance: () => { now += 60001 } }
}

test('bounded records agree with the previous algorithm across groups, ties and repeated skaters', async () => {
  let seed = 37
  const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n }
  const rows = Array.from({ length: 700 }, (_, i) => mark(String(i), String(random(40)), random(15), {
    country: ['ES', 'FR'][random(2)], race: ['500', '1000'][random(2)]
  }))
  for (const bestForSkater of [false, true]) for (const top of [1, 3, 20, '*']) {
    const groups = new Map()
    for (const item of rows) {
      const key = [item.country, item.race, item.skater.gender].join('|')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    const expected = []
    for (const group of groups.values()) {
      const best = new Map()
      for (const item of group) {
        const previous = best.get(item.skater._id)
        if (!previous || item.times[0] < previous.times[0]) best.set(item.skater._id, item)
      }
      const candidates = bestForSkater ? [...best.values()] : group
      candidates.sort((a, b) => a.times[0] - b.times[0]).slice(0, top === '*' ? 500 : top)
        .forEach((item, i) => expected.push([item._id, i + 1]))
    }
    const result = await invoke(harness(rows).controller, 'searchRecords', { bestForSkater, top, groupBy: 'country' })
    assert.deepEqual(Array.from(result.body, item => [item._id, item.position]), expected)
  }
})

test('Bearer rotation, malformed credentials, rate limiting and window expiry', () => {
  const h = authHarness()
  const request = header => {
    let status = 200, passed = false, retry
    const res = { status(value) { status = value; return res }, send() {}, set(_name, value) { retry = value } }
    h.auth({ get: () => header, ip: 'client' }, res, () => { passed = true })
    return { status, passed, retry }
  }
  assert.equal(request('Bearer previous').passed, true)
  assert.equal(request('bearer current').passed, true)
  assert.equal(request('Bearer wrong').status, 401)
  assert.equal(request('Bearer current').status, 429)
  h.advance()
  assert.equal(request('Bearer current extra').status, 401)
  h.env.EXTERNAL_API_PREVIOUS_KEYS = ''
  assert.equal(request('Bearer previous').status, 401)
  delete h.env.EXTERNAL_API_KEY
  assert.equal(request('Bearer current').status, 503)
})

test('HTTP integration: authentication, validation, successful registry response and missing static 404', async t => {
  const express = require('express')
  const app = express()
  const authContext = authHarness()
  authContext.env.EXTERNAL_API_RATE_LIMIT = '100'
  const { auth } = authContext
  const { controller } = harness([mark('a', 'a', 10)])
  app.use(express.json({ limit: '32kb' }))
  const routeModule = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/external.route.js'), 'utf8'), {
    module: routeModule, require: name => name === 'express' ? express :
      name.endsWith('external-api-auth') ? auth : controller
  })
  app.use('/api/v1', routeModule.exports)
  app.get('/person/name.with.dot', (_req, res) => res.send('route'))
  app.use(require('../middlewares/missing-static'))
  app.use((error, _req, res, _next) => res.status(500).send({ message: error.message }))
  const server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  let response = await fetch(`${url}/api/v1/registries/search`, { method: 'POST' })
  assert.equal(response.status, 401)
  response = await fetch(`${url}/api/v1/registries/search`, { method: 'POST',
    headers: { authorization: 'Bearer current', 'content-type': 'application/json' }, body: '{"page":0}' })
  assert.equal(response.status, 400)
  response = await fetch(`${url}/api/v1/registries/search`, { method: 'POST',
    headers: { authorization: 'Bearer current', 'content-type': 'application/json' }, body: '{}' })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).total, 1)
  response = await fetch(`${url}/api/v1/records/search`, { method: 'POST',
    headers: { authorization: 'Bearer previous', 'content-type': 'application/json' }, body: '{"top":"*"}' })
  assert.equal(response.status, 200)
  assert.equal((await response.json())[0].position, 1)
  assert.equal((await fetch(`${url}/missing.css`)).status, 404)
  assert.equal(await (await fetch(`${url}/person/name.with.dot`)).text(), 'route')
})
