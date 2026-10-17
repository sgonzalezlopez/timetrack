const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { normalize, candidatesFor, validateRow, completeRow } = require('../utils/registry-import')

const row = () => ({
    skaterName: 'Ona Rodríguez Cornejo', gender: 'F', date: '2026-10-17',
    race: 'Vrouwen 500 meter', distance: 500, times: [11148, 29884], totalTime: 41032,
    category: 'LA2', clubName: 'RFEDH', source: 'netherlands', externalReference: 'source-row-1'
})

test('normalizes accents, punctuation, whitespace and name order, respecting gender', () => {
    assert.equal(normalize('  RODRÍGUEZ,  Ona '), 'rodriguez ona')
    const skaters = [
        { _id: 'f', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F' },
        { _id: 'm', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'M' }
    ]
    assert.deepEqual(candidatesFor({ ...row(), skaterName: 'CORNEJO Rodríguez, Ona' }, skaters),
        { candidates: [skaters[0]], automatic: true })
    assert.equal(candidatesFor(row(), [...skaters, { ...skaters[0], _id: 'other' }]).automatic, false)
    const relaxed = candidatesFor({ ...row(), skaterName: 'Ona Rodríguez' }, skaters)
    assert.equal(relaxed.candidates.length, 1)
    assert.equal(relaxed.automatic, false)
})

test('validates times, dates, names and distances without inventing zero times', () => {
    assert.equal(validateRow(row()), null)
    assert.equal(validateRow({ ...row(), times: [11148, 29883], totalTime: 42000 }), 'IMPORT_INVALID_TIMES')
    assert.equal(validateRow({ ...row(), times: [0] }), 'IMPORT_INVALID_TIMES')
    assert.equal(validateRow({ ...row(), date: '' }), 'IMPORT_INVALID_DATE')
    assert.equal(validateRow({ ...row(), distance: NaN }), 'IMPORT_INVALID_RACE')
    assert.equal(validateRow({ ...row(), gender: '' }), 'IMPORT_INVALID_SKATER')
})

function harness(input, options = {}) {
    const writes = [], records = options.records || []
    const skaters = options.skaters || [{ _id: 'skater-1', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F' }]
    const categories = [{ name: 'LA2' }, { name: 'Other' }]
    const club = { _id: 'club-1', name: options.unknownClub ? 'UNKNOWN' : 'RFEDH' }
    const models = {
        '../models/registry.model': {
            find: async query => records.filter(r => r.source === query.source && r.externalReference === query.externalReference),
            create: async values => { writes.push(['registry', values]); records.push({ ...values, _id: 'new-registry' }) },
            findOneAndUpdate: async (query, values) => { writes.push(['replace', values.$set]); return values.$set }
        },
        '../models/competition.model': {
            findById: async () => ({ _id: 'event-1', name: 'Holland Cup 1' }),
            exists: async () => true
        },
        '../models/skater.model': {
            find: async () => skaters, exists: async () => true,
            create: async values => { writes.push(['skater', values]); return { ...values, _id: 'created-skater' } }
        },
        '../models/club.model': {
            find: async () => [club], exists: async () => true,
            findOneAndUpdate: async () => { writes.push(['club']); return club }
        },
        '../models/category.model': { find: async () => categories },
        '../middlewares/data.filter': { getFilter: (_entity, query) => query },
        '../utils/registry-import': { normalize, candidatesFor, validateRow, completeRow }
    }
    const exports = {}
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/registry-import.controller.js'), 'utf8'), {
        exports, __corePath: 'core', console,
        require: name => models[name] || (name.endsWith('authorization') ?
            { getPermissionsForEntity: async entity => options.permissions && options.permissions[entity] || ['C', 'R', 'U'] } : require(name))
    })
    const req = {
        user: { id: 'user-1' }, params: { id: 'event-1' },
        body: { format: 'test', createSkaters: options.createSkaters ? 'true' : 'false' },
        files: { file: { name: 'test.xlsx', size: 100, data: Buffer.from('test') } },
        app: { locals: { registryImportFormats: [{ id: 'test', label: 'Test', extensions: ['.xlsx'], parse: async () => input }] } }
    }
    let result, status
    const res = { __: s => s, status: n => { status = n; return res }, send: value => { result = value; return res } }
    const next = err => { throw err }
    return {
        writes, req,
        preview: async () => { await exports.preview(req, res, next); return { result, status } },
        commit: async (token, choices) => {
            result = undefined; status = undefined
            req.body = { token, choices }
            await exports.commit(req, res, next)
            return { result, status }
        }
    }
}

test('preview performs no writes and commit imports selected event; token cannot be replayed', async () => {
    const h = harness([row()])
    const { result: preview } = await h.preview()
    assert.equal(h.writes.length, 0)
    assert.equal(preview.rows[0].automaticSkater, 'skater-1')
    const choices = [{ action: 'import', skaterId: 'skater-1', category: 'LA2' }]
    const { result: report } = await h.commit(preview.token, choices)
    assert.equal(report.imported.length, 1)
    assert.equal(h.writes[0][1].competition, 'event-1')
    assert.deepEqual(Array.from(h.writes[0][1].times), [11148, 29884])
    assert.equal((await h.commit(preview.token, choices)).status, 409)
})

test('unknown categories require explicit valid selection before any writes', async () => {
    const h = harness([{ ...row(), category: 'Missing' }])
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].category, null)
    const choices = [{ action: 'import', skaterId: 'skater-1' }]
    assert.equal((await h.commit(preview.token, choices)).status, 400)
    assert.equal(h.writes.length, 0)
    choices[0].category = 'Other'
    const { result } = await h.commit(preview.token, choices)
    assert.equal(result.imported[0].categorySubstituted, true)
    assert.equal(h.writes[0][1].category, 'Other')
})

