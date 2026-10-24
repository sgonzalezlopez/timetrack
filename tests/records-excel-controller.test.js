const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function harness({ file = true, filters = '{"top":"3","bestForSkater":"true","season":"2026-2027","groupBy":"none"}',
    failure, issues, queryFailure, categories = false, allround = false, empty = false } = {}) {
    const calls = [], exports = {}
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/records-excel.controller.js'), 'utf8'), {
        exports, Buffer, console,
        require: name => name === './registry.controller' ? {
            getRecords: async req => {
                calls.push({ query: req.body, user: req.user })
                if (queryFailure) throw new Error('database failed')
                return empty ? [] : [{ id: 'filtered' }]
            }
        } : {
            updateRecordsExcel: async (buffer, records, options) => {
                calls.push({ buffer, records, options })
                if (failure) throw Object.assign(new Error(failure), { issues })
                return { buffer: Buffer.from('updated'), count: 1, groups: 1 }
            },
            updateCategoriesExcel: async (buffer, records, options) => {
                calls.push({ buffer, records, options, categories: true })
                if (failure) throw new Error(failure)
                return { buffer: Buffer.from('categories'), count: 2, groups: 7 }
            },
            updateAllroundExcel: async (buffer, records, options) => {
                calls.push({ buffer, records, options, allround: true })
                if (failure) throw Object.assign(new Error(failure), { issues })
                return { buffer: Buffer.from('allround'), count: 2, groups: 2 }
            }
        }
    })
    let status = 200, body, nextError
    const headers = {}
    const req = { user: { id: 'user-1' }, body: { filters },
        app: { locals: { registryImportSeasonStartMonth: 7 } },
        files: file ? { file: { name: 'Marcas.xlsx', size: 100, data: Buffer.from('original') } } : {} }
    const res = { __: value => value, status: value => { status = value; return res },
        set: (key, value) => { headers[key] = value }, send: value => { body = value } }
    return { calls, req, run: async () => {
        await (allround ? exports.updateAllround : categories ? exports.updateCategories : exports.update)(req, res, err => { nextError = err })
        return { status, body, headers, nextError }
    } }
}

test('Excel endpoint queries current filters and authenticated user instead of trusting client result rows', async () => {
    const h = harness()
    const result = await h.run()
    assert.equal(result.status, 200)
    assert.equal(result.body.toString(), 'updated')
    assert.equal(h.calls[0].query.top, '3')
    assert.equal(h.calls[0].query.bestForSkater, 'true')
    assert.equal(h.calls[0].query.season, '2026-2027')
    assert.equal(h.calls[0].user.id, 'user-1')
    assert.equal(h.calls[1].records[0].id, 'filtered')
    assert.equal(h.calls[1].options.seasonStartMonth, 7)
    assert.equal(result.headers['X-Records-Count'], '1')
})

test('category endpoint ignores submitted filters and uses all Spanish non-training results', async () => {
    const h = harness({ categories: true, filters: '{"country":"FRA","top":"1","category":["LA2"],"season":"2000"}' })
    const result = await h.run()
    assert.equal(result.status, 200)
    assert.equal(result.body.toString(), 'categories')
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].query)), {
        top: '*', bestForSkater: 'false', groupBy: 'none', country: ['ES', 'ESP'], training: 'false'
    })

    assert.equal(h.calls[1].categories, true)
    assert.equal(h.calls[1].options.seasonStartMonth, 7)
})

test('allround endpoint ignores all submitted filters and uses historical Spanish non-training results', async () => {
    const h = harness({ allround: true, filters: 'invalid and ignored' })
    const result = await h.run()
    assert.equal(result.body.toString(), 'allround')
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].query)), {
        top: '*', bestForSkater: 'false', groupBy: 'none', country: ['ES', 'ESP'], training: 'false'
    })
    assert.equal(h.calls[1].allround, true)
})

