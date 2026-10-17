const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')

function nameTokens(value) {
    return normalize(value).split(' ').filter(Boolean).sort()
}

function candidatesFor(row, skaters) {
    const tokens = nameTokens(row.skaterName)
    const key = tokens.join(' ')
    const sameGender = skaters.filter(s => s.gender === row.gender)
    const exact = sameGender.filter(s => nameTokens(`${s.name} ${s.lastname || ''}`).join(' ') === key)
    if (exact.length) return { candidates: exact, automatic: exact.length === 1 }
    const candidates = sameGender.filter(s => {
        const other = nameTokens(`${s.name} ${s.lastname || ''}`)
        const shared = tokens.filter(t => other.includes(t)).length
        return shared >= 2 && shared >= Math.min(tokens.length, other.length) - 1
    })
    return { candidates, automatic: false }
}

function completeRow(row, choice) {
    return {
        ...row,
        date: row.requiredInputs && row.requiredInputs.includes('date') && !row.date ? choice.date : row.date,
        distance: row.requiredInputs && row.requiredInputs.includes('distance') && row.distance == null ?
            (choice.distance === '' || choice.distance == null ? null : Number(choice.distance)) : row.distance
    }
}

function validateRow(row, { allowMissing = false } = {}) {
    if (typeof row.skaterName !== 'string' || !row.skaterName.trim() || !['F', 'M'].includes(row.gender)) return 'IMPORT_INVALID_SKATER'
    const missingDate = allowMissing && !row.date && row.requiredInputs && row.requiredInputs.includes('date')
    const missingDistance = allowMissing && row.distance == null && row.requiredInputs && row.requiredInputs.includes('distance')
    if (!missingDate && (!row.date || !Number.isFinite(new Date(row.date).getTime()))) return 'IMPORT_INVALID_DATE'
    if (row.requiredInputs && row.requiredInputs.includes('date') && !missingDate &&
        (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        new Date(row.date).toISOString().slice(0, 10) !== row.date)) return 'IMPORT_INVALID_DATE'
    if (!row.race || !missingDistance && (!Number.isFinite(row.distance) || row.distance <= 0)) return 'IMPORT_INVALID_RACE'
    if (Array.isArray(row.times) && !row.times.length) return 'IMPORT_MISSING_TIMES'
    if (!Array.isArray(row.times) || !row.times.length ||
        row.times.some(t => !Number.isFinite(t) || t <= 0)) return 'IMPORT_INVALID_TIMES'
    if (row.totalTime != null && (!Number.isFinite(row.totalTime) ||
        Math.abs(row.times.reduce((sum, t) => sum + t, 0) - row.totalTime) > 1)) return 'IMPORT_INVALID_TIMES'
    return null
}

module.exports = { normalize, candidatesFor, validateRow, completeRow }
