const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function harness({ category = 'LA2', action = 'import', serverError = false, registryScope = false,
    currentCategory = 'LA2', updateSkaterCategory = '',
    needsTrack = false, trackId = '', duplicateReview = false, duplicateAction = '', renderPreview } = {}) {
    const handlers = new Map(), elements = new Map()
    let requests = 0, created = 0
    const testState = {}
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
                prop(name, value) { if (value === undefined) return props[name]; props[name] = value; return e },
                attr(name, value) { props[name] = value; return e },
                val(value) { if (value !== undefined) { props.value = value; return e }
                    if (Object.hasOwn(props, 'value')) return props.value
                    return key === 'action' ? action : key === 'skater' ? 'skater-1' :
                    key === 'category' ? category : key === '#RegistryImportUpdateCategories' ? updateSkaterCategory : '' },
                append(...children) { (props.children ||= []).push(...children); return e },
                empty() { props.children = []; return e },
                data(name) { return props[name] },
                select2(options) { props.select2 = options; props.select2Calls = (props.select2Calls || 0) + 1; return e },
                on(event, callback) { props[event] = callback; return e },
                trigger(event) { props.triggered = event; if (props[event]) props[event](); return e }
            }
            elements.set(key, e)
        }
        return elements.get(key)
    }
    const document = { documentElement: { lang: 'es' } }
    const $ = key => key === document ? { on: (_event, selector, handler) => handlers.set(selector, handler) } :
        element(typeof key === 'string' && key.startsWith('<') ? `${key}:${created++}` : key)
    let lastRequest
    $.ajax = async options => {
        lastRequest = options
        requests++
        if (serverError) throw { responseJSON: { message: 'Server validation error' } }
        if (options.url.endsWith('/preview')) return renderPreview || reviewData()
        return { imported: [{ row: 2, name: 'Daniela', category: 'LA2' }], skipped: [], failed: [], createdSkaters: [],
            ...(registryScope ? { createdEvents: [{ row: 2, name: 'Thialf', season: '2023-2024' }], createdTracks: [] } : {}) }
    }
    class FormData {
        constructor() { this.values = { categorySource: element('#RegistryImportCategorySource').val() || 'file' } }
        set(key, value) { this.values[key] = value }
    }
    const context = {
        $, document, registryImportText: {}, bootstrap: {}, window: { confirm: () => true }, testState, FormData
    }
    const source = fs.readFileSync(path.join(__dirname, '../public/js/registry-import.js'), 'utf8')
    vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, `
        competitionId = ${registryScope ? 'null' : "'event-1'"};
        importBase = ${registryScope ? "'/api/registry'" : "'/api/competition/event-1'"};
        preview = {token: 'token', rows: [{
            index: 0, skaterName: 'Daniela', sourceLocation: 'PDF 1 / 163',
            inputCategory: 'unknown', category: ${JSON.stringify(category)},
            candidates: [{ id: 'skater-1', category: ${JSON.stringify(currentCategory)} }],
            ${needsTrack ? 'destination: {needsTrack: true},' : ''}
        }]};
        ${needsTrack ? `trackSelectors.set('', {val: () => ${JSON.stringify(trackId)}});` : ''}
        ${duplicateReview ? `duplicateSelectors.set(0, {
            action: {val: () => ${JSON.stringify(duplicateAction)}},
            existing: {val: () => 'existing'}, token: 'review-token'
        });` : ''}
        rowSelectors.push({ action: $('action'), skaters: $('skater'), category: $('category') });
        ${renderPreview ? `review(${JSON.stringify(renderPreview)});` : ''}
        testState.controls = rowSelectors;
        testState.populateClubs = populateClubs;
    }());`), context)
    return { elements, requests: () => requests, lastRequest: () => lastRequest,
        controls: () => testState.controls,
        populateClubs: clubs => testState.populateClubs(clubs),
        control: element,
        submit: () => handlers.get('#RegistryImportForm').call({}, { preventDefault() {} }),
        changeOptions: () => handlers.get([...handlers.keys()].find(key => key.startsWith('#RegistryImportCategorySource')))(),
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

test('category differences block confirmation until the profile update question is answered', async () => {
    const pending = harness({ category: 'Other' })
    await pending.commit()
    assert.equal(pending.requests(), 0)
    assert.match(pending.elements.get('#RegistryImportError').props.text, /IMPORT_CATEGORY_UPDATE_CHOOSE/)
    assert.equal(pending.elements.get('#RegistryImportUpdateCategories').props['aria-invalid'], 'true')
    for (const [answer, expected] of [['yes', true], ['no', false]]) {
        const ready = harness({ category: 'Other', updateSkaterCategory: answer })
        await ready.commit()
        assert.equal(ready.requests(), 1)
        assert.equal(JSON.parse(ready.lastRequest().data).choices[0].updateSkaterCategory, expected)
    }
})

const reviewData = overrides => ({
    token: 'token', createSkaters: false, categories: ['LA2', 'Other'], tracks: [], categorySource: 'file',
    rows: [{
        index: 0, skaterName: 'Ona', gender: 'F', race: '500', warnings: [], issue: null,
        inputCategory: 'Other', category: 'Other', automaticSkater: 'skater-1',
        candidates: [{ id: 'skater-1', name: 'Ona', category: 'LA2' }]
    }], ...overrides
})

test('review renders file categories and a mandatory, initially unanswered profile update question', async () => {
    const h = harness({ renderPreview: reviewData() })
    const controls = h.controls()[0]
    assert.equal(controls.category.val(), 'Other')
    assert.equal(controls.category.props.disabled, true)
    assert.equal(h.control('#RegistryImportUpdateCategories').val(), '')
    await h.commit()
    assert.equal(h.requests(), 0)
    h.control('#RegistryImportUpdateCategories').val('no')
    await h.commit()
    assert.equal(h.requests(), 1)
    const choice = JSON.parse(h.lastRequest().data).choices[0]
    assert.equal(choice.category, 'Other')
    assert.equal(choice.updateSkaterCategory, false)
})

test('review inherits the selected database category and does not require a profile change decision', async () => {
    const h = harness({ renderPreview: reviewData({ categorySource: 'database' }) })
    assert.equal(h.controls()[0].category.val(), 'LA2')
    await h.commit()
    assert.equal(h.requests(), 1)
    assert.equal(JSON.parse(h.lastRequest().data).choices[0].category, 'LA2')
})

test('unresolved file categories require a manual category and then a separate profile decision', async () => {
    const data = reviewData()
    data.rows[0].category = null
    const h = harness({ renderPreview: data })
    const controls = h.controls()[0]
    assert.equal(controls.category.val(), '')
    assert.equal(controls.category.props.disabled, false)
    await h.commit()
    assert.equal(h.requests(), 0)
    controls.category.val('Other').trigger('change')
    await h.commit()
    assert.equal(h.requests(), 0)
    assert.match(h.elements.get('#RegistryImportError').props.text, /IMPORT_CATEGORY_UPDATE_CHOOSE/)
    h.control('#RegistryImportUpdateCategories').val('yes')
    await h.commit()
    assert.equal(h.requests(), 1)
    assert.equal(JSON.parse(h.lastRequest().data).choices[0].updateSkaterCategory, true)
})

test('changing a manually matched skater refreshes inherited categories but preserves the general profile decision', () => {
    const data = reviewData({ categorySource: 'database' })
    data.rows[0].automaticSkater = null
    data.rows[0].candidates.push({ id: 'skater-2', name: 'Other Ona', category: 'Other' })
    const h = harness({ renderPreview: data })
    const controls = h.controls()[0]
    assert.equal(controls.category.val(), '')
    controls.skaters.val('skater-1').trigger('change')
    assert.equal(controls.category.val(), 'LA2')
    h.control('#RegistryImportUpdateCategories').val('yes')
    controls.skaters.val('skater-2').trigger('change')
    assert.equal(controls.category.val(), 'Other')
    assert.equal(h.control('#RegistryImportUpdateCategories').val(), 'yes')
})

test('one general decision applies to all differing skaters in both import entry points', async () => {
    for (const registryScope of [false, true]) {
        for (const [answer, expected] of [['yes', true], ['no', false]]) {
            const data = reviewData()
            data.rows.push({ ...data.rows[0], index: 1, skaterName: 'Second skater',
                automaticSkater: 'skater-2', candidates: [{ id: 'skater-2', name: 'Second skater', category: 'LA2' }] })
            const h = harness({ registryScope, renderPreview: data })
            await h.commit()
            assert.equal(h.requests(), 0)
            h.control('#RegistryImportUpdateCategories').val(answer)
            await h.commit()
            assert.equal(h.requests(), 1)
            const choices = JSON.parse(h.lastRequest().data).choices
            assert.equal(choices.length, 2)
            assert.equal(choices[0].updateSkaterCategory, expected)
            assert.equal(choices[1].updateSkaterCategory, expected)
            assert.equal(h.controls().some(c => c.updateCategory), false)
        }
    }
})

test('club filtering requires a selection and sends the selected database club in both import forms', async () => {
    for (const registryScope of [false, true]) {
        const h = harness({ registryScope })
        h.control('#RegistryImportClubOnly').prop('checked', true)
        await h.submit()
        assert.equal(h.requests(), 0)
        assert.equal(h.elements.get('#RegistryImportError').props.text, 'IMPORT_CLUB_CHOOSE')
        h.control('#RegistryImportClub').val('club-1')
        h.control('#RegistryImportCategorySource').val('database')
        await h.submit()
        assert.equal(h.requests(), 1)
        assert.equal(h.lastRequest().url, registryScope ? '/api/registry/import/preview' : '/api/competition/event-1/import/preview')
        assert.equal(h.lastRequest().data.values.clubId, 'club-1')
        assert.equal(h.lastRequest().data.values.categorySource, 'database')
    }
})

test('unchecked club filtering sends no club restriction and option changes invalidate the old review', async () => {
    const h = harness()
    h.control('#RegistryImportClub').val('club-1')
    h.changeOptions()
    assert.equal(h.control('#RegistryImportClub').props.disabled, true)
    await h.commit()
    assert.equal(h.requests(), 0)
    await h.submit()
    assert.equal(h.lastRequest().data.values.clubId, '')
    assert.equal(h.lastRequest().data.values.categorySource, 'file')
    h.control('#RegistryImportClubOnly').prop('checked', true)
    h.changeOptions()
    assert.equal(h.control('#RegistryImportClub').props.disabled, false)
    await h.commit()
    assert.equal(h.requests(), 1)
})

test('club selector sorts names alphabetically and always enables search inside the import modal', () => {
    const h = harness()
    const clubs = [
        { id: 'z', name: 'Zaragoza' }, { id: 'b', name: 'barcelona' },
        { id: 'a', name: 'Álava' }, { id: 'c', name: 'CPV RIVAS' }
    ]
    h.populateClubs(clubs)
    const control = h.control('#RegistryImportClub')
    assert.deepEqual(control.props.children.map(c => c.props.text),
        ['IMPORT_SELECT', 'Álava', 'barcelona', 'CPV RIVAS', 'Zaragoza'])
    assert.deepEqual(control.props.children.map(c => c.val()), ['', 'a', 'b', 'c', 'z'])
    assert.equal(control.props.select2.minimumResultsForSearch, 0)
    assert.equal(control.props.select2.dropdownParent, h.control('#RegistryImportModal'))
    assert.equal(control.props.select2.width, '100%')
    assert.equal(control.props.select2Calls, 1)
    h.populateClubs(clubs)
    assert.equal(control.props.select2Calls, 1)
    assert.equal(control.props.children.length, 5)
    assert.equal(control.val(), '')
    assert.deepEqual(clubs.map(c => c.id), ['z', 'b', 'a', 'c'])
})

test('review shows the resolved profile club and updates it when a different candidate is selected', () => {
    const data = reviewData()
    data.rows[0].automaticSkater = null
    data.rows[0].clubResolution = { name: 'UNKNOWN', unknown: true, create: false }
    data.rows[0].candidates[0].clubResolution = { name: 'CLUB PATIN SIERO', source: 'profile', create: false }
    data.rows[0].candidates.push({ id: 'skater-2', name: 'Other', category: 'LA2',
        clubResolution: { name: 'NEW CLUB', source: 'file', create: true } })
    const h = harness({ renderPreview: data })
    const controls = h.controls()[0]
    const clubElement = [...h.elements.values()].find(e => typeof e.props.text === 'string' && e.props.text.includes('IMPORT_UNKNOWN_CLUB'))
    assert.ok(clubElement)
    controls.skaters.val('skater-1').trigger('change')
    assert.match(clubElement.props.text, /CLUB PATIN SIERO.*IMPORT_CLUB_PROFILE/)
    controls.skaters.val('skater-2').trigger('change')
    assert.match(clubElement.props.text, /NEW CLUB.*IMPORT_CLUB_NEW/)
    assert.doesNotMatch(clubElement.props.text, /UNKNOWN/)
})
