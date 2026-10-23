const { test } = require('node:test')
const assert = require('node:assert/strict')
const { finalTime, hasCompleteSplits } = require('../utils/records-time')

test('prefers the final total and never substitutes a partial sum for an invalid explicit total', () => {
    assert.equal(finalTime({ totalTime: 40000, times: [0, null, 90000] }), 40000)
    for (const totalTime of [0, null, -1, NaN, Infinity, '40000']) {
        assert.equal(finalTime({ totalTime, times: [40000] }), null)
    }
})

test('supports legacy calculated totals with zero, null or missing splits but does not fabricate split values', () => {
    for (const times of [[0, null, 40000], [, 40000], [40000]]) {
        assert.equal(finalTime({ times }), 40000)
    }
    for (const times of [[], [0, null], [-1, 40000], [NaN], [Infinity]]) {
        assert.equal(finalTime({ times }), null)
    }
    assert.equal(hasCompleteSplits({ times: [20000, 20000] }), true)
    for (const times of [[], [0, 40000], [null, 40000], [, 40000]]) {
        assert.equal(hasCompleteSplits({ times }), false)
    }
})
