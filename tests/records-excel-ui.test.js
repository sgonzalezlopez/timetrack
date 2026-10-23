const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function harness({ backupFailure = false, changed = false, requestFailure = false, writeFailure = false,
    serverMessage = 'server failure',
    categories = false, allround = false } = {}) {
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
    let pickerCalls = 0
    const document = { getElementById: id => ({ id }) }
    function $(key) {
        if (key === document) return { on: (_event, selector, callback) => handlers.set(selector, callback) }
        if (!props.has(key)) props.set(key, {})
        const state = props.get(key)
        const element = {
            0: { focus() {} },
            val: () => original.name,
            text: value => { state.text = value; return element },
            prop: (name, value) => { state[name] = value; return element },
            toggleClass: () => element,
            empty: () => { state.emptied = true; return element }
        }
        return element
    }
    class FormData {
        constructor() { this.values = {} }
        set(key, value) { this.values[key] = value }
    }
    const source = fs.readFileSync(path.join(__dirname, '../public/js/records-excel.js'), 'utf8')
    vm.runInNewContext(source.replace(/\}\(\)\)\s*$/, `folder = testFolder; categories = ${categories}; allround = ${allround}; }())`), {
        $, document, testFolder: folder, console, FormData,
        recordsExcelText: {}, window: { confirm: () => true, showDirectoryPicker: async () => {
            pickerCalls++
            throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
        } }, crypto: { randomUUID: () => 'unique' },
        bootstrap: { Modal: { getOrCreateInstance: () => ({ show() {} }) } },
        core: { forms: { parse: () => ({ top: '3', race: '500', bestForSkater: 'true' }) } },
        fetch: async (url, options) => {
            request = { url, options }
            return { ok: !requestFailure, blob: async () => 'updated',
                json: async () => ({ message: serverMessage }), headers: { get: () => '1' } }
        }
    })
    return { writes, props, original, request: () => request, save: () => handlers.get('#RecordsExcel_save')(),
        open: id => handlers.get('#RecordsExcel_open, #RecordsCategoriesExcel_open, #RecordsAllroundExcel_open').call({ id }),
        pick: () => handlers.get('#RecordsExcel_folder')(), pickerCalls: () => pickerCalls }
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

test('allround update uses its own endpoint and saves the original backup before overwriting', async () => {
    const h = harness({ allround: true })
    await h.save()
    assert.equal(h.request().url, '/api/registry/records/excel/allround')
    assert.equal(h.request().options.body.values.filters, undefined)
    assert.equal(h.writes[0][2], h.original)
    assert.equal(h.writes[1][0], 'close')
    assert.equal(h.writes[2][1], 'Marcas.xlsx')
    const failed = harness({ allround: true, backupFailure: true })
    await failed.save()
    assert.equal(failed.writes.some(entry => entry[1] === 'Marcas.xlsx'), false)
})

test('no Allround marks displays the explicit server error and never writes a backup or original', async () => {
    const h = harness({ allround: true, requestFailure: true, serverMessage: 'RECORDS_ALLROUND_EMPTY' })
    await h.save()
    assert.deepEqual(h.writes, [])
    assert.match(h.props.get('#RecordsExcel_message').text, /RECORDS_ALLROUND_EMPTY/)
})

test('invalid Allround report is displayed in full as text without writing any file', async () => {
    const serverMessage = 'Invalid results\n1. <b>Name</b> | 500 m\nInvalid times\n\n2. Other | 1000 m\nMissing gender'
    const h = harness({ allround: true, requestFailure: true, serverMessage })
    await h.save()
    assert.deepEqual(h.writes, [])
    assert.equal(h.props.get('#RecordsExcel_message').text, `RECORDS_EXCEL_ERROR ${serverMessage}`)
})

test('switching Excel modes retains the selected folder and file without reopening the picker', async () => {
    const h = harness()
    for (const [id, url] of [
        ['RecordsAllroundExcel_open', '/api/registry/records/excel/allround'],
        ['RecordsCategoriesExcel_open', '/api/registry/records/excel/categories'],
        ['RecordsExcel_open', '/api/registry/records/excel']
    ]) {
        h.open(id)
        await h.save()
        assert.equal(h.request().url, url)
        assert.equal(h.props.get('#RecordsExcel_file')?.emptied, undefined)
    }
    assert.equal(h.pickerCalls(), 0)
})

test('cancelling an explicit folder change preserves the previous selection', async () => {
    const h = harness()
    await h.pick()
    assert.equal(h.pickerCalls(), 1)
    h.open('RecordsCategoriesExcel_open')
    await h.save()
    assert.equal(h.request().url, '/api/registry/records/excel/categories')
    assert.equal(h.writes[0][2], h.original)
})
