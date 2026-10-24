const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { normalize, candidatesFor, validateRow, completeRow, resolveClub } = require('../utils/registry-import')
const { seasonFor, destinationFor } = require('../utils/registry-import-events')

const row = () => ({
    skaterName: 'Ona Rodríguez Cornejo', gender: 'F', date: '2026-10-17',
    race: 'Vrouwen 500 meter', distance: 500, times: [11148, 29884], totalTime: 41032,
    category: 'LA2', clubName: 'RFEDH', source: 'netherlands', externalReference: 'source-row-1'
})

test('normalizes accents, punctuation, whitespace and name order, respecting gender', () => {
    assert.equal(normalize('  RODRÍGUEZ,  Ona '), 'rodriguez ona')
    const skaters = [
        { _id: 'f', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F' },
        { _id: 'm', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'M' }
    ]
    assert.deepEqual(candidatesFor({ ...row(), skaterName: 'CORNEJO Rodríguez, Ona' }, skaters),
        { candidates: [skaters[0]], automatic: true })
    assert.equal(candidatesFor(row(), [...skaters, { ...skaters[0], _id: 'other' }]).automatic, false)
    const relaxed = candidatesFor({ ...row(), skaterName: 'Ona Rodríguez' }, skaters)
    assert.equal(relaxed.candidates.length, 1)
    assert.equal(relaxed.automatic, false)
})

test('club resolution reuses the profile for spelling variations, abbreviations and missing file clubs', () => {
    const clubs = [{ _id: 'siero', name: 'CLUB PATIN SIERO' }, { _id: 'unknown', name: 'UNKNOWN' }]
    const skater = { currentclub: 'siero' }
    for (const name of ['Club Patín Siero', 'C.P. SIERO', 'CP SIERO', 'SIERO', '', null, 'UNKNOWN', '---', 'sin club']) {
        const resolved = resolveClub(name, skater, clubs)
        assert.equal(resolved.id, 'siero', String(name))
        assert.equal(resolved.create, false)
        assert.equal(resolved.source, 'profile')
    }
    const longClubs = [{ _id: 'long', name: 'CLUB PATIN VELOCIDAD ASTURIAS' }]
    assert.equal(resolveClub('CLUB PATIN VELOCIDAD ASTURIAS', { currentclub: 'long' }, longClubs).id, 'long')
    assert.equal(resolveClub('CLUB PATIN VELOCIDAD ASTURlAS', { currentclub: 'long' }, longClubs).id, 'long')
    const different = resolveClub('CLUB PATIN SIERA', skater, clubs)
    assert.equal(different.create, true, 'a different short distinctive name is not guessed')
})

test('distinct file clubs are reused or proposed for creation instead of forcing the profile club', () => {
    const clubs = [{ _id: 'siero', name: 'CLUB PATIN SIERO' }, { _id: 'rivas', name: 'CPV RIVAS' }]
    const skater = { currentclub: 'siero' }
    assert.equal(resolveClub('CPV RIVAS', skater, clubs).id, 'rivas')
    const result = resolveClub('  NUEVO   CLUB  ', skater, clubs)
    assert.equal(result.name, 'NUEVO CLUB')
    assert.equal(result.create, true)
    assert.equal(result.unknown, false)
    assert.equal(result.source, 'file')
})

test('club abbreviations use the configured shortName without creating duplicate clubs', () => {
    const clubs = [{ _id: 'siero', name: 'CLUB PATIN SIERO', shortName: 'CPS' }]
    assert.equal(resolveClub('CPS', { currentclub: 'siero' }, clubs).source, 'profile')
    assert.equal(resolveClub('CPS', null, clubs).id, 'siero')
    assert.equal(resolveClub('C.P.S.', null, clubs).id, 'siero')
})

test('new skaters reuse similar database clubs and use UNKNOWN only when neither source identifies a club', () => {
    const clubs = [{ _id: 'siero', name: 'CLUB PATIN SIERO' }, { _id: 'unknown', name: 'UNKNOWN' }]
    assert.equal(resolveClub('CP SIERO', null, clubs).id, 'siero')
    assert.equal(resolveClub('ANOTHER CLUB', null, clubs).create, true)
    assert.equal(resolveClub('', null, clubs).id, 'unknown')
    assert.equal(resolveClub('UNKNOWN', { currentclub: 'missing' }, clubs).id, 'unknown')
    assert.equal(resolveClub('', null, []).name, 'UNKNOWN')
    assert.equal(resolveClub('', null, []).create, true)
})

test('ambiguous similar clubs are never assigned arbitrarily or duplicated', () => {
    const clubs = [{ _id: 'a', name: 'CP SIERO' }, { _id: 'b', name: 'CLUB PATIN SIERO' }]
    assert.equal(resolveClub('SIERO', null, clubs).unknown, true)
    assert.equal(resolveClub('SIERO', { currentclub: 'b' }, clubs).id, 'b')
    assert.equal(resolveClub('CP SIERO', null, clubs).id, 'a')
})

test('validates times, dates, names and distances without inventing zero times', () => {
    assert.equal(validateRow(row()), null)
    assert.equal(validateRow({ ...row(), times: [11148, 29883], totalTime: 42000 }), 'IMPORT_INVALID_TIMES')
    assert.equal(validateRow({ ...row(), times: [0] }), 'IMPORT_INVALID_TIMES')
    assert.equal(validateRow({ ...row(), date: '' }), 'IMPORT_INVALID_DATE')
    assert.equal(validateRow({ ...row(), distance: NaN }), 'IMPORT_INVALID_RACE')
    assert.equal(validateRow({ ...row(), gender: '' }), 'IMPORT_INVALID_SKATER')
})

function harness(input, options = {}) {
    const writes = [], records = options.records || []
    const tracks = options.tracks || []
    const competitions = options.competitions || []
    function upsert(collection, kind, query, update) {
        let value = collection.find(item => Object.entries(query).every(([key, expected]) => item[key] === expected))
        const updatedExisting = !!value
        if (!value) {
            value = { ...query, ...update.$setOnInsert, _id: `${kind}-${collection.length + 1}` }
            collection.push(value)
            writes.push([kind, value])
        }
        return { value, lastErrorObject: { updatedExisting } }
    }
    const skaters = options.skaters || [{ _id: 'skater-1', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F',
        currentcategory: 'LA2', currentclub: 'club-1' }]
    const categories = options.categories || [{ name: 'LA2' }, { name: 'Other' }]
    const club = { _id: 'club-1', name: options.unknownClub ? 'UNKNOWN' : 'RFEDH' }
    const clubs = options.clubs || [club]
    const models = {
        '../models/registry.model': {
            find: async query => {
                if (options.beforeFind) options.beforeFind(query, records)
                return records.filter(r => Object.entries(query).every(([key, expected]) => {
                    if (key === '_id' && expected.$in) return expected.$in.includes(r._id)
                    if (key === 'date') return new Date(r.date) >= expected.$gte && new Date(r.date) < expected.$lt
                    return r[key] === expected
                }))
            },
            create: async values => {
                writes.push(['registry', values])
                const saved = { ...values, _id: `new-registry-${records.length}` }
                records.push(saved)
                return saved
            },
            findOneAndUpdate: async (query, values) => {
                writes.push(['replace', values.$set])
                const saved = records.find(r => r._id === query._id)
                Object.assign(saved, values.$set)
                return saved
            }
        },
        '../models/competition.model': {
            findById: async () => ({ _id: 'event-1', name: 'Holland Cup 1' }),
            exists: async () => true,
            find: async () => [...competitions],
            findOneAndUpdate: async (query, update) => upsert(competitions, 'event', query, update)
        },
        '../models/track.model': {
            find: async () => [...tracks],
            findOneAndUpdate: async (query, update) => upsert(tracks, 'track', query, update)
        },
        '../models/skater.model': {
            find: async () => skaters, exists: async () => true,
            findOneAndUpdate: async (query, update) => {
                const skater = skaters.find(s => s._id === query.$and[1]._id)
                if (!skater) return null
                Object.assign(skater, update.$set)
                writes.push(['skater-category', update.$set])
                return skater
            },
            create: async values => { writes.push(['skater', values]); return { ...values, _id: 'created-skater' } }
        },
        '../models/club.model': {
            find: async () => clubs, exists: async () => true,
            findOneAndUpdate: async (query, update) => upsert(clubs, 'club', query, update)
        },
        '../models/category.model': { find: async () => categories },
        '../middlewares/data.filter': {
            getFilter: (entity, query) => entity === 'Registry' && options.hiddenRecords ?
                { ...query, club: 'club-1' } : query
        },
        '../utils/registry-import': { normalize, candidatesFor, validateRow, completeRow, resolveClub }
    }
    const exports = {}
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/registry-import.controller.js'), 'utf8'), {
        exports, __corePath: 'core', console,
        require: name => models[name] || (name.endsWith('authorization') ?
            { getPermissionsForEntity: async entity => options.permissions && options.permissions[entity] || ['C', 'R', 'U'] } : require(name))
    })
    const req = {
        user: { id: 'user-1' }, params: options.registryScope ? {} : { id: 'event-1' },
        body: { format: 'test', createSkaters: options.createSkaters ? 'true' : 'false',
            categorySource: options.categorySource, clubId: options.clubId },
        files: { file: { name: 'test.xlsx', size: 100, data: Buffer.from('test') } },
        app: { locals: {
            registryImportSeasonStartMonth: options.startMonth || 1,
            registryImportFormats: [{ id: 'test', label: 'Test', extensions: ['.xlsx'], parse: async () => input }]
        } }
    }
    let result, status
    const res = { __: s => s, status: n => { status = n; return res }, send: value => { result = value; return res } }
    const next = err => { throw err }
    return {
        writes, req, tracks, competitions, records, skaters, clubs,
        options: async () => { await exports.options(req, res, next); return { result, status } },
        preview: async () => { await exports.preview(req, res, next); return { result, status } },
        commit: async (token, choices) => {
            result = undefined; status = undefined
            req.body = { token, choices }
            await exports.commit(req, res, next)
            return { result, status }
        }
    }
}

