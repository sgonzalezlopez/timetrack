const path = require('path')
const { randomBytes } = require('crypto')
const Registry = require('../models/registry.model')
const Competition = require('../models/competition.model')
const Skater = require('../models/skater.model')
const Club = require('../models/club.model')
const Category = require('../models/category.model')
const authorization = require(path.join(__corePath, 'middlewares/authorization'))
const filter = require('../middlewares/data.filter')
const { normalize, candidatesFor, validateRow, completeRow } = require('../utils/registry-import')

const previews = new Map()
const lifetime = 30 * 60 * 1000
const owner = req => String(req.user._id || req.user.id)
const formats = req => req.app.locals.registryImportFormats || []
const error = (res, status, key) => res.status(status).send({ message: res.__(key) })

exports.formats = (req, res) => {
    res.send(formats(req).map(({ id, label, extensions }) => ({ id, label, extensions })))
}

exports.preview = async (req, res, next) => {
    try {
        for (const [token, entry] of previews) if (entry.expires < Date.now() && !entry.busy) previews.delete(token)
        if (previews.size >= 50) return error(res, 429, 'IMPORT_BUSY')
        const format = formats(req).find(f => f.id === req.body.format)
        const file = req.files && req.files.file
        if (!format || !file || Array.isArray(file) || !file.data ||
            file.size > 10 * 1024 * 1024 ||
            !format.extensions.includes(path.extname(file.name).toLowerCase())) {
            return error(res, 400, 'IMPORT_INVALID_FILE')
        }
        const competition = await Competition.findById(req.params.id)
        if (!competition) return error(res, 404, 'ITEM_NOT_FOUND')
        let rows
        try {
            rows = await format.parse(file.data)
        } catch (err) {
            console.error('Import parser:', err)
            return error(res, 400, 'IMPORT_INVALID_FILE')
        }
        if (!Array.isArray(rows) || !rows.length || rows.length > 5000) return error(res, 400, 'IMPORT_INVALID_FILE')
        const [skaters, clubs, categories, skaterPermissions, clubPermissions, registryPermissions] = await Promise.all([
            Skater.find(filter.getFilter('Skater', {}, req.user)),
            Club.find(filter.getFilter('Club', {}, req.user)),
            Category.find(),
            authorization.getPermissionsForEntity('skater', req.user),
            authorization.getPermissionsForEntity('club', req.user),
            authorization.getPermissionsForEntity('registry', req.user)
        ])
        const createSkaters = req.body.createSkaters === 'true' && skaterPermissions.includes('C')
        if (req.body.createSkaters === 'true' && !createSkaters) return error(res, 403, 'ERR005')
        const visibleRegistryFilter = filter.getFilter('Registry', {}, req.user)
        const prepared = []
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            const issue = row.team || (row.status && row.status !== 'OK') ? 'IMPORT_SPECIAL_RESULT' :
                validateRow(row, { allowMissing: true })
            const match = issue ? { candidates: [], automatic: false } : candidatesFor(row, skaters)
            const club = clubs.find(c => row.clubName && normalize(c.name) === normalize(row.clubName)) ||
                clubs.find(c => c.name === 'UNKNOWN')
            const knownClub = clubs.some(c => row.clubName && normalize(c.name) === normalize(row.clubName))
            const category = categories.find(c => row.category && c.name && normalize(c.name) === normalize(row.category))
            const duplicates = row.source && row.externalReference ?
                await Registry.find({ source: row.source, externalReference: row.externalReference }) : []
            const visibleDuplicates = row.source && row.externalReference ?
                await Registry.find({ ...visibleRegistryFilter, source: row.source, externalReference: row.externalReference }) : []
            const canReplace = registryPermissions.includes('U') && duplicates.length === 1 &&
                visibleDuplicates.some(d => String(d._id) === String(duplicates[0]._id)) &&
                String(duplicates[0].competition) === String(competition._id)
            prepared.push({
                index: i, row, issue, candidates: match.candidates.map(s => ({
                    id: String(s._id), name: `${s.name} ${s.lastname || ''}`.trim(),
                    birthDate: s.birthDate, category: s.currentcategory
                })),
                automaticSkater: match.automatic ? String(match.candidates[0]._id) : null,
                clubId: club ? String(club._id) : null, unknownClub: !knownClub,
                category: category ? category.name : null, duplicate: duplicates.length > 0,
                duplicateId: canReplace ? String(duplicates[0]._id) : null,
                warnings: [
                    ...(!knownClub ? ['IMPORT_UNKNOWN_CLUB'] : []),
                    ...(!row.source || !row.externalReference ? ['IMPORT_NO_REFERENCE'] : [])
                ]
            })
        }
        const token = randomBytes(24).toString('hex')
        previews.set(token, {
            owner: owner(req), competition: String(competition._id), rows: prepared, createSkaters,
            canCreateClub: clubPermissions.includes('C'), expires: Date.now() + lifetime, busy: false
        })
        res.send({
            token, createSkaters,
            categories: categories.map(c => c.name).sort(),
            rows: prepared.map(({ row, ...p }) => ({
                ...p, skaterName: row.skaterName, gender: row.gender, race: row.race,
                date: row.date, inputCategory: row.category || '',
                distance: row.distance, dateText: row.dateText,
                requiredInputs: row.requiredInputs || [], sourceLocation: row.sourceLocation,
                competitionMismatch: row.competitionName && normalize(row.competitionName) !== normalize(competition.name)
            }))
        })
    } catch (err) { next(err) }
}