test('ambiguous names require selection; unknown club uses UNKNOWN; new skater is reused', async () => {
    const h = harness([row(), { ...row(), externalReference: 'source-row-2' }], {
        skaters: [], createSkaters: true, unknownClub: true
    })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].unknownClub, true)
    const choices = preview.rows.map(() => ({ action: 'import', skaterId: 'new', category: 'LA2' }))
    const { result } = await h.commit(preview.token, choices)
    assert.equal(result.createdSkaters.length, 1)
    assert.equal(result.imported.length, 2)
    assert.equal(h.writes.filter(w => w[0] === 'skater').length, 1)
    assert.equal(h.writes.find(w => w[0] === 'skater')[1].name, 'Ona')
    assert.equal(h.writes.find(w => w[0] === 'skater')[1].lastname, 'Rodríguez Cornejo')

    const ambiguous = harness([row()], { skaters: [
        { _id: 'a', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F' },
        { _id: 'b', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F' }
    ] })
    const { result: p } = await ambiguous.preview()
    assert.equal(p.rows[0].automaticSkater, null)
    assert.equal((await ambiguous.commit(p.token, [{ action: 'import', category: 'LA2' }])).status, 400)
    assert.equal(ambiguous.writes.length, 0)
})

test('duplicates are never inserted or overwritten without explicit replace', async () => {
    const record = { _id: 'existing', competition: 'event-1', source: 'netherlands', externalReference: 'source-row-1' }
    const h = harness([row()], { records: [record] })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].duplicate, true)
    assert.equal((await h.commit(preview.token, [{ action: 'import', category: 'LA2' }])).status, 400)
    assert.equal(h.writes.length, 0)
    const { result } = await h.commit(preview.token, [{ action: 'replace', category: 'LA2' }])
    assert.equal(result.imported[0].replaced, true)
    assert.equal(h.writes[0][0], 'replace')
})

test('special results are skipped and source-less formats warn without inventing metadata', async () => {
    const h = harness([{ ...row(), team: true }, { ...row(), status: 'DQ' },
        { ...row(), status: '', source: undefined, externalReference: undefined }])
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].issue, 'IMPORT_SPECIAL_RESULT')
    assert.equal(preview.rows[1].issue, 'IMPORT_SPECIAL_RESULT')
    assert.ok(preview.rows[2].warnings.includes('IMPORT_NO_REFERENCE'))
    const { result } = await h.commit(preview.token, [
        { action: 'skip' }, { action: 'skip' }, { action: 'import', category: 'LA2' }
    ])
    assert.equal(result.skipped.length, 2)
    assert.equal(result.imported.length, 1)
})

