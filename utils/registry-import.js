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

function clubKey(value) {
    return normalize(value).split(' ').filter(word =>
        !['club', 'patin', 'patinaje', 'patinatge', 'patinagem', 'c', 'p', 'cp', 'cpv'].includes(word)).join('')
}

function similarClub(left, right) {
    if (normalize(left) && normalize(left).replace(/ /g, '') === normalize(right).replace(/ /g, '')) return true
    const a = clubKey(left), b = clubKey(right)
    if (!a || !b) return false
    if (a === b) return true
    if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > Math.floor(Math.max(a.length, b.length) / 10)) return false
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        const current = [i]
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
        }
        previous = current
    }
    return previous[b.length] / Math.max(a.length, b.length) <= 0.1
}

function resolveClub(input, skater, clubs) {
    const profile = skater && clubs.find(c => String(c._id) === String(skater.currentclub) && normalize(c.name) !== 'unknown')
    const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : ''
    const missing = !normalize(name) || ['unknown', 'desconocido', 'sin club', 'n a', 'na', 'null', 'undefined'].includes(normalize(name))
    const result = (club, source) => ({ id: String(club._id), name: club.name, source, create: false, unknown: normalize(club.name) === 'unknown' })
    const names = club => [club.name, club.shortName].filter(Boolean)
    if (profile && (missing || names(profile).some(alias => similarClub(name, alias)))) return result(profile, 'profile')
    if (!missing) {
        const exact = clubs.filter(c => names(c).some(alias => normalize(alias) === normalize(name)))
        if (exact.length === 1) return result(exact[0], 'file')
        const similar = exact.length ? exact : clubs.filter(c => names(c).some(alias => similarClub(name, alias)))
        if (similar.length === 1) return result(similar[0], 'file')
        if (!similar.length) return { id: null, name, source: 'file', create: true, unknown: false }
        if (profile) return result(profile, 'profile')
    }
    const unknown = clubs.find(c => normalize(c.name) === 'unknown')
    return unknown ? result(unknown, 'unknown') : { id: null, name: 'UNKNOWN', source: 'unknown', create: true, unknown: true }
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

module.exports = { normalize, candidatesFor, validateRow, completeRow, resolveClub }