test('allround without eligible results returns an explicit error rather than a workbook', async () => {
    const result = await harness({ allround: true, failure: 'RECORDS_ALLROUND_EMPTY' }).run()
    assert.equal(result.status, 400)
    assert.equal(result.body.message, 'RECORDS_ALLROUND_EMPTY')
    assert.equal(result.headers['Content-Type'], undefined)
})

test('country-filtered Excel updates never erase workbooks when no historical nationality qualifies', async () => {
    for (const options of [{ categories: true }, { allround: true }, { filters: '{"country":"ES"}' }]) {
        const h = harness({ ...options, empty: true })
        const result = await h.run()
        assert.equal(result.status, 400)
        assert.equal(result.body.message, 'RECORDS_COUNTRY_EMPTY')
        assert.equal(result.headers['Content-Type'], undefined)
        assert.equal(h.calls.length, 1)
    }
})

test('allround validation report identifies every invalid result and reason, without returning a workbook', async () => {
    const issues = [
        { id: 'record-1', skater: 'Skater One', date: '2026-10-23', distance: 500,
            competition: 'Event', times: [0, null], gender: 'M', reasons: ['RECORDS_ALLROUND_INVALID_TIMES'] },
        { id: 'record-2', skater: '', date: '', distance: 1000, competition: '', times: [], gender: '',
            reasons: ['RECORDS_ALLROUND_INVALID_NAME', 'RECORDS_ALLROUND_INVALID_GENDER'] }
    ]
    const result = await harness({ allround: true, failure: 'RECORDS_EXCEL_DATA', issues }).run()
    assert.equal(result.status, 400)
    assert.equal(result.headers['Content-Type'], undefined)
    assert.equal(result.body.issues, issues)
    for (const text of ['Skater One', '2026-10-23', '500 m', 'Event', 'record-1', '[0,null]',
        'record-2', '1000 m', 'RECORDS_ALLROUND_INVALID_TIMES', 'RECORDS_ALLROUND_INVALID_GENDER',
        'RECORDS_ALLROUND_INVALID_NAME']) assert.ok(result.body.message.includes(text), text)
})

test('Excel endpoint forwards the calendar-year season configuration for inline', async () => {
    const h = harness()
    h.req.app.locals.registryImportSeasonStartMonth = 1
    await h.run()
    assert.equal(h.calls[1].options.seasonStartMonth, 1)
})

test('historical ranking endpoint displays invalid record details rather than a generic error', async () => {
    const issues = [{ id: 'bad-record', skater: 'Test', date: '', distance: 500, race: '500',
        competition: 'Event', gender: 'M', times: [null, 0], totalTime: 0,
        reasons: ['RECORDS_EXCEL_INVALID_DATE', 'RECORDS_ALLROUND_INVALID_TIMES'] }]
    const result = await harness({ failure: 'RECORDS_EXCEL_DATA', issues }).run()
    assert.equal(result.status, 400)
    assert.equal(result.body.issues, issues)
    for (const text of ['bad-record', 'Test', '500', 'Event', 'RECORDS_EXCEL_INVALID_DATE']) {
        assert.ok(result.body.message.includes(text), text)
    }
})

test('invalid uploads and filters fail before reading records or creating an updated workbook', async () => {
    for (const options of [{ file: false }, { filters: 'invalid' }, { filters: '[]' }]) {
        const h = harness(options)
        assert.equal((await h.run()).status, 400)
        assert.equal(h.calls.length, 0)
    }
    const h = harness()
    h.req.files.file.size = 26 * 1024 * 1024
    assert.equal((await h.run()).status, 400)
    assert.equal(h.calls.length, 0)
})

test('workbook layout errors return an explicit message; database failures reach error middleware', async () => {
    const invalid = harness({ failure: 'RECORDS_EXCEL_COLUMNS' })
    const result = await invalid.run()
    assert.equal(result.status, 400)
    assert.equal(result.body.message, 'RECORDS_EXCEL_COLUMNS')
    const failed = await harness({ queryFailure: true }).run()
    assert.equal(failed.nextError.message, 'database failed')
    assert.equal(failed.body, undefined)
})
