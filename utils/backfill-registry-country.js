const { countryFilter } = require('./registry-country')

async function backfillRegistryCountries({ Registry, Skater, apply = false }) {
    const colombianSkaters = await Skater.find({ country: countryFilter('CO') }).select('_id').lean()
    const colombianIds = colombianSkaters.map(skater => skater._id)
    const spanishFilter = colombianIds.length ? { skater: { $nin: colombianIds } } : {}
    const colombianFilter = colombianIds.length ? { skater: { $in: colombianIds } } : { _id: { $exists: false } }

    const [spanishRecords, colombianRecords] = await Promise.all([
        Registry.countDocuments(spanishFilter),
        Registry.countDocuments(colombianFilter)
    ])

    const result = {
        apply,
        colombianSkaters: colombianIds.length,
        spanishRecords,
        colombianRecords,
        totalRecords: spanishRecords + colombianRecords
    }

    if (!apply) return result

    const [spanishUpdate, colombianUpdate] = await Promise.all([
        Registry.updateMany(spanishFilter, { $set: { country: 'ES' } }),
        Registry.updateMany(colombianFilter, { $set: { country: 'CO' } })
    ])

    return {
        ...result,
        spanishModified: spanishUpdate.modifiedCount || 0,
        colombianModified: colombianUpdate.modifiedCount || 0
    }
}

module.exports = { backfillRegistryCountries }
