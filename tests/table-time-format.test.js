const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function formatters() {
    const core = { setOptions() {}, formatters: {} }
    const context = vm.createContext({ core })
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/local-common.js'), 'utf8'), context)
    return context
}

test('table time formatter removes only leading zeros and keeps exact milliseconds', () => {
    const { core } = formatters()
    for (const [time, expected] of [
        [0, '0.000'], [5, '0.005'], [9800, '9.800'], [36030, '36.030'],
        [59999, '59.999'], [60000, '1:00.000'], [75997, '1:15.997'],
        [3600005, '1:00:00.005'], [90000000, '25:00:00.000'],
        [null, '-']
    ]) assert.equal(core.formatters.milliseconds(time), expected)
})

test('partial times and expanded registry details use the same compact formatter', () => {
    const context = formatters()
    assert.equal(context.formatterMillisecondsArray([9800, 36030, null, 0, 75997]), '9.800, 36.030, 1:15.997')
    const details = context.registryDetailFormatter(0, { times: [9800, null, 36030], totalTime: 75997 })
    assert.match(details, />\s*9\.800\s*</)
    assert.match(details, />\s*36\.030\s*</)
    assert.match(details, />\s*1:15\.997\s*</)
    assert.match(details, />\s*-\s*</)
    assert.doesNotMatch(details, /00:00:/)
})
