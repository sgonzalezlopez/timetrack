const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function load(name, { model = {}, geocoder = {}, registry = {}, category = {}, skater = {}, competition = {}, fetch } = {}) {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers', name + '.controller.js'), 'utf8'), {
    exports, console: { error() {} }, fetch,
    require: id => {
      if (id === '../models/' + name + '.model') return model
      if (id === '../models/category.model') return category
      if (id === '../models/skater.model') return skater
      if (id === '../models/competition.model') return competition
      if (id === './registry.controller') return registry
      if (id === '../models/registry.model') return registry
      if (id === '../middlewares/data.filter') return { getFilter: (_entity, filter) => filter }
      if (id === '../utils/geocoder') return geocoder
      if (id === 'exceljs' || id === 'mongoose') return {}
      throw new Error('Unexpected dependency: ' + id)
    }
  })
  return exports
}

const request = () => ({ body: { name: 'example', filter: { name: 'example' }, update: { name: 'updated' } }, params: { id: 'id', reg: 'registry', heat: '1', skaterId: 'skater' }, user: {} })
const noResponse = { send() { assert.fail('must not send after failure') }, status() { assert.fail('must forward to Express') }, __: text => text }
function rejectedQuery(error) {
  const query = { populate() { return query }, then(resolve, reject) {
    // A detached old-style .then() stays inert; await observes the rejection.
    return reject ? Promise.reject(error).then(resolve, reject) : query
  } }
  return query
}
function database(result) {
  return Object.fromEntries(['find', 'findById', 'findOne', 'create', 'findOneAndUpdate', 'deleteOne', 'updateMany'].map(method => [method, () => result]))
}
async function forwards(handler, req, failure) {
  const errors = []
  await handler(req, noResponse, error => errors.push(error))
  assert.deepEqual(errors, [failure], 'must forward the original error exactly once')
}

for (const name of ['skater', 'club', 'competition', 'track', 'coach', 'category', 'trainingsession']) {
  const methods = ['getAll', 'get', 'create', 'update', 'delete', 'find']
  if (name === 'skater') methods.push('updateMany')
  if (name === 'trainingsession') methods.push('getInputs', 'getSkaterInputs', 'getRegistries')
  for (const method of methods) {
    test('database rejection: ' + name + '.' + method, async () => {
      const failure = new Error('database unavailable')
      await forwards(load(name, { model: database(rejectedQuery(failure)) })[method], request(), failure)
    })
  }
  test('synchronous database errors reach Express: ' + name, async () => {
    const failure = new Error('invalid database query')
    await forwards(load(name, { model: { find() { throw failure } } }).getAll, request(), failure)
  })
}

for (const name of ['skater', 'competition', 'track', 'trainingsession']) {
  for (const method of ['getRegistries', 'deleteRegistry']) {
    test('registry delegation forwards next and rejected promises: ' + name + '.' + method, async () => {
      const failure = new Error('registry failure')
      const session = { competition: 'competition', race: 'race' }
      const query = Promise.resolve(name === 'track' ? [{ _id: 'competition' }] : session)
      const registry = Object.fromEntries(['find', 'delete'].map(action => [action, async (req, res, next) => {
        assert.equal(typeof next, 'function')
        throw failure
      }]))
      await forwards(load(name, { model: database(query), competition: database(query), registry })[method], request(), failure)
    })
  }
}

test('track competition lookup rejection reaches Express', async () => {
  const failure = new Error('competition query failed')
  await forwards(load('track', { competition: database(rejectedQuery(failure)) }).getRegistries, request(), failure)
})

test('skater invalid search regex reaches Express synchronously', async () => {
  const errors = []
  const req = request()
  req.body.name = '['
  await load('skater').find(req, noResponse, error => errors.push(error))
  assert.equal(errors.length, 1)
  assert.equal(errors[0].name, 'SyntaxError')
})

for (const name of ['club', 'skater', 'trainingsession']) {
  test('empty get responds once: ' + name, async () => {
    const query = { populate() { return query }, then: resolve => Promise.resolve([]).then(resolve) }
    const sent = []
    await load(name, { model: database(query) }).get(request(), { send: value => sent.push(value) }, assert.fail)
    assert.deepEqual(sent, [null])
  })
}