exports.commit = async (req, res, next) => {
    const entry = previews.get(req.body.token)
    if (!entry || entry.owner !== owner(req) || entry.competition !== req.params.id ||
        entry.expires < Date.now() || entry.busy) return error(res, 409, 'IMPORT_EXPIRED')
    const choices = req.body.choices
    if (!Array.isArray(choices) || choices.length !== entry.rows.length) return error(res, 400, 'IMPORT_INVALID_CHOICES')
    entry.busy = true
    try {
        if (!await Competition.exists({ _id: entry.competition })) return error(res, 404, 'ITEM_NOT_FOUND')
        const categoryNames = new Set((await Category.find()).map(c => c.name))
        const plans = []
        for (let i = 0; i < entry.rows.length; i++) {
            const p = entry.rows[i], choice = choices[i]
            if (!choice) return error(res, 400, 'IMPORT_INVALID_CHOICES')
            if (choice.action === 'skip' || p.issue) { plans.push(null); continue }
            const resolvedRow = completeRow(p.row, choice)
            const rowIssue = validateRow(resolvedRow)
            if (rowIssue) return error(res, 400, rowIssue)
            if (choice.action !== 'import' && choice.action !== 'replace') return error(res, 400, 'IMPORT_INVALID_CHOICES')
            if (p.duplicate && (choice.action !== 'replace' || !p.duplicateId)) return error(res, 400, 'IMPORT_INVALID_CHOICES')
            if (!p.duplicate && choice.action !== 'import') return error(res, 400, 'IMPORT_INVALID_CHOICES')
            const skaterId = p.automaticSkater || choice.skaterId
            if (skaterId !== 'new' && !p.candidates.some(c => c.id === skaterId)) return error(res, 400, 'IMPORT_INVALID_CHOICES')
            if (skaterId === 'new' && !entry.createSkaters) return error(res, 403, 'ERR005')
            const category = p.category || choice.category
            if (!categoryNames.has(category)) return error(res, 400, 'IMPORT_INVALID_CHOICES')
            if (!p.clubId && !entry.canCreateClub) return error(res, 403, 'ERR005')
            plans.push({ p, skaterId, category, resolvedRow })
        }
        // Revalidate permissions at confirmation, not just at preview time.
        const [sp, cp, rp] = await Promise.all([
            authorization.getPermissionsForEntity('skater', req.user),
            authorization.getPermissionsForEntity('club', req.user),
            authorization.getPermissionsForEntity('registry', req.user)
        ])
        if (plans.some(p => p && p.skaterId === 'new') && !sp.includes('C') ||
            plans.some(p => p && !p.p.clubId) && !cp.includes('C') ||
            plans.some(p => p && p.p.duplicate) && !rp.includes('U')) return error(res, 403, 'ERR005')
        const report = { imported: [], skipped: [], failed: [], createdSkaters: [] }
        const newlyCreated = new Map()
        for (let i = 0; i < plans.length; i++) {
            const plan = plans[i], original = entry.rows[i]
            const item = { row: original.row.sourceLocation || i + 2, name: original.row.skaterName }
            if (!plan) {
                report.skipped.push({ ...item, reason: original.issue || 'IMPORT_SKIPPED' })
                continue
            }
            const { p, category, resolvedRow } = plan
            try {
                const duplicateFilter = p.row.source && p.row.externalReference ?
                    { source: p.row.source, externalReference: p.row.externalReference } : null
                const existing = duplicateFilter ? await Registry.find(duplicateFilter) : []
                if (existing.length && (!p.duplicateId || existing.length !== 1 ||
                    String(existing[0]._id) !== p.duplicateId)) {
                    report.skipped.push({ ...item, reason: 'IMPORT_DUPLICATE' })
                    continue
                }
                let clubId = p.clubId
                if (clubId && !await Club.exists({ $and: [filter.getFilter('Club', {}, req.user), { _id: clubId }] })) throw new Error('IMPORT_ACCESS_CHANGED')
                if (!clubId) {
                    const club = await Club.findOneAndUpdate({ name: 'UNKNOWN' },
                        { $setOnInsert: { name: 'UNKNOWN' } }, { upsert: true, new: true })
                    clubId = club._id
                }
                let skaterId = plan.skaterId
                if (skaterId === 'new') {
                    const key = `${normalize(p.row.skaterName)}:${p.row.gender}`
                    skaterId = newlyCreated.get(key)
                    if (!skaterId) {
                        // Split only for the required database fields; preserve the full input name.
                        const parts = p.row.skaterName.trim().split(/\s+/)
                        const skater = await Skater.create({
                            name: parts.shift(), lastname: parts.join(' ') || '-',
                            gender: p.row.gender, country: p.row.country,
                            currentclub: clubId, currentcategory: category
                        })
                        skaterId = skater._id
                        newlyCreated.set(key, skaterId)
                        report.createdSkaters.push({ ...item, id: skaterId })
                    }
                } else if (!await Skater.exists({ $and: [filter.getFilter('Skater', {}, req.user), { _id: skaterId }] })) {
                    throw new Error('IMPORT_ACCESS_CHANGED')
                }
                const values = {
                    competition: entry.competition, skater: skaterId, club: clubId, category,
                    date: resolvedRow.date, race: p.row.race, distance: resolvedRow.distance,
                    times: p.row.times, rail: p.row.rail, starting: p.row.starting,
                    source: p.row.source, externalReference: p.row.externalReference
                }
                if (p.duplicateId && existing.length) {
                    const updated = await Registry.findOneAndUpdate(
                        filter.getFilter('Registry', { _id: p.duplicateId, competition: entry.competition }, req.user),
                        { $set: values }, { new: true, runValidators: true })
                    if (!updated) throw new Error('IMPORT_ACCESS_CHANGED')
                } else await Registry.create(values)
                report.imported.push({
                    ...item, category, replaced: !!p.duplicateId,
                    unknownClub: p.unknownClub, categorySubstituted: !p.category, warnings: p.warnings
                })
            } catch (err) {
                console.error('Import row:', i + 2, err)
                report.failed.push({ ...item, reason: err.code === 11000 ? 'IMPORT_DUPLICATE' : 'IMPORT_ROW_FAILED' })
            }
        }
        previews.delete(req.body.token)
        res.send(report)
    } catch (err) { next(err) }
    finally { entry.busy = false }
}
