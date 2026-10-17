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

function validateRow(row) {
    if (typeof row.skaterName !== 'string' || !row.skaterName.trim() || !['F', 'M'].includes(row.gender)) return 'IMPORT_INVALID_SKATER'
    if (!row.date || !Number.isFinite(new Date(row.date).getTime())) return 'IMPORT_INVALID_DATE'
    if (!row.race || !Number.isFinite(row.distance) || row.distance <= 0) return 'IMPORT_INVALID_RACE'
    if (!Array.isArray(row.times) || !row.times.length ||
        row.times.some(t => !Number.isFinite(t) || t <= 0)) return 'IMPORT_INVALID_TIMES'
    if (row.totalTime != null && (!Number.isFinite(row.totalTime) ||
        Math.abs(row.times.reduce((sum, t) => sum + t, 0) - row.totalTime) > 1)) return 'IMPORT_INVALID_TIMES'
    return null
}

module.exports = { normalize, candidatesFor, validateRow }
