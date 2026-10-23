const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function harness({ backupFailure = false, changed = false, requestFailure = false, writeFailure = false,
    categories = false } = {}) {
    const handlers = new Map(), props = new Map(), writes = []
    const original = { name: 'Marcas.xlsx', lastModified: 1, size: 100 }
    let reads = 0, request
    const writer = name => ({
        write: async contents => {
            writes.push(['write', name, contents])
            if (backupFailure && name !== original.name || writeFailure && name === original.name) throw new Error('write failed')
        },
        close: async () => { writes.push(['close', name]) },
        abort: async () => { writes.push(['abort', name]) }
    })
    const folder = { getFileHandle: async name => ({
        getFile: async () => ++reads > 1 && changed ? { ...original, lastModified: 2 } : original,
        createWritable: async () => writer(name)
    }) }
    const document = {}
    function $(key) {
        if (key === document) return { on: (_event, selector, callback) => handlers.set(selector, callback) }
        if (!props.has(key)) props.set(key, {})
        const state = props.get(key)
        const element = {
            0: { focus() {} },
            val: () => original.name,
            text: value => { state.text = value; return element },
            prop: (name, value) => { state[name] = value; return element },
            toggleClass: () => element
        }
        return element
    }
    class FormData {
        constructor() { this.values = {} }
        set(key, value) { this.values[key] = value }
    }
    const source = fs.readFileSync(path.join(__dirname, '../public/js/records-excel.js'), 'utf8')
    vm.runInNewContext(source.replace(/\}\(\)\)\s*$/, `folder = testFolder; categories = ${categories}; }())`), {
        $, document, testFolder: folder, console, FormData,
        recordsExcelText: {}, window: { confirm: () => true }, crypto: { randomUUID: () => 'unique' },
        core: { forms: { parse: () => ({ top: '3', race: '500', bestForSkater: 'true' }) } },
        fetch: async (url, options) => {
            request = { url, options }
            return { ok: !requestFailure, blob: async () => 'updated',
                json: async () => ({ message: 'server failure' }), headers: { get: () => '1' } }
        }
    })
    return { writes, props, original, request: () => request, save: () => handlers.get('#RecordsExcel_save')() }
}

test('writes exact original backup and closes it before overwriting original with server results', async () => {
    const h = harness()
    await h.save()
    assert.equal(h.writes.length, 4)
    assert.match(h.writes[0][1], /^Marcas\.backup-.*-unique\.xlsx$/)
    assert.equal(h.writes[0][2], h.original)
    assert.equal(h.writes[1][0], 'close')
    assert.equal(h.writes[2][1], 'Marcas.xlsx')
    assert.equal(h.writes[2][2], 'updated')
    assert.equal(h.request().url, '/api/registry/records/excel')
    assert.equal(JSON.parse(h.request().options.body.values.filters).top, '3')
})

test('failed backup or server error never opens the original for writing', async () => {
    for (const options of [{ backupFailure: true }, { requestFailure: true }, { changed: true }]) {
        const h = harness(options)
        await h.save()
        assert.equal(h.writes.some(entry => entry[1] === 'Marcas.xlsx'), false)
        assert.match(h.props.get('#RecordsExcel_message').text, /RECORDS_EXCEL_ERROR/)
    }
})

test('failed original write aborts and reports the completed backup path', async () => {
    const h = harness({ writeFailure: true })
    await h.save()
    assert.equal(h.writes.some(entry => entry[0] === 'abort' && entry[1] === 'Marcas.xlsx'), true)
    assert.match(h.props.get('#RecordsExcel_message').text, /Marcas\.backup-/)
})

test('category update uses its own endpoint without screen filters and retains the exact backup-first sequence', async () => {
    const h = harness({ categories: true })
    await h.save()
    assert.equal(h.request().url, '/api/registry/records/excel/categories')
    assert.equal(h.request().options.body.values.filters, undefined)
    assert.equal(h.writes[0][2], h.original)
    assert.equal(h.writes[1][0], 'close')
    assert.equal(h.writes[2][1], 'Marcas.xlsx')
    const failed = harness({ categories: true, backupFailure: true })
    await failed.save()
    assert.equal(failed.writes.some(entry => entry[1] === 'Marcas.xlsx'), false)
})
