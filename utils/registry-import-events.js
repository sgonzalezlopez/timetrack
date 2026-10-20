const { normalize } = require('./registry-import')

function seasonFor(date, startMonth) {
    const value = new Date(date)
    if (!date || !Number.isFinite(value.getTime())) return null
    const year = value.getUTCFullYear()
    if (startMonth === 1) return String(year)
    const first = value.getUTCMonth() + 1 < startMonth ? year - 1 : year
    return `${first}-${first + 1}`
}

function destinationFor(row, trackId, tracks, competitions, startMonth) {
    if (!normalize(row.competitionName)) return { issue: 'IMPORT_MISSING_COMPETITION' }
    const matches = tracks.filter(t => normalize(row.trackName) &&
        [t.name, t.importName].some(name => normalize(name) === normalize(row.trackName)))
    const needsTrack = !normalize(row.trackName) || matches.length > 1
    const track = needsTrack ? tracks.find(t => String(t._id) === trackId) : matches[0]
    const season = seasonFor(row.date, startMonth)
    if (needsTrack && !track) return { needsTrack: true, season, issue: 'IMPORT_CHOOSE_TRACK' }
    const events = track && season ? competitions.filter(c => !c.training &&
        String(c.track) === String(track._id) && c.season === season &&
        normalize(c.importCompetitionName || c.name) === normalize(row.competitionName)) : []
    if (events.length > 1) return { issue: 'IMPORT_AMBIGUOUS_EVENT' }
    return {
        needsTrack, trackId: track ? String(track._id) : null,
        trackName: track ? track.name : row.trackName, createTrack: !track,
        season, competitionId: events.length ? String(events[0]._id) : null,
        name: events.length ? events[0].name : track ? track.name : row.trackName,
        createEvent: !events.length
    }
}

module.exports = { seasonFor, destinationFor }
