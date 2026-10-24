const { test } = require('node:test')
const assert = require('node:assert/strict')
const { backfillRegistryCountries } = require('../utils/backfill-registry-country')

function createModels(colombianIds = ['colombian-skater']) {
    const calls = { find: [], count: [], update: [] }
    const Skater = {
        find: filter => {
            calls.find.push(filter)
            return {
                select: () => ({
                    lean: async () => colombianIds.map(_id => ({ _id }))
                })
            }
        }
    }
    const Registry = {
        countDocuments: async filter => {
            calls.count.push(filter)
            if (filter._id && filter._id.$exists === false) return 0
            return filter.skater && filter.skater.$in ? 3 : 12
        },
        updateMany: async (filter, update) => {
            calls.update.push({ filter, update })
            if (filter._id && filter._id.$exists === false) return { modifiedCount: 0 }
            return { modifiedCount: filter.skater && filter.skater.$in ? 2 : 10 }
        }
    }
    return { Registry, Skater, calls }
}

test('registry country backfill simulates Spanish and Colombian historical results without modifying data', async () => {
    const { Registry, Skater, calls } = createModels()

    const result = await backfillRegistryCountries({ Registry, Skater })

    assert.deepEqual(result, {
        apply: false,
        colombianSkaters: 1,
        spanishRecords: 12,
        colombianRecords: 3,
        totalRecords: 15
    })
    assert.deepEqual(calls.find, [{ country: { $in: ['CO', 'COL'] } }])
    assert.deepEqual(calls.count, [
        { skater: { $nin: ['colombian-skater'] } },
        { skater: { $in: ['colombian-skater'] } }
    ])
    assert.deepEqual(calls.update, [])
})

test('registry country backfill writes ISO countries and handles no Colombian profiles', async () => {
    const { Registry, Skater, calls } = createModels([])

    const result = await backfillRegistryCountries({ Registry, Skater, apply: true })

    assert.deepEqual(result, {
        apply: true,
        colombianSkaters: 0,
        spanishRecords: 12,
        colombianRecords: 0,
        totalRecords: 12,
        spanishModified: 10,
        colombianModified: 0
    })
    assert.deepEqual(calls.update, [
        { filter: {}, update: { $set: { country: 'ES' } } },
        { filter: { _id: { $exists: false } }, update: { $set: { country: 'CO' } } }
    ])
})
