const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function harness({ category = 'LA2', action = 'import', serverError = false } = {}) {
    const handlers = new Map(), elements = new Map()
    let requests = 0
    function element(key) {
        if (!elements.has(key)) {
            const props = {}
            const node = {
                scrollIntoView() { props.scrolled = true },
                focus() { props.focused = true }
            }
            const e = {
                0: node, props,
                text(value) { if (value === undefined) return props.text; props.text = value; return e },
                prop(name, value) { props[name] = value; return e },
                attr(name, value) { props[name] = value; return e },
                val() { return key === 'action' ? action : key === 'skater' ? 'skater-1' : '' },
                append() { return e }, empty() { return e }
            }
            elements.set(key, e)
        }
        return elements.get(key)
    }
    const document = {}
    const $ = key => key === document ? { on: (_event, selector, handler) => handlers.set(selector, handler) } : element(key)
    $.ajax = async () => {
        requests++
        if (serverError) throw { responseJSON: { message: 'Server validation error' } }
        return { imported: [{ row: 2, name: 'Daniela', category: 'LA2' }], skipped: [], failed: [], createdSkaters: [] }
    }
    const context = {
        $, document, registryImportText: {}, bootstrap: {}, window: { confirm: () => true }
    }
    const source = fs.readFileSync(path.join(__dirname, '../public/js/registry-import.js'), 'utf8')
    vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, `
        preview = {token: 'token', rows: [{
            index: 0, skaterName: 'Daniela', sourceLocation: 'PDF 1 / 163',
            inputCategory: 'unknown', category: ${JSON.stringify(category)}
        }]};
        categorySelectors.set('unknown', $('category'));
        rowSelectors.push({ action: $('action'), skaters: $('skater') });
    }());`), context)
    return { elements, requests: () => requests, commit: () => handlers.get('#RegistryImportCommit')() }
}

test('incomplete row reveals and focuses the error instead of failing out of view', async () => {
    const h = harness({ category: null })
    await h.commit()
    assert.equal(h.requests(), 0)
    const alert = h.elements.get('#RegistryImportError').props
    assert.equal(alert.hidden, false)
    assert.equal(alert.scrolled, true)
    assert.equal(alert.focused, true)
    assert.match(alert.text, /PDF 1 \/ 163: Daniela/)
    assert.equal(h.elements.get('category').props['aria-invalid'], 'true')
})

test('all skipped rows explain that no import was selected without sending a request', async () => {
    const h = harness({ action: 'skip' })
    await h.commit()
    assert.equal(h.requests(), 0)
    assert.equal(h.elements.get('#RegistryImportError').props.text, 'IMPORT_NOTHING_SELECTED')
})

test('successful confirmation reveals and focuses its report', async () => {
    const h = harness()
    await h.commit()
    assert.equal(h.requests(), 1)
    const report = h.elements.get('#RegistryImportReport').props
    assert.equal(report.hidden, false)
    assert.equal(report.scrolled, true)
    assert.equal(report.focused, true)
})

test('server errors are visible and controls are reenabled', async () => {
    const h = harness({ serverError: true })
    await h.commit()
    assert.equal(h.elements.get('#RegistryImportError').props.text, 'Server validation error')
    assert.equal(h.elements.get('#RegistryImportError').props.scrolled, true)
    assert.equal(h.elements.get('#RegistryImportForm :input, #RegistryImportCommit').props.disabled, false)
})