test('infers ice and inline seasons at exact boundaries from the result date', () => {
    for (const [date, ice, inline] of [
        ['2024-02-02', '2023-2024', '2024'],
        ['2024-06-30T23:59:59.999Z', '2023-2024', '2024'],
        ['2024-07-01T00:00:00.000Z', '2024-2025', '2024'],
        ['2024-12-31', '2024-2025', '2024'],
        ['2025-01-01', '2024-2025', '2025']
    ]) {
        assert.equal(seasonFor(date, 7), ice)
        assert.equal(seasonFor(date, 1), inline)
    }
    assert.equal(seasonFor(null, 7), null)
    assert.equal(seasonFor('not a date', 1), null)
})

const eventRow = overrides => ({
    ...row(), competitionName: 'Holland Cup', trackName: 'Thialf', date: '2024-02-02', ...overrides
})
const trackFixture = () => [{ _id: 'track-1', name: 'Thialf' }]
const eventFixture = () => [{
    _id: 'event-1', name: 'Holland Cup', track: 'track-1', season: '2023-2024', training: false
}]
const importChoice = overrides => ({ action: 'import', skaterId: 'skater-1', category: 'LA2', ...overrides })

test('SSN imports preserve the full competition name and reuse a track whose name includes its location', async () => {
    const competitionName = 'International Race - 23/10/2026 (Max Aicher Arena - Inzell)'
    const h = harness([eventRow({
        competitionName, trackName: 'Max Aicher Arena', date: '2026-10-23'
    })], {
        registryScope: true, startMonth: 7,
        tracks: [{ _id: 'inzell', name: 'Max Aicher Arena - Inzell' }]
    })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].destination.trackId, 'inzell')
    assert.equal(preview.rows[0].destination.createTrack, false)
    assert.equal(preview.rows[0].destination.name, competitionName)
    assert.equal(h.writes.length, 0)
    const { result: report } = await h.commit(preview.token, [importChoice()])
    assert.equal(report.imported.length, 1)
    assert.equal(report.createdTracks.length, 0)
    assert.equal(report.createdEvents.length, 1)
    assert.equal(report.createdEvents[0].name, competitionName)
    assert.equal(h.competitions[0].name, competitionName)
    assert.equal(h.competitions[0].track, 'inzell')
    assert.equal(h.competitions[0].season, '2026-2027')
    const again = harness([eventRow({
        competitionName, trackName: 'Max Aicher Arena', date: '2026-10-24', externalReference: 'another-result'
    })], { registryScope: true, startMonth: 7, tracks: h.tracks, competitions: h.competitions })
    const { result: nextPreview } = await again.preview()
    assert.equal(nextPreview.rows[0].destination.competitionId, h.competitions[0]._id)
    assert.equal((await again.commit(nextPreview.token, [importChoice()])).result.createdEvents.length, 0)
})

