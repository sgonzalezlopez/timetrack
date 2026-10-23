function hasCompleteSplits(record) {
    return Array.isArray(record.times) && record.times.length > 0 &&
        Array.from(record.times).every(time => Number.isFinite(time) && time > 0)
}

function finalTime(record) {
    if (record.totalTime !== undefined) {
        return Number.isFinite(record.totalTime) && record.totalTime > 0 ? record.totalTime : null
    }
    if (!Array.isArray(record.times) || !record.times.length ||
        Array.from(record.times).some(time => time != null && (!Number.isFinite(time) || time < 0))) return null
    const total = record.times.reduce((sum, time) => sum + (time == null ? 0 : time), 0)
    return Number.isFinite(total) && total > 0 ? total : null
}

module.exports = { finalTime, hasCompleteSplits }