test('review belongs to its user, rejects forged skaters and enforces creation permission', async () => {
    const h = harness([row()])
    const { result: preview } = await h.preview()
    const choices = [{ action: 'import', skaterId: 'foreign-skater', category: 'LA2' }]
    // Automatic exact matches are authoritative, so test a nonautomatic match separately.
    h.req.user.id = 'other-user'
    assert.equal((await h.commit(preview.token, choices)).status, 409)
    assert.equal(h.writes.length, 0)
    const missing = harness([row()], { skaters: [] })
    const { result: p } = await missing.preview()
    assert.equal((await missing.commit(p.token, choices)).status, 400)
    assert.equal(missing.writes.length, 0)
    const forbidden = harness([row()], { createSkaters: true, permissions: { skater: ['R'] } })
    assert.equal((await forbidden.preview()).status, 403)
    assert.equal(forbidden.writes.length, 0)
})

test('duplicates belonging to another event cannot be overwritten', async () => {
    const h = harness([row()], { records: [{
        _id: 'existing', competition: 'another-event', source: 'netherlands', externalReference: 'source-row-1'
    }] })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].duplicateId, null)
    assert.equal((await h.commit(preview.token, [{ action: 'replace', category: 'LA2' }])).status, 400)
    assert.equal(h.writes.length, 0)
})

test('missing date and distance are requested per row, never inherited, and validated before writes', async () => {
    const incomplete = { ...row(), date: null, distance: null, requiredInputs: ['date', 'distance'] }
    const h = harness([incomplete, { ...incomplete, externalReference: 'source-row-2' }])
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].issue, null)
    assert.deepEqual(Array.from(preview.rows[0].requiredInputs), ['date', 'distance'])
    assert.equal(preview.rows[1].date, null)
    assert.equal(preview.rows[1].distance, null)
    const choices = [
        { action: 'import', category: 'LA2', date: '2026-05-16', distance: '365' },
        { action: 'import', category: 'LA2' }
    ]
    assert.equal((await h.commit(preview.token, choices)).status, 400)
    assert.equal(h.writes.length, 0)
    choices[1].date = '2026-05-17'
    choices[1].distance = '400'
    const { result: report } = await h.commit(preview.token, choices)
    assert.equal(report.imported.length, 2)
    const values = h.writes.filter(w => w[0] === 'registry').map(w => w[1])
    assert.equal(values[0].date, '2026-05-16')
    assert.equal(values[0].distance, 365)
    assert.equal(values[1].date, '2026-05-17')
    assert.equal(values[1].distance, 400)
})

test('published fields cannot be replaced by review inputs; missing and invalid inputs are rejected', () => {
    const original = row()
    assert.deepEqual(completeRow(original, { date: '2000-01-01', distance: 1 }), original)
    const incomplete = { ...original, date: null, distance: null, requiredInputs: ['date', 'distance'] }
    for (const date of ['', '2026-02-30', '2026-05-16T00:00:00Z', 'invalid']) {
        assert.equal(validateRow(completeRow(incomplete, { date, distance: '365' })), 'IMPORT_INVALID_DATE')
    }
    for (const distance of ['', '0', '-1', 'invalid', 'Infinity']) {
        assert.equal(validateRow(completeRow(incomplete, { date: '2026-05-16', distance })), 'IMPORT_INVALID_RACE')
    }
})

test('untimed PDF results stay in the report even when date and distance are missing', async () => {
    const h = harness([{
        ...row(), date: null, distance: null, times: [], totalTime: null, rail: '',
        requiredInputs: ['date', 'distance'], sourceLocation: 'PDF 2 / 21'
    }])
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].issue, 'IMPORT_MISSING_TIMES')
    const { result } = await h.commit(preview.token, [{ action: 'import' }])
    assert.equal(result.skipped[0].reason, 'IMPORT_MISSING_TIMES')
    assert.equal(result.skipped[0].row, 'PDF 2 / 21')
    assert.equal(h.writes.length, 0)
})