test('track matching tolerates location suffixes, accents and punctuation but not arbitrary fragments', () => {
    for (const [input, name, location] of [
        ['Max Aicher Arena', 'Max Aicher Arena - Inzell', ''],
        ['Max Aicher Arena - Inzell', 'Max Aicher Arena', ''],
        ['  MAX ÁICHER ARENA ', 'Max Aicher Arena (Inzell)', ''],
        ['Thialf - Heerenveen', 'Thialf', 'Heerenveen']
    ]) {
        const result = destinationFor(eventRow({ trackName: input }), null, [{ _id: 'track-1', name, location }], [], 7)
        assert.equal(result.trackId, 'track-1')
        assert.equal(result.createTrack, false)
    }
    for (const input of ['Arena', 'Aicher Arena', 'Max Aicher Aren']) {
        const result = destinationFor(eventRow({ trackName: input }), null,
            [{ _id: 'inzell', name: 'Max Aicher Arena - Inzell' }], [], 7)
        assert.equal(result.trackId, null)
        assert.equal(result.createTrack, true)
    }
})

test('multiple approximate track matches require selection and never create a new track', async () => {
    const tracks = [
        { _id: 'inzell', name: 'Max Aicher Arena - Inzell' },
        { _id: 'other', name: 'Max Aicher Arena - Other' }
    ]
    const h = harness([eventRow({ trackName: 'Max Aicher Arena' })], { registryScope: true, tracks })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].destination.needsTrack, true)
    assert.equal((await h.commit(preview.token, [importChoice()])).result.message, 'IMPORT_CHOOSE_TRACK')
    assert.equal(h.writes.length, 0)
    const { result: report } = await h.commit(preview.token, [importChoice({ trackId: 'inzell' })])
    assert.equal(report.imported.length, 1)
    assert.equal(report.createdTracks.length, 0)
    assert.equal(h.competitions[0].track, 'inzell')
})

test('exact track matches take precedence over approximate matches and existing imported events are reused', () => {
    const tracks = [
        { _id: 'short', name: 'Max Aicher Arena' },
        { _id: 'inzell', name: 'Max Aicher Arena - Inzell' }
    ]
    const result = destinationFor(eventRow({ trackName: 'Max Aicher Arena' }), null, tracks, [], 7)
    assert.equal(result.trackId, 'short')
    assert.equal(result.needsTrack, false)
    const existing = destinationFor(eventRow(), null, trackFixture(), [{
        ...eventFixture()[0], name: 'Thialf', importCompetitionName: 'holland cup'
    }], 7)
    assert.equal(existing.competitionId, 'event-1')
    assert.equal(existing.createEvent, false)
})

test('registry preview has no writes and resolves the correct existing event', async () => {
    const events = eventFixture()
    events.push(
        { ...events[0], _id: 'training', training: true },
        { ...events[0], _id: 'other-season', season: '2024-2025' },
        { ...events[0], _id: 'other-track', track: 'track-2' },
        { ...events[0], _id: 'other-name', name: 'Other' })
    const h = harness([eventRow()], {
        registryScope: true, startMonth: 7, tracks: trackFixture(), competitions: events
    })
    const { result: preview } = await h.preview()
    assert.equal(h.writes.length, 0)
    assert.equal(preview.rows[0].destination.competitionId, 'event-1')
    assert.equal(preview.rows[0].destination.season, '2023-2024')
    const { result: report } = await h.commit(preview.token, [importChoice()])
    assert.equal(report.imported.length, 1)
    assert.equal(report.createdEvents.length, 0)
    assert.equal(h.writes[0][1].competition, 'event-1')
})

test('creates a named track and one non-training event, using the first imported date, not the earliest date', async () => {
    const h = harness([
        eventRow({ date: '2024-02-01', externalReference: 'skip' }),
        eventRow({ date: '2024-02-20', externalReference: 'first' }),
        eventRow({ date: '2024-02-02', externalReference: 'second' })
    ], { registryScope: true, startMonth: 7 })
    const { result: preview } = await h.preview()
    assert.equal(h.writes.length, 0)
    assert.equal(preview.rows[0].destination.createTrack, true)
    const { result: report } = await h.commit(preview.token, [
        { action: 'skip' }, importChoice(), importChoice()
    ])
    assert.equal(report.createdTracks.length, 1)
    assert.equal(report.createdEvents.length, 1)
    assert.equal(report.imported.length, 2)
    const event = h.writes.find(w => w[0] === 'event')[1]
    assert.equal(event.name, 'Holland Cup')
    assert.equal(event.date, '2024-02-20')
    assert.equal(event.training, false)
    assert.equal(event.season, '2023-2024')
    assert.equal(event.importCompetitionName, 'holland cup')
    assert.equal(h.writes.filter(w => w[0] === 'registry').every(w => w[1].competition === event._id), true)
    const again = harness([eventRow({ externalReference: 'third' })], {
        registryScope: true, startMonth: 7, tracks: h.tracks, competitions: h.competitions
    })
    const { result: nextPreview } = await again.preview()
    assert.equal(nextPreview.rows[0].destination.competitionId, event._id)
    assert.equal((await again.commit(nextPreview.token, [importChoice()])).result.createdEvents.length, 0)
})

test('different file competitions, tracks and seasons produce separate events', async () => {
    const h = harness([
        eventRow(),
        eventRow({ competitionName: 'Other Cup', externalReference: 'other-cup' }),
        eventRow({ date: '2024-07-01', externalReference: 'other-season' }),
        eventRow({ trackName: 'Other Track', externalReference: 'other-track' })
    ], { registryScope: true, startMonth: 7 })
    const { result: preview } = await h.preview()
    const { result: report } = await h.commit(preview.token, preview.rows.map(() => importChoice()))
    assert.equal(report.createdTracks.length, 2)
    assert.equal(report.createdEvents.length, 4)
    assert.equal(report.imported.length, 4)
    assert.deepEqual(h.competitions.map(c => c.season), ['2023-2024', '2023-2024', '2024-2025', '2023-2024'])
})

test('inline events use the calendar year and missing tracks require a valid existing selection', async () => {
    const h = harness([eventRow({ trackName: '' })], { registryScope: true, tracks: trackFixture() })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].destination.needsTrack, true)
    assert.equal((await h.commit(preview.token, [importChoice()])).result.message, 'IMPORT_CHOOSE_TRACK')
    assert.equal((await h.commit(preview.token, [importChoice({ trackId: 'forged' })])).status, 400)
    assert.equal(h.writes.length, 0)
    const { result: report } = await h.commit(preview.token, [importChoice({ trackId: 'track-1' })])
    assert.equal(report.imported.length, 1)
    assert.equal(report.createdTracks.length, 0)
    assert.equal(h.competitions[0].season, '2024')
    assert.equal(h.competitions[0].track, 'track-1')
})

