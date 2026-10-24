const { createHash } = require('crypto')
const { normalize } = require('./registry-import')

function resultDetails(row, id) {
    return {
        id, date: row.date ? new Date(row.date).toISOString() : null,
        race: row.race, distance: row.distance, times: row.times,
        totalTime: Array.isArray(row.times) ? row.times.reduce((sum, time) => sum + time, 0) : null,
        category: row.category, country: row.country || null, rail: row.rail || '', starting: row.starting || '',
        skater: row.skater == null ? null : String(row.skater),
        club: row.club == null ? null : String(row.club),
        source: row.source || '', externalReference: row.externalReference || ''
    }
}

function resultKey(row, skater, competition) {
    const details = resultDetails(row)
    return JSON.stringify([competition, skater, details.date && details.date.slice(0, 10),
        normalize(details.race), details.distance, details.totalTime])
}

function sameReference(a, b) {
    return !!a.source && !!a.externalReference && a.source === b.source && a.externalReference === b.externalReference
}

function fingerprint(incoming, existing) {
    return createHash('sha256').update(JSON.stringify([incoming,
        [...existing].sort((a, b) => a.id.localeCompare(b.id))])).digest('hex')
}

module.exports = { resultDetails, resultKey, sameReference, fingerprint }
