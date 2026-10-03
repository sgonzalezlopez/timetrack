const mongoose = require('mongoose')
const Registry = require('../models/registry.model')
const Skater = require('../models/skater.model')

const MAX_LIMIT = 500
const REGISTRY_FILTERS = ['skater', 'club', 'category', 'competition', 'race', 'distance', 'rail', 'starting', 'trainingHeat', 'trainingPercentage']
const SKATER_FILTERS = ['name', 'lastname', 'currentclub', 'currentcategory', 'gender', 'country', 'active']

function hasValue(value) {
  return value !== undefined && value !== null && value !== ''
}

function getPagination(body) {
  const page = Number.parseInt(body.page, 10)
  const limit = Number.parseInt(body.limit, 10)

  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : 100
  }
}

function getObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) throw new Error(`Invalid ${field}`)
  return value
}

function getRegistryFilter(body) {
  const filter = {}

  REGISTRY_FILTERS.forEach(field => {
    const value = body[field]
    if (!hasValue(value)) return

    if (['skater', 'club', 'competition'].includes(field)) {
      filter[field] = getObjectId(value, field)
    }
    else if (field === 'category') {
      const categories = Array.isArray(value) ? value : [value]
      filter.category = { $in: categories.filter(hasValue).map(String) }
    }
    else if (field === 'distance' || field === 'trainingHeat') {
      const numberValue = Number(value)
      if (!Number.isFinite(numberValue)) throw new Error(`Invalid ${field}`)
      filter[field] = numberValue
    }
    else {
      filter[field] = String(value)
    }
  })

  if (hasValue(body.dateFrom) || hasValue(body.dateTo)) {
    filter.date = {}
    if (hasValue(body.dateFrom)) {
      const dateFrom = new Date(body.dateFrom)
      if (Number.isNaN(dateFrom.getTime())) throw new Error('Invalid dateFrom')
      filter.date.$gte = dateFrom
    }
    if (hasValue(body.dateTo)) {
      const dateTo = new Date(body.dateTo)
      if (Number.isNaN(dateTo.getTime())) throw new Error('Invalid dateTo')
      filter.date.$lte = dateTo
    }
  }

  return filter
}

function getSkaterFilter(body) {
  const filter = {}

  SKATER_FILTERS.forEach(field => {
    const value = body[field]
    if (!hasValue(value)) return

    if (field === 'currentclub') filter[field] = getObjectId(value, field)
    else if (field === 'name' || field === 'lastname') filter[field] = new RegExp(escapeRegex(String(value)), 'iu')
    else if (field === 'active') filter[field] = value === true || value === 'true'
    else filter[field] = String(value)
  })

  return filter
}

function getPopulateFilters(body) {
  const competitionMatch = {}
  const skaterMatch = {}

  if (hasValue(body.training)) competitionMatch.training = parseBoolean(body.training, 'training')
  if (hasValue(body.track)) competitionMatch.track = getObjectId(body.track, 'track')
  if (hasValue(body.season)) competitionMatch.season = String(body.season)
  if (hasValue(body.gender)) skaterMatch.gender = String(body.gender)
  if (hasValue(body.country)) skaterMatch.country = String(body.country)

  return { competitionMatch, skaterMatch }
}

function parseBoolean(value, field) {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error(`Invalid ${field}`)
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toRegistryResponse(registry) {
  const item = registry.toObject({ virtuals: true })
  delete item.__v
  delete item.createdAt
  delete item.updatedAt
  return item
}

async function findRegistries(body, includeAll) {
  const filter = getRegistryFilter(body)
  const { competitionMatch, skaterMatch } = getPopulateFilters(body)
  const pagination = getPagination(body)
  const query = Registry.find(filter)
    .select('date skater club category competition race distance rail starting trainingHeat trainingPercentage times comments')
    .populate({ path: 'skater', select: 'name lastname currentclub currentcategory gender country birthDate active', populate: { path: 'currentclub', select: 'name' }, match: skaterMatch })
    .populate({ path: 'club', select: 'name' })
    .populate({ path: 'competition', populate: { path: 'track', select: 'name fullname' }, match: competitionMatch })
    .sort({ date: -1, _id: -1 })

  const registries = await query
  const needsCompetition = Object.keys(competitionMatch).length > 0
  const needsSkater = Object.keys(skaterMatch).length > 0
  const filtered = registries.filter(item =>
    (!needsCompetition || item.competition) && (!needsSkater || item.skater)
  )

  if (includeAll) return filtered

  const start = (pagination.page - 1) * pagination.limit
  return {
    items: filtered.slice(start, start + pagination.limit).map(toRegistryResponse),
    page: pagination.page,
    limit: pagination.limit,
    total: filtered.length
  }
}

exports.searchRegistries = async (req, res, next) => {
  try {
    res.send(await findRegistries(req.body || {}, false))
  }
  catch (error) {
    next(error)
  }
}

exports.searchSkaters = async (req, res, next) => {
  try {
    const body = req.body || {}
    const filter = getSkaterFilter(body)
    const { page, limit } = getPagination(body)
    const [items, total] = await Promise.all([
      Skater.find(filter)
        .select('name lastname currentclub currentcategory gender country birthDate active')
        .populate('currentclub', 'name')
        .sort({ lastname: 1, name: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Skater.countDocuments(filter)
    ])

    res.send({
      items: items.map(item => item.toObject({ virtuals: true })),
      page,
      limit,
      total
    })
  }
  catch (error) {
    next(error)
  }
}

exports.searchRecords = async (req, res, next) => {
  try {
    const body = req.body || {}
    const registries = await findRegistries({ ...body, limit: MAX_LIMIT }, true)
    const top = body.top === '*' ? registries.length : Number.parseInt(body.top, 10) || 1
    const bestForSkater = body.bestForSkater === true || body.bestForSkater === 'true'
    const groupBy = ['country', 'track', 'season'].includes(body.groupBy) ? body.groupBy : null
    const groups = new Map()

    registries.forEach(registry => {
      if (!registry.skater || !registry.competition) return

      const item = toRegistryResponse(registry)
      const totalTime = Array.isArray(item.times) ? item.times.reduce((total, time) => total + time, 0) : null
      if (!Number.isFinite(totalTime)) return

      item.totalTime = totalTime
      item.country = item.skater.country
      item.gender = item.skater.gender
      item.season = item.competition.season
      item.track = item.competition.track ? item.competition.track.name : null
      const groupValue = groupBy ? item[groupBy] || '' : ''
      const groupKey = [groupValue, item.race || '', item.gender || ''].join('|')

      if (!groups.has(groupKey)) groups.set(groupKey, [])
      groups.get(groupKey).push(item)
    })

    const records = []
    groups.forEach(group => {
      const candidates = bestForSkater
        ? Array.from(group.reduce((best, item) => {
          const current = best.get(String(item.skater._id))
          if (!current || item.totalTime < current.totalTime) best.set(String(item.skater._id), item)
          return best
        }, new Map()).values())
        : group

      candidates
        .sort((left, right) => left.totalTime - right.totalTime)
        .slice(0, Math.min(top, MAX_LIMIT))
        .forEach((item, index) => records.push({ ...item, position: index + 1 }))
    })

    res.send(records)
  }
  catch (error) {
    next(error)
  }
}