test('track creation forwards geocoder rejection', async () => {
  const failure = new Error('geocoder unavailable')
  const req = request()
  req.body.location = 'Rivas'
  await forwards(load('track', { geocoder: { async geocode() { throw failure } } }).create, req, failure)
})

for (const step of ['update', 'fetch', 'json', 'geocode', 'save']) {
  test('track update forwards nested rejection: ' + step, async () => {
    const failure = new Error(step + ' failed')
    const item = { location: 'old', async save() { if (step === 'save') throw failure; return item } }
    const model = { async findOne() { return item }, async findOneAndUpdate() { if (step === 'update') throw failure; return item } }
    const geocoder = { async geocode() { if (step === 'geocode') throw failure; return [{}] } }
    const fetch = async () => { if (step === 'fetch') throw failure; return { async json() { if (step === 'json') throw failure; return { display_name: 'Rivas' } } } }
    const req = request()
    req.body.lat = '40'
    req.body.lng = '-3'
    await forwards(load('track', { model, geocoder, fetch }).update, req, failure)
  })
}

test('track location-only update awaits save and forwards failure', async () => {
  const failure = new Error('save failed')
  const item = { location: 'old', async save() { throw failure } }
  const req = request()
  req.body.location = 'new'
  await forwards(load('track', { model: { async findOne() { return item }, async findOneAndUpdate() { return item } }, geocoder: { async geocode() { return [{}] } } }).update, req, failure)
})

test('HTTP database failure returns 500 and the server continues serving', async t => {
  const express = require('express')
  const app = express()
  const failure = new Error('database unavailable')
  const query = { populate() { return query }, then(resolve, reject) { return Promise.reject(failure).then(resolve, reject) } }
  const controller = load('skater', { model: { find() { return query } } })
  const errors = []
  app.get('/skaters', controller.getAll)
  app.get('/health', (req, res) => res.send('ok'))
  app.use((error, req, res, next) => { errors.push(error); res.status(500).json({ message: 'Database unavailable' }) })
  const server = app.listen(0, '127.0.0.1')
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise(resolve => server.once('listening', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  assert.equal((await globalThis.fetch(base + '/skaters')).status, 500)
  assert.deepEqual(errors, [failure])
  const healthy = await globalThis.fetch(base + '/health')
  assert.equal(healthy.status, 200)
  assert.equal(await healthy.text(), 'ok')
})

for (const name of ['skater', 'club', 'competition', 'track', 'coach', 'category', 'trainingsession']) {
  test('successful CRUD responses remain unchanged: ' + name, async () => {
    const item = { _id: 'id', name: 'example', location: 'Rivas' }
    for (const method of ['getAll', 'get', 'create', 'update', 'delete', 'find']) {
      const arrayResult = ['getAll', 'find'].includes(method) || method === 'get' && ['skater', 'club', 'trainingsession'].includes(name)
      const result = arrayResult ? [item] : item
      const query = { populate() { return query }, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }
      const sent = []
      await load(name, { model: database(query) })[method](request(), { send: value => sent.push(value) }, assert.fail)
      assert.equal(sent.length, 1, method)
      if (method === 'delete') assert.equal(sent[0].message, 'OK')
      else assert.equal(sent[0], ['getAll', 'find'].includes(method) ? result : item, method)
    }
  })
}

for (const method of ['getInputs', 'getRegistries']) {
  test('missing training session forwards once: ' + method, async () => {
    const query = { populate() { return query }, then: (resolve, reject) => Promise.resolve(null).then(resolve, reject) }
    const errors = []
    await load('trainingsession', { model: database(query) })[method](request(), noResponse, error => errors.push(error))
    assert.equal(errors.length, 1)
    assert.equal(errors[0].message, 'ITEM_NOT_FOUND')
  })
}

for (const method of ['getInputs', 'getSkaterInputs']) {
  test('training registry query rejection reaches Express: ' + method, async () => {
    const failure = new Error('registry lookup unavailable')
    const session = { competition: { track: { distance: 200 } }, skaters: [{ id: 'skater' }], distance: 400, partialsPerLap: 1 }
    const query = { populate() { return query }, then: (resolve, reject) => Promise.resolve(session).then(resolve, reject) }
    await forwards(load('trainingsession', { model: database(query), registry: database(rejectedQuery(failure)), skater: { async findById() { return { id: 'skater' } } } })[method], request(), failure)
  })
}
