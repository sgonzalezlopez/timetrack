const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function harness({ category = 'LA2', action = 'import', serverError = false, registryScope = false,
    needsTrack = false, trackId = '', duplicateReview = false, duplicateAction = '' } = {}) {
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
                append() { return e }, empty() { return e },
                trigger(event) { props.triggered = event; return e }
            }
            elements.set(key, e)
        }
        return elements.get(key)
    }
    const document = {}
    const $ = key => key === document ? { on: (_event, selector, handler) => handlers.set(selector, handler) } : element(key)
    let lastRequest
    $.ajax = async options => {
        lastRequest = options
        requests++
        if (serverError) throw { responseJSON: { message: 'Server validation error' } }
        return { imported: [{ row: 2, name: 'Daniela', category: 'LA2' }], skipped: [], failed: [], createdSkaters: [],
            ...(registryScope ? { createdEvents: [{ row: 2, name: 'Thialf', season: '2023-2024' }], createdTracks: [] } : {}) }
    }
    const context = {
        $, document, registryImportText: {}, bootstrap: {}, window: { confirm: () => true }
    }
    const source = fs.readFileSync(path.join(__dirname, '../public/js/registry-import.js'), 'utf8')
    vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, `
        competitionId = ${registryScope ? 'null' : "'event-1'"};
        importBase = ${registryScope ? "'/api/registry'" : "'/api/competition/event-1'"};
        preview = {token: 'token', rows: [{
            index: 0, skaterName: 'Daniela', sourceLocation: 'PDF 1 / 163',
            inputCategory: 'unknown', category: ${JSON.stringify(category)},
            ${needsTrack ? 'destination: {needsTrack: true},' : ''}
        }]};
        ${needsTrack ? `trackSelectors.set('', {val: () => ${JSON.stringify(trackId)}});` : ''}
        ${duplicateReview ? `duplicateSelectors.set(0, {
            action: {val: () => ${JSON.stringify(duplicateAction)}},
            existing: {val: () => 'existing'}, token: 'review-token'
        });` : ''}
        categorySelectors.set('unknown', $('category'));
        rowSelectors.push({ action: $('action'), skaters: $('skater') });
    }());`), context)
    return { elements, requests: () => requests, lastRequest: () => lastRequest,
        commit: () => handlers.get('#RegistryImportCommit')() }
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
    assert.equal(h.elements.get('#RegistryImportForm :input, #RegistryImportCommit, #RegistryImportDuplicates select').props.disabled, false)
})

test('registry import requires missing track selection and sends it to the correct endpoint', async () => {
    const missing = harness({ registryScope: true, needsTrack: true })
    await missing.commit()
    assert.equal(missing.requests(), 0)
    assert.equal(missing.elements.get('#RegistryImportError').props.text, 'IMPORT_CHOOSE_TRACK')
    const ready = harness({ registryScope: true, needsTrack: true, trackId: 'track-1' })
    await ready.commit()
    assert.equal(ready.lastRequest().url, '/api/registry/import/commit')
    assert.equal(JSON.parse(ready.lastRequest().data).choices[0].trackId, 'track-1')
    assert.equal(ready.elements.get('#RegistryForm_search_btn').props.triggered, 'click')
})

test('event imports continue using the selected event endpoint without refreshing registry search', async () => {
    const h = harness()
    await h.commit()
    assert.equal(h.lastRequest().url, '/api/competition/event-1/import/commit')
    assert.equal(h.elements.has('#RegistryForm_search_btn'), false)
})

test('duplicate comparisons require an explicit decision and send its review token', async () => {
    const pending = harness({ duplicateReview: true })
    await pending.commit()
    assert.equal(pending.requests(), 0)
    assert.equal(pending.elements.get('#RegistryImportError').props.text, 'IMPORT_DUPLICATE_DECISION')
    const decided = harness({ duplicateReview: true, duplicateAction: 'replace' })
    await decided.commit()
    const choice = JSON.parse(decided.lastRequest().data).choices[0]
    assert.equal(choice.duplicateReviewToken, 'review-token')
    assert.equal(choice.duplicateAction, 'replace')
    assert.equal(choice.duplicateId, 'existing')
})