test('missing row dates are resolved before inferring the event season', async () => {
    const h = harness([eventRow({ date: null, requiredInputs: ['date'] })], {
        registryScope: true, startMonth: 7, tracks: trackFixture()
    })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].destination.season, null)
    const { result } = await h.commit(preview.token, [importChoice({ date: '2024-02-02' })])
    assert.equal(result.imported.length, 1)
    assert.equal(h.competitions[0].season, '2023-2024')
})

test('does not invent missing competition names or choose ambiguous events or tracks', async () => {
    const tracks = trackFixture(), competitions = eventFixture()
    assert.equal(destinationFor(eventRow({ competitionName: '' }), null, tracks, competitions, 7).issue,
        'IMPORT_MISSING_COMPETITION')
    assert.equal(destinationFor(eventRow(), null, tracks, [...competitions, { ...competitions[0], _id: 'second' }], 7).issue,
        'IMPORT_AMBIGUOUS_EVENT')
    assert.equal(destinationFor(eventRow(), null, [...tracks, { ...tracks[0], _id: 'second' }], competitions, 7).needsTrack, true)
    const h = harness([eventRow({ competitionName: '' })], { registryScope: true })
    const { result: preview } = await h.preview()
    const { result: report } = await h.commit(preview.token, [importChoice()])
    assert.equal(report.skipped[0].reason, 'IMPORT_MISSING_COMPETITION')
    assert.equal(h.writes.length, 0)
})

test('checks event and track creation permissions before writing any rows', async () => {
    for (const entity of ['competition', 'track']) {
        const h = harness([eventRow()], { registryScope: true, permissions: { [entity]: ['R'] } })
        const { result: preview } = await h.preview()
        assert.equal((await h.commit(preview.token, [importChoice()])).status, 403)
        assert.equal(h.writes.length, 0)
    }
    const h = harness([eventRow()], {
        registryScope: true, startMonth: 7, tracks: trackFixture(), competitions: eventFixture(),
        permissions: { competition: ['R'], track: ['R'] }
    })
    const { result: preview } = await h.preview()
    assert.equal((await h.commit(preview.token, [importChoice()])).result.imported.length, 1)
})

test('registry and event preview tokens cannot be exchanged between endpoints', async () => {
    for (const registryScope of [true, false]) {
        const h = harness([eventRow()], { registryScope })
        const { result: preview } = await h.preview()
        h.req.params = registryScope ? { id: 'event-1' } : {}
        assert.equal((await h.commit(preview.token, [importChoice()])).status, 409)
        assert.equal(h.writes.length, 0)
    }
})

test('registry imports replace duplicates only in the matching existing event with explicit consent', async () => {
    for (const competition of ['event-1', 'other-event']) {
        const h = harness([eventRow()], {
            registryScope: true, startMonth: 7, tracks: trackFixture(), competitions: eventFixture(),
            records: [{ _id: 'existing', source: row().source, externalReference: row().externalReference, competition }]
        })
        const { result: preview } = await h.preview()
        assert.equal(preview.rows[0].duplicateId, competition === 'event-1' ? 'existing' : null)
        assert.equal((await h.commit(preview.token, [importChoice()])).status, competition === 'event-1' ? 409 : 400)
        assert.equal(h.writes.length, 0)
        if (competition === 'event-1') {
            const { result: conflict } = await h.commit(preview.token, [importChoice({ action: 'replace' })])
            assert.equal(conflict.code, 'IMPORT_DUPLICATE_REVIEW')
            assert.equal(h.writes.length, 0)
            assert.equal((await h.commit(preview.token, [importChoice({
                action: 'replace', duplicateAction: 'replace', duplicateId: 'existing',
                duplicateReviewToken: conflict.conflicts[0].token
            })])).result.imported.length, 1)
            assert.equal(h.writes[0][0], 'replace')
        }
    }
})

test('preview performs no writes and commit imports selected event; token cannot be replayed', async () => {
    const h = harness([row()])
    const { result: preview } = await h.preview()
    assert.equal(h.writes.length, 0)
    assert.equal(preview.rows[0].automaticSkater, 'skater-1')
    const choices = [{ action: 'import', skaterId: 'skater-1', category: 'LA2' }]
    const { result: report } = await h.commit(preview.token, choices)
    assert.equal(report.imported.length, 1)
    assert.equal(h.writes[0][1].competition, 'event-1')
    assert.deepEqual(Array.from(h.writes[0][1].times), [11148, 29884])
    assert.equal((await h.commit(preview.token, choices)).status, 409)
})

test('unknown categories require explicit valid selection before any writes', async () => {
    const h = harness([{ ...row(), category: 'Missing' }])
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].category, null)
    const choices = [{ action: 'import', skaterId: 'skater-1' }]
    assert.equal((await h.commit(preview.token, choices)).status, 400)
    assert.equal(h.writes.length, 0)
    choices[0].category = 'Other'
    choices[0].updateSkaterCategory = false
    const { result } = await h.commit(preview.token, choices)
    assert.equal(result.imported[0].categorySubstituted, true)
    assert.equal(h.writes[0][1].category, 'Other')
})

test('category differences require an explicit profile decision in both import entry points', async () => {
    for (const registryScope of [false, true]) {
        const h = harness([registryScope ? eventRow({ category: 'Other' }) : { ...row(), category: 'Other' }], { registryScope })
        const { result: preview } = await h.preview()
        const choice = importChoice({ category: 'Other' })
        const pending = await h.commit(preview.token, [choice])
        assert.equal(pending.status, 400)
        assert.equal(pending.result.message, 'IMPORT_CATEGORY_UPDATE_CHOOSE')
        assert.equal(h.writes.length, 0)
        choice.updateSkaterCategory = false
        const { result } = await h.commit(preview.token, [choice])
        assert.equal(result.imported.length, 1)
        assert.equal(h.skaters[0].currentcategory, 'LA2')
        assert.equal(h.writes.find(w => w[0] === 'registry')[1].category, 'Other')
        assert.equal(result.updatedSkaters.length, 0)
    }
})

test('explicit profile consent updates the existing skater and reports the change once', async () => {
    const h = harness([{ ...row(), category: 'Other' },
        { ...row(), category: 'Other', date: '2026-10-18', externalReference: 'next' }])
    const { result: preview } = await h.preview()
    const { result } = await h.commit(preview.token, preview.rows.map(() =>
        importChoice({ updateSkaterCategory: true })))
    assert.equal(result.imported.length, 2)
    assert.equal(result.updatedSkaters.length, 1)
    assert.equal(h.writes.filter(w => w[0] === 'skater-category').length, 1)
    assert.equal(h.skaters[0].currentcategory, 'Other')
    assert.equal(h.writes.find(w => w[0] === 'registry')[1].category, 'Other')
})

