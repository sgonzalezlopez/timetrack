const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function harness({ file = true, filters = '{"top":"3","bestForSkater":"true","season":"2026-2027","groupBy":"none"}',
    failure, queryFailure } = {}) {
    const calls = [], exports = {}
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/records-excel.controller.js'), 'utf8'), {
        exports, Buffer, console,
        require: name => name === './registry.controller' ? {
            getRecords: async req => {
                calls.push({ query: req.body, user: req.user })
                if (queryFailure) throw new Error('database failed')
                return [{ id: 'filtered' }]
            }
        } : {
            updateRecordsExcel: async (buffer, records, options) => {
                calls.push({ buffer, records, options })
                if (failure) throw new Error(failure)
                return { buffer: Buffer.from('updated'), count: 1, groups: 1 }
            }
        }
    })
    let status = 200, body, nextError
    const headers = {}
    const req = { user: { id: 'user-1' }, body: { filters },
        files: file ? { file: { name: 'Marcas.xlsx', size: 100, data: Buffer.from('original') } } : {} }
    const res = { __: value => value, status: value => { status = value; return res },
        set: (key, value) => { headers[key] = value }, send: value => { body = value } }
    return { calls, req, run: async () => {
        await exports.update(req, res, err => { nextError = err })
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
    assert.equal(result.headers['X-Records-Count'], '1')
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
