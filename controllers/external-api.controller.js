const mongoose = require('mongoose')
const Registry = require('../models/registry.model')
const Skater = require('../models/skater.model')
const { countryFilter, normalizeCountry } = require('../utils/registry-country')

const MAX_LIMIT = 500
const REGISTRY_FILTERS = ['skater', 'club', 'category', 'competition', 'race', 'distance', 'rail', 'starting', 'trainingHeat', 'trainingPercentage']
const SKATER_FILTERS = ['name', 'lastname', 'currentclub', 'currentcategory', 'gender', 'country', 'active']

function hasValue(value) {
  return value !== undefined && value !== null && value !== ''
}

function getPagination(body) {
  const page = positiveInteger(body.page, 1, 'page')
  const limit = Math.min(positiveInteger(body.limit, 100, 'limit'), MAX_LIMIT)
  if (!Number.isSafeInteger(page * limit)) throw new Error('Invalid page')
  return { page, limit }
}

function positiveInteger(value, fallback, field) {
  if (value === undefined) return fallback
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error(`Invalid ${field}`)
  return Number(value)
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body')
  for (const [field, value] of Object.entries(body)) {
    const values = Array.isArray(value) && ['category', 'country'].includes(field) ? value : [value]
    if (!values.length || values.length > 100 || values.some(v => !['string', 'number', 'boolean'].includes(typeof v) ||
        String(v).length > 256 || String(v).length === 0)) throw new Error(`Invalid ${field}`)
    if (['category', 'country', 'name', 'lastname', 'gender', 'season', 'race', 'rail', 'starting', 'trainingPercentage', 'currentcategory'].includes(field) &&
        values.some(v => typeof v !== 'string' || !v.trim())) throw new Error(`Invalid ${field}`)
  }
}

function fail(error, res, next) {
  if (/^Invalid |^IMPORT_INVALID_COUNTRY$/.test(error.message)) return res.status(400).send({ message: error.message })
  next(error)
}

function getObjectId(value, field) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value) || !mongoose.isValidObjectId(value)) throw new Error(`Invalid ${field}`)
  return value
}

function getRegistryFilter(body) {
  const filter = {}
  if (hasValue(body.country)) filter.country = countryFilter(body.country)

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
      if (!['string', 'number'].includes(typeof value) || !String(value).trim() || !Number.isFinite(numberValue) || numberValue < 0) throw new Error(`Invalid ${field}`)
      filter[field] = numberValue
    }
    else {
      filter[field] = String(value)
    }
  })

  if (hasValue(body.dateFrom) || hasValue(body.dateTo)) {
    filter.date = {}
    if (hasValue(body.dateFrom)) {
      const dateFrom = parseDate(body.dateFrom, 'dateFrom')
      if (Number.isNaN(dateFrom.getTime())) throw new Error('Invalid dateFrom')
      filter.date.$gte = dateFrom
    }
    if (hasValue(body.dateTo)) {
      const dateTo = parseDate(body.dateTo, 'dateTo')
      if (Number.isNaN(dateTo.getTime())) throw new Error('Invalid dateTo')
      filter.date.$lte = dateTo
    }
    if (filter.date.$gte > filter.date.$lte) throw new Error('Invalid date range')
  }

  return filter
}