test('profile updates require update permission, but result-only imports do not', async () => {
    const h = harness([{ ...row(), category: 'Other' }], { permissions: { skater: ['R'] } })
    const { result: preview } = await h.preview()
    assert.equal((await h.commit(preview.token, [importChoice({ updateSkaterCategory: true })])).status, 403)
    assert.equal(h.writes.length, 0)
    const { result } = await h.commit(preview.token, [importChoice({ updateSkaterCategory: false })])
    assert.equal(result.imported.length, 1)
    assert.equal(h.skaters[0].currentcategory, 'LA2')
})

test('database category policy uses the selected skater category, not the file or forged choices', async () => {
    const h = harness([{ ...row(), category: 'Other' }], { categorySource: 'database' })
    const { result: preview } = await h.preview()
    assert.equal(preview.categorySource, 'database')
    assert.equal(preview.rows[0].candidates[0].category, 'LA2')
    const { result } = await h.commit(preview.token, [importChoice({ category: 'Other' })])
    assert.equal(result.imported[0].category, 'LA2')
    assert.equal(h.writes[0][1].category, 'LA2')
    assert.equal(h.writes.some(w => w[0] === 'skater-category'), false)
})

test('missing database categories need manual selection and explicit profile consent', async () => {
    const h = harness([row()], { categorySource: 'database' })
    h.skaters[0].currentcategory = undefined
    const { result: preview } = await h.preview()
    assert.equal((await h.commit(preview.token, [importChoice({ category: undefined })])).status, 400)
    assert.equal((await h.commit(preview.token, [importChoice()])).result.message, 'IMPORT_CATEGORY_UPDATE_CHOOSE')
    const { result } = await h.commit(preview.token, [importChoice({ updateSkaterCategory: true })])
    assert.equal(result.imported[0].category, 'LA2')
    assert.equal(h.skaters[0].currentcategory, 'LA2')
})

test('ambiguous file categories are not silently matched to the first database category', async () => {
    const h = harness([{ ...row(), category: 'la2' }], {
        categories: [{ name: 'LA2' }, { name: 'La2' }, { name: 'Other' }]
    })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].category, null)
    assert.equal((await h.commit(preview.token, [importChoice({ category: undefined })])).status, 400)
    assert.equal(h.writes.length, 0)
    const { result } = await h.commit(preview.token, [importChoice({ category: 'Other', updateSkaterCategory: false })])
    assert.equal(result.imported[0].category, 'Other')
})

test('changed inherited categories require a new preview before any writes', async () => {
    const h = harness([row()], { categorySource: 'database' })
    const { result: preview } = await h.preview()
    h.skaters[0].currentcategory = 'Other'
    const { result, status } = await h.commit(preview.token, [importChoice()])
    assert.equal(status, 409)
    assert.equal(result.message, 'IMPORT_CATEGORY_CHANGED')
    assert.equal(h.writes.length, 0)
})

test('different profile categories for the same skater are rejected before saving any results', async () => {
    const h = harness([{ ...row(), category: 'Other' },
        { ...row(), category: 'Third', externalReference: 'second', date: '2026-10-18' }], {
        categories: [{ name: 'LA2' }, { name: 'Other' }, { name: 'Third' }]
    })
    const { result: preview } = await h.preview()
    const choices = preview.rows.map(() => importChoice({ updateSkaterCategory: true }))
    const { result, status } = await h.commit(preview.token, choices)
    assert.equal(status, 400)
    assert.equal(result.message, 'IMPORT_CATEGORY_UPDATE_CONFLICT')
    assert.equal(h.writes.length, 0)
    choices[1].updateSkaterCategory = false
    const confirmed = await h.commit(preview.token, choices)
    assert.equal(confirmed.result.imported.length, 2)
    assert.equal(h.skaters[0].currentcategory, 'Other')
})

test('club options list existing accessible clubs and rejects arbitrary filter IDs', async () => {
    const h = harness([row()], { clubs: [{ _id: 'z', name: 'Z club' }, { _id: 'a', name: 'A club' }] })
    const { result } = await h.options()
    assert.deepEqual(Array.from(result.clubs, c => c.id), ['a', 'z'])
    h.req.body.clubId = 'foreign'
    assert.equal((await h.preview()).status, 400)
    assert.equal(h.writes.length, 0)
})

