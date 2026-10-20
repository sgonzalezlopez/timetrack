const path = require('path')
const { randomBytes } = require('crypto')
const Registry = require('../models/registry.model')
const Competition = require('../models/competition.model')
const Skater = require('../models/skater.model')
const Club = require('../models/club.model')
const Category = require('../models/category.model')
const Track = require('../models/track.model')
const authorization = require(path.join(__corePath, 'middlewares/authorization'))
const filter = require('../middlewares/data.filter')
const { normalize, candidatesFor, validateRow, completeRow } = require('../utils/registry-import')
const { destinationFor } = require('../utils/registry-import-events')
const { resultDetails, resultKey, sameReference, fingerprint } = require('../utils/registry-import-duplicates')

const previews = new Map()
const lifetime = 30 * 60 * 1000
const owner = req => String(req.user._id || req.user.id)
const formats = req => req.app.locals.registryImportFormats || []
const error = (res, status, key) => res.status(status).send({ message: res.__(key) })

async function duplicatesFor(plan, competitionId) {
    const row = plan.resolvedRow
    const reference = row.source && row.externalReference ?
        await Registry.find({ source: row.source, externalReference: row.externalReference }) : []
    let matching = []
    if (competitionId && plan.skaterId !== 'new') {
        const from = new Date(row.date)
        from.setUTCHours(0, 0, 0, 0)
        const to = new Date(from)
        to.setUTCDate(to.getUTCDate() + 1)
        const records = await Registry.find({
            competition: competitionId, skater: plan.skaterId, distance: row.distance,
            date: { $gte: from, $lt: to }
        })
        matching = records.filter(record => resultKey(record, String(record.skater), String(record.competition)) ===
            resultKey(row, plan.skaterId, competitionId))
    }
    return [...new Map([...reference, ...matching].map(record => [String(record._id), record])).values()]
}

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
        const competition = req.params.id ? await Competition.findById(req.params.id) : null
        if (req.params.id && !competition) return error(res, 404, 'ITEM_NOT_FOUND')
        const seasonStartMonth = req.app.locals.registryImportSeasonStartMonth || 1
        const [tracks, competitions] = competition ? [[], []] : await Promise.all([
            Track.find(filter.getFilter('Track', {}, req.user)),
            Competition.find(filter.getFilter('Competition', {}, req.user))
        ])
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
            let issue = row.team || (row.status && row.status !== 'OK') ? 'IMPORT_SPECIAL_RESULT' :
                validateRow(row, { allowMissing: true })
            const destination = !competition && !issue ?
                destinationFor(row, null, tracks, competitions, seasonStartMonth) : null
            if (destination && destination.issue && destination.issue !== 'IMPORT_CHOOSE_TRACK') issue = destination.issue
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
                String(duplicates[0].competition) === (competition ? String(competition._id) : destination && destination.competitionId)
            prepared.push({
                index: i, row, issue, destination, candidates: match.candidates.map(s => ({
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
            owner: owner(req), competition: competition ? String(competition._id) : null,
            competitionName: competition ? competition.name : null,
            seasonStartMonth, rows: prepared, createSkaters,
            duplicateReviews: new Map(),
            skaterNames: new Map(skaters.map(s => [String(s._id), `${s.name} ${s.lastname || ''}`.trim()])),
            clubNames: new Map(clubs.map(c => [String(c._id), c.name])),
            canCreateClub: clubPermissions.includes('C'), expires: Date.now() + lifetime, busy: false
        })
        res.send({
            token, createSkaters, seasonStartMonth,
            tracks: tracks.map(t => ({ id: String(t._id), name: t.name, location: t.location })),
            categories: categories.map(c => c.name).sort(),
            rows: prepared.map(({ row, ...p }) => ({
                ...p, skaterName: row.skaterName, gender: row.gender, race: row.race,
                date: row.date, inputCategory: row.category || '',
                distance: row.distance, dateText: row.dateText,
                requiredInputs: row.requiredInputs || [], sourceLocation: row.sourceLocation,
                competitionName: row.competitionName, trackName: row.trackName,
                competitionMismatch: competition && row.competitionName && normalize(row.competitionName) !== normalize(competition.name)
            }))
        })
    } catch (err) { next(err) }
}

exports.commit = async (req, res, next) => {
    const entry = previews.get(req.body.token)
    if (!entry || entry.owner !== owner(req) || entry.competition !== (req.params.id || null) ||
        entry.expires < Date.now() || entry.busy) return error(res, 409, 'IMPORT_EXPIRED')
    const choices = req.body.choices
    if (!Array.isArray(choices) || choices.length !== entry.rows.length) return error(res, 400, 'IMPORT_INVALID_CHOICES')
    entry.busy = true
    try {
        if (entry.competition && !await Competition.exists({ _id: entry.competition })) return error(res, 404, 'ITEM_NOT_FOUND')
        const [tracks, competitions] = entry.competition ? [[], []] : await Promise.all([
            Track.find(filter.getFilter('Track', {}, req.user)),
            Competition.find(filter.getFilter('Competition', {}, req.user))
        ])
        const categoryNames = new Set((await Category.find()).map(c => c.name))
        const plans = []
        for (let i = 0; i < entry.rows.length; i++) {
            const p = entry.rows[i], choice = choices[i]
            if (!choice) return error(res, 400, 'IMPORT_INVALID_CHOICES')
            if (choice.action === 'skip' || p.issue) { plans.push(null); continue }
            const resolvedRow = completeRow(p.row, choice)
            const rowIssue = validateRow(resolvedRow)
            if (rowIssue) return error(res, 400, rowIssue)
            const destination = entry.competition ? null :
                destinationFor(resolvedRow, choice.trackId, tracks, competitions, entry.seasonStartMonth)
            if (destination && destination.issue) return error(res, 400, destination.issue)
            if (choice.action !== 'import' && choice.action !== 'replace') return error(res, 400, 'IMPORT_INVALID_CHOICES')
            if (p.duplicate && !p.duplicateId) return error(res, 400, 'IMPORT_INVALID_CHOICES')
            if (!p.duplicate && choice.action !== 'import') return error(res, 400, 'IMPORT_INVALID_CHOICES')
            const skaterId = p.automaticSkater || choice.skaterId
            if (skaterId !== 'new' && !p.candidates.some(c => c.id === skaterId)) return error(res, 400, 'IMPORT_INVALID_CHOICES')
            if (skaterId === 'new' && !entry.createSkaters) return error(res, 403, 'ERR005')
            const category = p.category || choice.category
            if (!categoryNames.has(category)) return error(res, 400, 'IMPORT_INVALID_CHOICES')
            if (!p.clubId && !entry.canCreateClub) return error(res, 403, 'ERR005')
            if (p.duplicate && destination && destination.competitionId !== p.destination.competitionId) {
                return error(res, 400, 'IMPORT_INVALID_CHOICES')
            }
            plans.push({ p, skaterId, category, resolvedRow, destination,
                replaceId: choice.action === 'replace' ? p.duplicateId : null })
        }
        // Revalidate permissions at confirmation, not just at preview time.
        const [sp, cp, rp, ep, tp] = await Promise.all([
            authorization.getPermissionsForEntity('skater', req.user),
            authorization.getPermissionsForEntity('club', req.user),
            authorization.getPermissionsForEntity('registry', req.user),
            authorization.getPermissionsForEntity('competition', req.user),
            authorization.getPermissionsForEntity('track', req.user)
        ])
        if (plans.some(p => p && p.skaterId === 'new') && !sp.includes('C') ||
            plans.some(p => p && !p.p.clubId) && !cp.includes('C') ||
            plans.some(p => p && p.p.duplicate) && !rp.includes('U') || !rp.includes('C') ||
            !entry.competition && (!ep.includes('R') || !tp.includes('R') ||
                plans.some(p => p && p.destination.createEvent) && !ep.includes('C') ||
                plans.some(p => p && p.destination.createTrack) && !tp.includes('C'))) return error(res, 403, 'ERR005')
        const conflicts = [], previous = []
        for (let i = 0; i < plans.length; i++) {
            const plan = plans[i]
            if (!plan) continue
            const choice = choices[i], row = plan.resolvedRow
            const competitionId = entry.competition || plan.destination.competitionId
            const eventKey = competitionId || JSON.stringify([
                normalize(row.competitionName), plan.destination.trackId || normalize(row.trackName), plan.destination.season
            ])
            const skaterKey = plan.skaterId === 'new' ? `${normalize(row.skaterName)}:${row.gender}` : plan.skaterId
            const key = resultKey(row, skaterKey, eventKey)
            const candidates = await duplicatesFor(plan, competitionId)
            const visible = candidates.length ? await Registry.find({
                ...filter.getFilter('Registry', {}, req.user), _id: { $in: candidates.map(c => c._id) }
            }) : []
            const visibleIds = new Set(visible.map(c => String(c._id)))
            const external = candidates.map(c => resultDetails(c, String(c._id)))
            const pending = previous.filter(p => p.key === key || sameReference(p.row, row))
            const existing = [
                ...candidates.filter(c => visibleIds.has(String(c._id))).map(c => ({
                    ...resultDetails(c, String(c._id)), competition: String(c.competition),
                    name: entry.skaterNames.get(String(c.skater)) || String(c.skater || ''),
                    clubName: entry.clubNames.get(String(c.club)) || String(c.club || '')
                })),
                ...pending.map(p => ({ ...resultDetails(p.row, `file:${p.index}`), name: p.row.skaterName,
                    clubName: entry.clubNames.get(p.row.club) || 'UNKNOWN', fromFile: true, row: p.index + 2 }))
            ]
            const displayRow = { ...row, category: plan.category, skater: plan.skaterId, club: plan.p.clubId }
            const incoming = { ...resultDetails(displayRow, `file:${i}`),
                name: row.skaterName, clubName: entry.clubNames.get(plan.p.clubId) || 'UNKNOWN', competition: eventKey }
            plan.duplicateDetails = external
            if (candidates.length || pending.length) {
                const hidden = candidates.some(c => !visibleIds.has(String(c._id)))
                const references = candidates.filter(c => sameReference(c, row))
                const replaceable = hidden || pending.some(p => sameReference(p.row, row)) ? [] :
                    (references.length ? references : candidates).filter(c => visibleIds.has(String(c._id)) &&
                    String(c.competition) === competitionId && rp.includes('U')).map(c => String(c._id))
                const canKeep = !hidden && !candidates.some(c => sameReference(c, row)) &&
                    !pending.some(p => sameReference(p.row, row))
                const current = fingerprint(incoming, [...external, ...pending.map(p => resultDetails(p.row, `file:${p.index}`))])
                const review = entry.duplicateReviews.get(i)
                if (!review || review.fingerprint !== current || choice.duplicateReviewToken !== review.token) {
                    const token = randomBytes(24).toString('hex')
                    entry.duplicateReviews.set(i, { token, fingerprint: current })
                    conflicts.push({ index: i, row: row.sourceLocation || i + 2, incoming, existing,
                        eventName: entry.competitionName || plan.destination.name,
                        hidden, replaceable, canKeep, token })
                } else if (choice.duplicateAction === 'skip') {
                    plans[i] = null
                    continue
                } else if (choice.duplicateAction === 'replace' && replaceable.includes(choice.duplicateId)) {
                    plan.replaceId = choice.duplicateId
                } else if (choice.duplicateAction !== 'keep' || !canKeep) {
                    return error(res, 400, 'IMPORT_INVALID_CHOICES')
                }
            }
            plan.duplicateIncoming = incoming
            previous.push({ key, row: displayRow, index: i })
        }
        if (conflicts.length) return res.status(409).send({
            code: 'IMPORT_DUPLICATE_REVIEW', message: res.__('IMPORT_DUPLICATE_REVIEW'), conflicts
        })
        const report = { imported: [], skipped: [], failed: [], createdSkaters: [] }
        if (!entry.competition) Object.assign(report, { createdEvents: [], createdTracks: [] })
        const newlyCreated = new Map()
        const importedIds = new Set()
        for (let i = 0; i < plans.length; i++) {
            const plan = plans[i], original = entry.rows[i]
            const item = { row: original.row.sourceLocation || i + 2, name: original.row.skaterName }
            if (!plan) {
                report.skipped.push({ ...item, reason: original.issue || 'IMPORT_SKIPPED' })
                continue
            }
            const { p, category, resolvedRow } = plan
            try {
                let competitionId = entry.competition
                if (!competitionId) {
                    const destination = destinationFor(resolvedRow, plan.destination.trackId,
                        tracks, competitions, entry.seasonStartMonth)
                    if (destination.issue) throw new Error(destination.issue)
                    let trackId = destination.trackId
                    if (!trackId) {
                        const result = await Track.findOneAndUpdate(
                            { importName: normalize(p.row.trackName) },
                            { $setOnInsert: { name: p.row.trackName, location: p.row.trackLocation || '' } },
                            { upsert: true, new: true, runValidators: true, rawResult: true })
                        const track = result.value
                        trackId = String(track._id)
                        tracks.push(track)
                        if (!result.lastErrorObject.updatedExisting) {
                            report.createdTracks.push({ ...item, id: trackId, name: track.name })
                        }
                    }
                    competitionId = destination.competitionId
                    if (!competitionId) {
                        const result = await Competition.findOneAndUpdate({
                            importCompetitionName: normalize(p.row.competitionName),
                            track: trackId, season: destination.season, training: false
                        }, { $setOnInsert: {
                            name: destination.trackName, date: resolvedRow.date
                        } }, { upsert: true, new: true, runValidators: true, rawResult: true })
                        const competition = result.value
                        competitionId = String(competition._id)
                        competitions.push(competition)
                        if (!result.lastErrorObject.updatedExisting) {
                            report.createdEvents.push({ ...item, id: competitionId, name: competition.name,
                                season: competition.season, date: competition.date })
                        }
                    }
                }
                const currentDuplicates = (await duplicatesFor(plan, competitionId))
                    .filter(record => !importedIds.has(String(record._id)))
                if (fingerprint(plan.duplicateIncoming, currentDuplicates.map(c => resultDetails(c, String(c._id)))) !==
                    fingerprint(plan.duplicateIncoming, plan.duplicateDetails.filter(c => !importedIds.has(c.id)))) {
                    report.failed.push({ ...item, reason: 'IMPORT_DUPLICATE_CHANGED' })
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
                    competition: competitionId, skater: skaterId, club: clubId, category,
                    date: resolvedRow.date, race: p.row.race, distance: resolvedRow.distance,
                    times: p.row.times, rail: p.row.rail, starting: p.row.starting,
                    source: p.row.source, externalReference: p.row.externalReference
                }
                let saved
                if (plan.replaceId) {
                    const updated = await Registry.findOneAndUpdate(
                        filter.getFilter('Registry', { _id: plan.replaceId, competition: competitionId }, req.user),
                        { $set: values }, { new: true, runValidators: true })
                    if (!updated) throw new Error('IMPORT_ACCESS_CHANGED')
                    saved = updated
                } else saved = await Registry.create(values)
                importedIds.add(String(saved._id))
                report.imported.push({
                    ...item, category, replaced: !!plan.replaceId,
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
