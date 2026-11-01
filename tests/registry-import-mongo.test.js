const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createRequire } = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('MongoDB import creates tracks, events and clubs with result metadata on Mongoose 9', {
  skip: !process.env.TIMETRACK_TEST_MONGODB_URI
}, async () => {
  const mongoose = require('mongoose')
  const connection = await mongoose.createConnection(process.env.TIMETRACK_TEST_MONGODB_URI, {
    dbName: 'timetrack_import_' + randomUUID().replaceAll('-', ''), serverSelectionTimeoutMS: 5000
  }).asPromise()
  try {
    const models = {}
    for (const name of ['Category', 'Club', 'Track', 'Competition', 'Skater', 'Registry']) {
      const original = require('../models/' + name.toLowerCase() + '.model')
      models[name] = connection.model(name, original.schema)
    }
    await Promise.all(Object.values(models).map(model => model.init()))
    await models.Category.create({ name: 'Senior' })
    const file = path.resolve(__dirname, '../controllers/registry-import.controller.js')
    const native = createRequire(file)
    const controller = {}
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      exports: controller, console, __corePath: path.resolve(__dirname, '../../core'),
      require: name => {
        if (name.startsWith('../models/')) {
          const key = path.basename(name).split('.')[0]
          return models[key[0].toUpperCase() + key.slice(1)]
        }
        if (name.endsWith('authorization')) return { getPermissionsForEntity: async () => ['C', 'R', 'U', 'D'] }
        if (name.endsWith('data.filter')) return { getFilter: (_entity, filter) => filter }
        if (name.endsWith('i18n.config')) return { getLocale: () => 'es' }
        return native(name)
      }
    }, { filename: file })
    const rows = ['2026-06-30', '2026-07-01'].map((date, index) => ({
      skaterName: index ? 'Second Skater' : 'First Skater', gender: 'F', country: 'ES', date,
      race: '500m', distance: 500, times: [41032], totalTime: 41032, rail: 'I',
      category: 'Senior', clubName: 'Audit club', competitionName: 'Audit event', trackName: 'Audit rink'
    }))
    const req = { user: { _id: 'audit', roles: ['admin'] }, params: {},
      body: { format: 'fixture', createSkaters: 'true' },
      files: { file: { name: 'fixture.xlsx', size: 10, data: Buffer.from('fixture') } },
      app: { locals: { registryImportSeasonStartMonth: 7,
        registryImportFormats: [{ id: 'fixture', extensions: ['.xlsx'], parse: async () => rows }] } }
    }
    const response = () => ({ statusCode: 200, __: value => value,
      status(code) { this.statusCode = code; return this }, send(body) { this.body = body; return this } })
    const preview = response()
    await controller.preview(req, preview, error => { throw error })
    assert.ok(preview.body.token, JSON.stringify(preview.body))
    req.body = { token: preview.body.token, choices: rows.map(() => ({ action: 'import', skaterId: 'new' })) }
    const result = response()
    await controller.commit(req, result, error => { throw error })
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.failed.length, 0, JSON.stringify(result.body))
    assert.equal(result.body.imported.length, 2)
    assert.equal(result.body.createdTracks.length, 1)
    assert.equal(result.body.createdEvents.length, 2)
    assert.equal(result.body.createdClubs.length, 1)
    assert.equal(await models.Track.countDocuments(), 1)
    assert.equal(await models.Club.countDocuments(), 1)
    assert.equal(await models.Skater.countDocuments(), 2)
    assert.equal(await models.Registry.countDocuments(), 2)
    assert.deepEqual((await models.Competition.distinct('season')).sort(), ['2025-2026', '2026-2027'])

    req.body = { format: 'fixture', createSkaters: 'false' }
    const again = response()
    await controller.preview(req, again, error => { throw error })
    req.body = { token: again.body.token, choices: rows.map(() => ({ action: 'import' })) }
    const duplicates = response()
    await controller.commit(req, duplicates, error => { throw error })
    assert.equal(duplicates.statusCode, 409)
    assert.equal(duplicates.body.code, 'IMPORT_DUPLICATE_REVIEW')
    assert.equal(await models.Registry.countDocuments(), 2)
  } finally {
    await connection.dropDatabase()
    await connection.close()
  }
})