test('club filtering uses the database profile, excludes new skaters and ignores the file club', async () => {
    for (const registryScope of [false, true]) {
        const makeRow = registryScope ? eventRow : overrides => ({ ...row(), ...overrides })
        const h = harness([
            makeRow({ clubName: 'OTHER', externalReference: 'one' }),
            makeRow({ skaterName: 'Someone Else', clubName: 'RFEDH', externalReference: 'two' }),
            makeRow({ skaterName: 'New Skater', clubName: 'RFEDH', externalReference: 'three' })
        ], { registryScope, clubId: 'club-1', createSkaters: true, skaters: [
            { _id: 'skater-1', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F', currentclub: 'club-1', currentcategory: 'LA2' },
            { _id: 'skater-2', name: 'Someone', lastname: 'Else', gender: 'F', currentclub: 'club-2', currentcategory: 'LA2' }
        ] })
        const { result: preview } = await h.preview()
        assert.equal(preview.rows[0].issue, null)
        assert.equal(preview.rows[1].issue, 'IMPORT_CLUB_EXCLUDED')
        assert.equal(preview.rows[2].issue, 'IMPORT_CLUB_EXCLUDED')
        const { result } = await h.commit(preview.token, preview.rows.map(() => importChoice()))
        assert.equal(result.imported.length, 1)
        assert.equal(result.skipped.length, 2)
        assert.equal(result.createdSkaters.length, 0)
    }
})

test('ambiguous skater choices are restricted to members of the selected database club', async () => {
    const h = harness([row()], { clubId: 'club-1', skaters: [
        { _id: 'inside', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F', currentclub: 'club-1', currentcategory: 'LA2' },
        { _id: 'outside', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F', currentclub: 'club-2', currentcategory: 'LA2' }
    ] })
    const { result: preview } = await h.preview()
    assert.deepEqual(Array.from(preview.rows[0].candidates, c => c.id), ['inside'])
    assert.equal((await h.commit(preview.token, [importChoice({ skaterId: 'outside' })])).status, 400)
    assert.equal(h.writes.length, 0)
    assert.equal((await h.commit(preview.token, [importChoice({ skaterId: 'inside' })])).result.imported.length, 1)
})

test('club membership is revalidated at confirmation before saving anything', async () => {
    const h = harness([row()], { clubId: 'club-1' })
    const { result: preview } = await h.preview()
    h.skaters[0].currentclub = 'club-2'
    const { result, status } = await h.commit(preview.token, [importChoice()])
    assert.equal(status, 409)
    assert.equal(result.message, 'IMPORT_CLUB_CHANGED')
    assert.equal(h.writes.length, 0)
})

test('Siero skater imports use the profile club when the parser has no club, in both entry points', async () => {
    for (const registryScope of [false, true]) {
        const input = { ...(registryScope ? eventRow() : row()), clubName: '',
            skaterName: 'OLIEGTNIS MERCADO RODRIGUEZ' }
        const h = harness([input], { registryScope, clubId: 'siero',
            clubs: [{ _id: 'siero', name: 'CLUB PATIN SIERO' }],
            skaters: [{ _id: 'skater-1', name: 'OLIEGTNIS', lastname: 'MERCADO RODRIGUEZ', gender: 'F',
                currentcategory: 'LA2', currentclub: 'siero' }],
            permissions: { club: ['R'] } })
        const { result: preview } = await h.preview()
        assert.equal(h.writes.length, 0)
        assert.equal(preview.rows[0].clubResolution.name, 'CLUB PATIN SIERO')
        assert.equal(preview.rows[0].unknownClub, false)
        const { result } = await h.commit(preview.token, [importChoice()])
        assert.equal(result.imported.length, 1)
        assert.equal(h.writes.find(w => w[0] === 'registry')[1].club, 'siero')
        assert.equal(h.skaters[0].currentclub, 'siero')
        assert.equal(result.createdClubs.length, 0)
    }
})

test('a distinct new file club is created once, reported, and never assigned to an existing profile', async () => {
    const h = harness([{ ...row(), clubName: 'NEW CLUB' },
        { ...row(), clubName: 'NEW CLUB', date: '2026-10-18', externalReference: 'second' }])
    const { result: preview } = await h.preview()
    assert.equal(h.writes.length, 0)
    assert.equal(preview.rows[0].clubResolution.create, true)
    const { result } = await h.commit(preview.token, [importChoice(), importChoice()])
    assert.equal(result.imported.length, 2)
    assert.equal(result.createdClubs.length, 1)
    assert.equal(result.createdClubs[0].name, 'NEW CLUB')
    assert.equal(h.writes.filter(w => w[0] === 'club').length, 1)
    assert.equal(h.skaters[0].currentclub, 'club-1')
    assert.equal(result.imported[0].clubName, 'NEW CLUB')
    const clubId = result.createdClubs[0].id
    assert.equal(h.writes.filter(w => w[0] === 'registry').every(w => w[1].club === clubId), true)
})

test('new file clubs require create permission before any row or club is written', async () => {
    const h = harness([{ ...row(), clubName: 'NEW CLUB' }], { permissions: { club: ['R'] } })
    const { result: preview } = await h.preview()
    assert.equal((await h.commit(preview.token, [importChoice()])).status, 403)
    assert.equal(h.writes.length, 0)
})

test('new skaters receive their resolved file club; missing clubs create UNKNOWN with an explicit report', async () => {
    for (const name of ['NEW CLUB', '']) {
        const h = harness([{ ...row(), clubName: name }], { createSkaters: true, skaters: [], clubs: [] })
        const { result: preview } = await h.preview()
        const { result } = await h.commit(preview.token, [importChoice({ skaterId: 'new' })])
        assert.equal(result.imported.length, 1)
        assert.equal(result.createdClubs[0].name, name || 'UNKNOWN')
        assert.equal(h.writes.find(w => w[0] === 'skater')[1].currentclub, result.createdClubs[0].id)
        assert.equal(h.writes.find(w => w[0] === 'registry')[1].club, result.createdClubs[0].id)
        assert.equal(result.imported[0].unknownClub, !name)
    }
})

test('manually selected skaters use their own resolved club, not the first candidates club', async () => {
    const h = harness([{ ...row(), clubName: '' }], {
        clubs: [{ _id: 'a', name: 'CLUB A' }, { _id: 'b', name: 'CLUB B' }],
        skaters: ['a', 'b'].map(id => ({ _id: id, name: 'Ona', lastname: 'Rodriguez Cornejo',
            gender: 'F', currentcategory: 'LA2', currentclub: id }))
    })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].automaticSkater, null)
    assert.equal(preview.rows[0].candidates[1].clubResolution.name, 'CLUB B')
    const { result } = await h.commit(preview.token, [importChoice({ skaterId: 'b' })])
    assert.equal(result.imported[0].club, 'b')
    assert.equal(h.writes.find(w => w[0] === 'registry')[1].club, 'b')
})

test('changed club resolution invalidates the review before any writes', async () => {
    const h = harness([{ ...row(), clubName: '' }])
    const { result: preview } = await h.preview()
    h.skaters[0].currentclub = undefined
    const { status, result } = await h.commit(preview.token, [importChoice()])
    assert.equal(status, 409)
    assert.equal(result.message, 'IMPORT_CLUB_CHANGED')
    assert.equal(h.writes.length, 0)
})

test('ambiguous names require selection; unknown club uses UNKNOWN; new skater is reused', async () => {
    const h = harness([row(), { ...row(), date: '2026-10-18', externalReference: 'source-row-2' }], {
        skaters: [], createSkaters: true, unknownClub: true
    })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].clubResolution.name, 'RFEDH')
    assert.equal(preview.rows[0].clubResolution.create, true)
    const choices = preview.rows.map(() => ({ action: 'import', skaterId: 'new', category: 'LA2' }))
    const { result } = await h.commit(preview.token, choices)
    assert.equal(result.createdSkaters.length, 1)
    assert.equal(result.imported.length, 2)
    assert.equal(h.writes.filter(w => w[0] === 'skater').length, 1)
    assert.equal(h.writes.find(w => w[0] === 'skater')[1].name, 'Ona')
    assert.equal(h.writes.find(w => w[0] === 'skater')[1].lastname, 'Rodríguez Cornejo')

    const ambiguous = harness([row()], { skaters: [
        { _id: 'a', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F' },
        { _id: 'b', name: 'Ona', lastname: 'Rodriguez Cornejo', gender: 'F' }
    ] })
    const { result: p } = await ambiguous.preview()
    assert.equal(p.rows[0].automaticSkater, null)
    assert.equal((await ambiguous.commit(p.token, [{ action: 'import', category: 'LA2' }])).status, 400)
    assert.equal(ambiguous.writes.length, 0)
})