function getSkaterFilter(body) {
  const filter = {}

  SKATER_FILTERS.forEach(field => {
    const value = body[field]
    if (!hasValue(value)) return

    if (field === 'currentclub') filter[field] = getObjectId(value, field)
    else if (field === 'country') {
      if (typeof value !== 'string') throw new Error('Invalid country')
      normalizeCountry(value)
      filter[field] = value
    }
    else if (field === 'name' || field === 'lastname') filter[field] = new RegExp(escapeRegex(String(value)), 'iu')
    else if (field === 'active') filter[field] = parseBoolean(value, field)
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

  return { competitionMatch, skaterMatch }
}

function parseBoolean(value, field) {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error(`Invalid ${field}`)
}

function parseDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw new Error(`Invalid ${field}`)
  const day = value.slice(0, 10)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error(`Invalid ${field}`)
  return date
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
  validateBody(body)
  const filter = getRegistryFilter(body)
  const { competitionMatch, skaterMatch } = getPopulateFilters(body)
  const pagination = getPagination(body)
  let pageIds, total
  const joins = []
  for (const [field, match] of [['competition', competitionMatch], ['skater', skaterMatch]]) {
    if (!Object.keys(match).length) continue
    const model = mongoose.model(field === 'competition' ? 'Competition' : 'Skater')
    const castMatch = model.find(match).cast(model)
    joins.push({ $lookup: { from: model.collection.name, let: { reference: `$${field}` },
      pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$reference'] } } }, { $match: castMatch }, { $project: { _id: 1 } }], as: `_matched_${field}` } },
    { $match: { [`_matched_${field}.0`]: { $exists: true } } })
  }
  if (!includeAll && joins.length) {
    const [result] = await Registry.aggregate([
      { $match: Registry.find(filter).cast(Registry) }, ...joins,
      { $facet: { items: [{ $sort: { date: -1, _id: -1 } },
        { $skip: (pagination.page - 1) * pagination.limit }, { $limit: pagination.limit }, { $project: { _id: 1 } }],
      count: [{ $count: 'total' }] } }
    ]).option({ maxTimeMS: 30000 })
    pageIds = result.items.map(item => item._id)
    total = result.count[0]?.total || 0
  }
  const query = Registry.find(pageIds ? { _id: { $in: pageIds } } : filter)
    .select('date skater club category country competition race distance rail starting trainingHeat trainingPercentage times comments')
    .populate({ path: 'skater', select: 'name lastname currentclub currentcategory gender country birthDate active', populate: { path: 'currentclub', select: 'name' }, match: skaterMatch })
    .populate({ path: 'club', select: 'name' })
    .populate({ path: 'competition', populate: { path: 'track', select: 'name fullname' }, match: competitionMatch })
    .sort({ date: -1, _id: -1 })

  if (includeAll) return query.maxTimeMS(30000).cursor({ batchSize: 100 })
  if (!pageIds) query.skip((pagination.page - 1) * pagination.limit).limit(pagination.limit)
  const [registries, exactTotal] = await Promise.all([query.maxTimeMS(30000), total === undefined ? Registry.countDocuments(filter).maxTimeMS(30000) : total])
  const needsCompetition = Object.keys(competitionMatch).length > 0
  const needsSkater = Object.keys(skaterMatch).length > 0
  const filtered = registries.filter(item =>
    (!needsCompetition || item.competition) && (!needsSkater || item.skater)
  )

  return {
    items: filtered.map(toRegistryResponse),
    page: pagination.page,
    limit: pagination.limit,
    total: exactTotal
  }
}

exports.searchRegistries = async (req, res, next) => {
  try {
    res.send(await findRegistries(req.body === undefined ? {} : req.body, false))
  }
  catch (error) {
    fail(error, res, next)
  }
}

exports.searchSkaters = async (req, res, next) => {
  try {
    const body = req.body === undefined ? {} : req.body
    validateBody(body)
    const filter = getSkaterFilter(body)
    const { page, limit } = getPagination(body)
    const [items, total] = await Promise.all([
      Skater.find(filter)
        .select('name lastname currentclub currentcategory gender country birthDate active')
        .populate('currentclub', 'name')
        .sort({ lastname: 1, name: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit).maxTimeMS(30000),
      Skater.countDocuments(filter).maxTimeMS(30000)
    ])

    res.send({
      items: items.map(item => item.toObject({ virtuals: true })),
      page,
      limit,
      total
    })
  }
  catch (error) {
    fail(error, res, next)
  }
}

exports.searchRecords = async (req, res, next) => {
  try {
    const body = req.body === undefined ? {} : req.body
    validateBody(body)
    const top = body.top === '*' ? MAX_LIMIT : Math.min(positiveInteger(body.top, 1, 'top'), MAX_LIMIT)
    getPagination(body)
    const bestForSkater = body.bestForSkater === undefined ? false : parseBoolean(body.bestForSkater, 'bestForSkater')
    if (body.groupBy !== undefined && !['none', 'country', 'track', 'season'].includes(body.groupBy)) throw new Error('Invalid groupBy')
    const registries = await findRegistries({ ...body, limit: MAX_LIMIT }, true)
    const groupBy = ['country', 'track', 'season'].includes(body.groupBy) ? body.groupBy : null
    const groups = new Map()
    const encounterOrder = new Map()
    const order = new WeakMap()

    for await (const registry of registries) {
      if (!registry.skater || !registry.competition) continue

      const item = toRegistryResponse(registry)
      const totalTime = Array.isArray(item.times) ? item.times.reduce((total, time) => total + time, 0) : null
      if (!Number.isFinite(totalTime)) continue

      item.totalTime = totalTime
      item.gender = item.skater.gender
      item.season = item.competition.season
      item.track = item.competition.track ? item.competition.track.name : null
      const groupValue = groupBy ? item[groupBy] || '' : ''
      const groupKey = [groupValue, item.race || '', item.gender || ''].join('|')

      if (!groups.has(groupKey)) groups.set(groupKey, [])
      const group = groups.get(groupKey)
      if (!encounterOrder.has(groupKey)) encounterOrder.set(groupKey, new Map())
      const seen = encounterOrder.get(groupKey)
      const identity = bestForSkater ? String(item.skater._id) : null
      if (!bestForSkater) {
        seen.set(null, (seen.get(null) || 0) + 1)
        order.set(item, seen.get(null))
      }
      else {
        if (!seen.has(identity)) seen.set(identity, seen.size)
        order.set(item, seen.get(identity))
      }
      const previous = bestForSkater ? group.findIndex(candidate => String(candidate.skater._id) === String(item.skater._id)) : -1
      if (previous >= 0) {
        if (group[previous].totalTime <= item.totalTime) continue
        group.splice(previous, 1)
      }
      const compare = (left, right) => left.totalTime - right.totalTime || order.get(left) - order.get(right)
      if (group.length === top && compare(item, group[group.length - 1]) >= 0) continue
      let low = 0, high = group.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (compare(item, group[middle]) < 0) high = middle
        else low = middle + 1
      }
      group.splice(low, 0, item)
      if (group.length > top) group.pop()
    }

    const records = []
    groups.forEach(group => {
      group.forEach((item, index) => records.push({ ...item, position: index + 1 }))
    })

    res.send(records)
  }
  catch (error) {
    fail(error, res, next)
  }
}
