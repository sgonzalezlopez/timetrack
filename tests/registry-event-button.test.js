const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const template = fs.readFileSync(path.join(__dirname, '../views/management/registry.ejs'), 'utf8')

function harness(id = '') {
    const state = { id, disabled: true, destination: null }
    const context = {
        registry: null, competition: null,
        $: selector => ({
            val: () => state.id,
            prop: (key, value) => { assert.equal(selector, '#RegistryForm_edit_competition_btn'); state[key] = value },
            show() {}, hide() {}
        }),
        core: { goTo: destination => { state.destination = destination } }
    }
    const start = template.indexOf('\tfunction refreshView ()')
    const end = template.indexOf('\n\tfunction localFormParse', start)
    vm.createContext(context)
    vm.runInContext(template.slice(start, end), context)
    return { state, context }
}

test('event shortcut is orange, starts disabled and precedes time entry after generated action buttons', () => {
    const button = template.match(/<button id="RegistryForm_edit_competition_btn"[^>]*>/)[0]
    assert.match(button, /class="btn btn-orange"/)
    assert.match(button, / disabled /)
    assert.ok(template.indexOf(button) < template.indexOf('<button id="RegistryForm_enter_times_btn"'))
    assert.match(template, /data-save-after="registrySaved"/)
    assert.match(template, /data-update-after="registrySaved"/)
    assert.match(template, /function clearForm\(\)[\s\S]*?\$\('#id'\)\.val\(''\)[\s\S]*?refreshView\(\);/)
})

test('new records cannot navigate even when their event is already selected', () => {
    const { state, context } = harness()
    context.competition = { _id: 'selected' }
    context.refreshView()
    context.editRegistryCompetition()
    assert.equal(state.disabled, true)
    assert.equal(state.destination, null)
})

test('saved records navigate to their persisted event, not an unsaved selection', () => {
    for (const competition of [{ _id: 'event-1' }, { id: 'event-1' }, 'event-1']) {
        const { state, context } = harness('registry-1')
        context.competition = { _id: 'unsaved-selection' }
        context.registrySaved({ competition })
        assert.equal(state.disabled, false)
        context.editRegistryCompetition()
        assert.equal(state.destination, '/management/competition/event-1')
        state.id = ''
        context.refreshView()
        assert.equal(state.disabled, true)
        state.destination = null
        context.editRegistryCompetition()
        assert.equal(state.destination, null)
    }
})

test('records without a linked event keep the shortcut disabled', () => {
    const { state, context } = harness('registry-1')
    context.registrySaved({ competition: null })
    context.editRegistryCompetition()
    assert.equal(state.disabled, true)
    assert.equal(state.destination, null)
})