test('duplicates are never inserted or overwritten without explicit replace', async () => {
    const record = { _id: 'existing', competition: 'event-1', source: 'netherlands', externalReference: 'source-row-1' }
    const h = harness([row()], { records: [record] })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].duplicate, true)
    assert.equal((await h.commit(preview.token, [{ action: 'import', category: 'LA2' }])).status, 409)
    assert.equal(h.writes.length, 0)
    const { result: conflict } = await h.commit(preview.token, [{ action: 'replace', category: 'LA2' }])
    assert.equal(conflict.code, 'IMPORT_DUPLICATE_REVIEW')
    assert.equal(conflict.conflicts[0].canKeep, false)
    assert.equal(h.writes.length, 0)
    const { result } = await h.commit(preview.token, [{
        action: 'replace', category: 'LA2', duplicateAction: 'replace', duplicateId: 'existing',
        duplicateReviewToken: conflict.conflicts[0].token
    }])
    assert.equal(result.imported[0].replaced, true)
    assert.equal(h.writes[0][0], 'replace')
})

test('special results are skipped and source-less formats warn without inventing metadata', async () => {
    const h = harness([{ ...row(), team: true }, { ...row(), status: 'DQ' },
        { ...row(), status: '', source: undefined, externalReference: undefined }])
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].issue, 'IMPORT_SPECIAL_RESULT')
    assert.equal(preview.rows[1].issue, 'IMPORT_SPECIAL_RESULT')
    assert.ok(preview.rows[2].warnings.includes('IMPORT_NO_REFERENCE'))
    const { result } = await h.commit(preview.token, [
        { action: 'skip' }, { action: 'skip' }, { action: 'import', category: 'LA2' }
    ])
    assert.equal(result.skipped.length, 2)
    assert.equal(result.imported.length, 1)
})

test('review belongs to its user, rejects forged skaters and enforces creation permission', async () => {
    const h = harness([row()])
    const { result: preview } = await h.preview()
    const choices = [{ action: 'import', skaterId: 'foreign-skater', category: 'LA2' }]
    // Automatic exact matches are authoritative, so test a nonautomatic match separately.
    h.req.user.id = 'other-user'
    assert.equal((await h.commit(preview.token, choices)).status, 409)
    assert.equal(h.writes.length, 0)
    const missing = harness([row()], { skaters: [] })
    const { result: p } = await missing.preview()
    assert.equal((await missing.commit(p.token, choices)).status, 400)
    assert.equal(missing.writes.length, 0)
    const forbidden = harness([row()], { createSkaters: true, permissions: { skater: ['R'] } })
    assert.equal((await forbidden.preview()).status, 403)
    assert.equal(forbidden.writes.length, 0)
})

test('duplicates belonging to another event cannot be overwritten', async () => {
    const h = harness([row()], { records: [{
        _id: 'existing', competition: 'another-event', source: 'netherlands', externalReference: 'source-row-1'
    }] })
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].duplicateId, null)
    assert.equal((await h.commit(preview.token, [{ action: 'replace', category: 'LA2' }])).status, 400)
    assert.equal(h.writes.length, 0)
})

test('missing date and distance are requested per row, never inherited, and validated before writes', async () => {
    const incomplete = { ...row(), date: null, distance: null, requiredInputs: ['date', 'distance'] }
    const h = harness([incomplete, { ...incomplete, externalReference: 'source-row-2' }])
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].issue, null)
    assert.deepEqual(Array.from(preview.rows[0].requiredInputs), ['date', 'distance'])
    assert.equal(preview.rows[1].date, null)
    assert.equal(preview.rows[1].distance, null)
    const choices = [
        { action: 'import', category: 'LA2', date: '2026-05-16', distance: '365' },
        { action: 'import', category: 'LA2' }
    ]
    assert.equal((await h.commit(preview.token, choices)).status, 400)
    assert.equal(h.writes.length, 0)
    choices[1].date = '2026-05-17'
    choices[1].distance = '400'
    const { result: report } = await h.commit(preview.token, choices)
    assert.equal(report.imported.length, 2)
    const values = h.writes.filter(w => w[0] === 'registry').map(w => w[1])
    assert.equal(values[0].date, '2026-05-16')
    assert.equal(values[0].distance, 365)
    assert.equal(values[1].date, '2026-05-17')
    assert.equal(values[1].distance, 400)
})

test('published fields cannot be replaced by review inputs; missing and invalid inputs are rejected', () => {
    const original = row()
    assert.deepEqual(completeRow(original, { date: '2000-01-01', distance: 1 }), original)
    const incomplete = { ...original, date: null, distance: null, requiredInputs: ['date', 'distance'] }
    for (const date of ['', '2026-02-30', '2026-05-16T00:00:00Z', 'invalid']) {
        assert.equal(validateRow(completeRow(incomplete, { date, distance: '365' })), 'IMPORT_INVALID_DATE')
    }
    for (const distance of ['', '0', '-1', 'invalid', 'Infinity']) {
        assert.equal(validateRow(completeRow(incomplete, { date: '2026-05-16', distance })), 'IMPORT_INVALID_RACE')
    }
})

test('untimed PDF results stay in the report even when date and distance are missing', async () => {
    const h = harness([{
        ...row(), date: null, distance: null, times: [], totalTime: null, rail: '',
        requiredInputs: ['date', 'distance'], sourceLocation: 'PDF 2 / 21'
    }])
    const { result: preview } = await h.preview()
    assert.equal(preview.rows[0].issue, 'IMPORT_MISSING_TIMES')
    const { result } = await h.commit(preview.token, [{ action: 'import' }])
    assert.equal(result.skipped[0].reason, 'IMPORT_MISSING_TIMES')
    assert.equal(result.skipped[0].row, 'PDF 2 / 21')
    assert.equal(h.writes.length, 0)
})

const contentDuplicate = overrides => ({
    ...row(), _id: 'existing', skater: 'skater-1', competition: 'event-1', club: 'club-1',
    source: 'other-source', externalReference: 'other-reference', rail: 'O', ...overrides
})

