const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Explicit opt-in; never connects to a consumer's configured application database.
test('MongoDB integration: joined filters, pagination, exact total and streamed records', {
  skip: !process.env.TIMETRACK_TEST_MONGODB_URI && !process.env.TIMETRACK_TEST_MEMORY_MONGO
}, async t => {
  const mongoose = require('mongoose')
  let server, connection
  t.after(async () => {
    try {
      if (connection) {
        try { await connection.dropDatabase() } finally { await connection.close() }
      }
    } finally {
      if (server) await server.stop()
    }
  })
  let uri = process.env.TIMETRACK_TEST_MONGODB_URI
  if (!uri) {
    const { MongoMemoryServer } = require('mongodb-memory-server')
    server = await MongoMemoryServer.create()
    uri = server.getUri()
  }
  connection = await mongoose.createConnection(uri, {
    dbName: `timetrack_audit_test_${randomUUID().replaceAll('-', '')}`, serverSelectionTimeoutMS: 5000
  }).asPromise()
  const models = {}
  for (const name of ['Club', 'Track', 'Competition', 'Skater', 'Registry']) {
    const original = require(`../models/${name.toLowerCase()}.model`)
    models[name] = connection.model(name, original.schema)
  }
  const track = await models.Track.create({ name: 'Track' })
  const competition = await models.Competition.create({ name: 'Race', season: '2026', training: false, track: track._id })
  const training = await models.Competition.create({ name: 'Training', season: '2026', training: true, track: track._id })
  const skater = await models.Skater.create({ name: 'Test', lastname: 'Skater', gender: 'M', country: 'ES' })
  await models.Registry.insertMany([
    { skater: skater._id, competition: competition._id, race: '500', country: 'ES', date: '2026-01-01', times: [10] },
    { skater: skater._id, competition: competition._id, race: '500', country: 'ES', date: '2026-01-02', times: [10] },
    { skater: skater._id, competition: training._id, race: '500', country: 'ES', date: '2026-01-03', times: [5] },
    { skater: skater._id, competition: new mongoose.Types.ObjectId(), race: '500', country: 'ES', date: '2026-01-04', times: [1] }
  ])
  const controller = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/external-api.controller.js'), 'utf8'), {
    exports: controller, require: name => name === 'mongoose' ? { model: name => models[name], isValidObjectId: mongoose.isValidObjectId } :
      name.endsWith('registry.model') ? models.Registry : name.endsWith('skater.model') ? models.Skater : require(name)
  })
  const invoke = async (method, body) => {
    let result
    await controller[method]({ body }, { send: value => { result = value } }, error => { throw error })
    return result
  }
  const body = { training: false, gender: 'M', track: String(track._id), season: '2026', page: 2, limit: 1 }
  const page = await invoke('searchRegistries', body)
  assert.equal(page.total, 2)
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].date.toISOString().slice(0, 10), '2026-01-01')
  assert.equal((await invoke('searchRegistries', { ...body, page: 3 })).items.length, 0)
  assert.equal((await invoke('searchRegistries', {})).total, 4)
  const records = await invoke('searchRecords', { training: false, top: '*', bestForSkater: true })
  assert.equal(records.length, 1)
  assert.equal(records[0].date.toISOString().slice(0, 10), '2026-01-02')
  assert.equal(records[0].position, 1)
})