test('content duplicates show old and incoming details and require a decision before any writes', async () => {
    for (const action of ['skip', 'keep', 'replace']) {
        const h = harness([row()], { records: [contentDuplicate()] })
        const { result: preview } = await h.preview()
        assert.equal(preview.rows[0].duplicate, false)
        const { result: review, status } = await h.commit(preview.token, [importChoice()])
        assert.equal(status, 409)
        assert.equal(review.code, 'IMPORT_DUPLICATE_REVIEW')
        assert.equal(h.writes.length, 0)
        const conflict = review.conflicts[0]
        assert.equal(conflict.incoming.totalTime, 41032)
        assert.equal(conflict.existing[0].rail, 'O')
        assert.equal(conflict.existing[0].name, 'Ona Rodriguez Cornejo')
        assert.equal(conflict.canKeep, true)
        assert.deepEqual(Array.from(conflict.replaceable), ['existing'])
        const { result } = await h.commit(preview.token, [importChoice({
            duplicateAction: action, duplicateId: 'existing', duplicateReviewToken: conflict.token
        })])
        assert.equal(result.skipped.length, action === 'skip' ? 1 : 0)
        assert.equal(result.imported.length, action === 'skip' ? 0 : 1)
        assert.equal(h.writes.filter(w => w[0] === 'registry').length, action === 'keep' ? 1 : 0)
        assert.equal(h.writes.filter(w => w[0] === 'replace').length, action === 'replace' ? 1 : 0)
    }
})

test('duplicate checks work without source references and use the exact requested criteria', async () => {
    for (const difference of [
        { date: '2026-10-18' }, { skater: 'other' }, { competition: 'other' },
        { race: '1000m' }, { distance: 1000 }, { times: [41033] }
    ]) {
        const h = harness([{ ...row(), source: undefined, externalReference: undefined }], {
            records: [contentDuplicate(difference)]
        })
        const { result: preview } = await h.preview()
        assert.equal((await h.commit(preview.token, [importChoice()])).result.imported.length, 1)
    }
    const h = harness([{ ...row(), source: undefined, externalReference: undefined }], {
        records: [contentDuplicate({ race: '  VROUWEN 500 méter ', date: '2026-10-17T15:30:00Z', times: [41032] })]
    })
    const { result: preview } = await h.preview()
    assert.equal((await h.commit(preview.token, [importChoice()])).result.code, 'IMPORT_DUPLICATE_REVIEW')
    assert.equal(h.writes.length, 0)
})

test('changed duplicate details invalidate prior decisions and require a fresh comparison', async () => {
    const h = harness([row()], { records: [contentDuplicate()] })
    const { result: preview } = await h.preview()
    const { result: first } = await h.commit(preview.token, [importChoice()])
    h.records[0].rail = 'I'
    const { result: second } = await h.commit(preview.token, [importChoice({
        duplicateAction: 'replace', duplicateId: 'existing', duplicateReviewToken: first.conflicts[0].token
    })])
    assert.equal(second.code, 'IMPORT_DUPLICATE_REVIEW')
    assert.notEqual(second.conflicts[0].token, first.conflicts[0].token)
    assert.equal(second.conflicts[0].existing[0].rail, 'I')
    assert.equal(h.writes.length, 0)
})

test('duplicate review does not offer overwrite without permission or disclose inaccessible records', async () => {
    for (const hidden of [false, true]) {
        const h = harness([row()], {
            records: [contentDuplicate({ club: hidden ? 'private-club' : 'club-1' })],
            hiddenRecords: hidden, permissions: { registry: ['C', 'R'] }
        })
        const { result: preview } = await h.preview()
        const { result: review } = await h.commit(preview.token, [importChoice()])
        const conflict = review.conflicts[0]
        assert.equal(conflict.replaceable.length, 0)
        assert.equal(conflict.hidden, hidden)
        assert.equal(conflict.existing.length, hidden ? 0 : 1)
        assert.equal(conflict.canKeep, !hidden)
        assert.equal((await h.commit(preview.token, [importChoice({
            duplicateAction: 'replace', duplicateId: 'existing', duplicateReviewToken: conflict.token
        })])).status, 400)
        assert.equal(h.writes.length, 0)
    }
})

test('duplicate rows within the file are reviewed before creating any events or tracks', async () => {
    const h = harness([eventRow(), eventRow({ externalReference: 'second-ref' })], { registryScope: true, startMonth: 7 })
    const { result: preview } = await h.preview()
    const { result: review } = await h.commit(preview.token, [importChoice(), importChoice()])
    assert.equal(review.code, 'IMPORT_DUPLICATE_REVIEW')
    assert.equal(review.conflicts[0].existing[0].fromFile, true)
    assert.equal(review.conflicts[0].canKeep, true)
    assert.equal(h.writes.length, 0)
    const { result: report } = await h.commit(preview.token, [importChoice(), importChoice({
        duplicateAction: 'skip', duplicateReviewToken: review.conflicts[0].token
    })])
    assert.equal(report.imported.length, 1)
    assert.equal(report.skipped.length, 1)
    assert.equal(report.createdEvents.length, 1)
})

test('same-file source references cannot be kept as separate results', async () => {
    const h = harness([row(), { ...row(), date: '2026-10-18' }])
    const { result: preview } = await h.preview()
    const { result: review } = await h.commit(preview.token, [importChoice(), importChoice()])
    assert.equal(review.conflicts[0].canKeep, false)
    assert.equal(review.conflicts[0].replaceable.length, 0)
    assert.equal(h.writes.length, 0)
})

test('duplicates appearing after confirmation are reported, never silently inserted', async () => {
    let checks = 0
    const h = harness([row()], {
        beforeFind: (query, records) => {
            if (query.date && ++checks === 2) records.push(contentDuplicate())
        }
    })
    const { result: preview } = await h.preview()
    const { result: report } = await h.commit(preview.token, [importChoice()])
    assert.equal(report.imported.length, 0)
    assert.equal(report.failed[0].reason, 'IMPORT_DUPLICATE_CHANGED')
    assert.equal(h.writes.length, 0)
})

test('skipping an earlier file duplicate requests a fresh decision for any changed comparisons', async () => {
    const h = harness([row(), { ...row(), externalReference: 'second-ref' }, {
        ...row(), externalReference: 'third-ref'
    }])
    const { result: preview } = await h.preview()
    const { result: review } = await h.commit(preview.token, [importChoice(), importChoice(), importChoice()])
    assert.equal(review.conflicts.length, 2)
    const { result: updated } = await h.commit(preview.token, [importChoice(), importChoice({
        duplicateAction: 'skip', duplicateReviewToken: review.conflicts[0].token
    }), importChoice({
        duplicateAction: 'keep', duplicateReviewToken: review.conflicts[1].token
    })])
    assert.equal(updated.conflicts.length, 1)
    assert.equal(updated.conflicts[0].index, 2)
    assert.equal(h.writes.length, 0)
    const { result: report } = await h.commit(preview.token, [importChoice(), importChoice({
        duplicateAction: 'skip', duplicateReviewToken: review.conflicts[0].token
    }), importChoice({
        duplicateAction: 'keep', duplicateReviewToken: updated.conflicts[0].token
    })])
    assert.equal(report.imported.length, 2)
    assert.equal(report.skipped.length, 1)
})
