const crypto = require('crypto')
const attempts = new Map()
const WINDOW_MS = 60000
const MAX_CLIENTS = 10000
let nextSweep = 0

function digest(key) {
  return crypto.createHash('sha256').update(key).digest()
}

module.exports = function authenticateExternalApi(req, res, next) {
  const expectedKeys = [process.env.EXTERNAL_API_KEY, ...(process.env.EXTERNAL_API_PREVIOUS_KEYS || '').split(',')]
    .filter(key => key && key.trim()).map(key => key.trim())
  const authorization = req.get('authorization') || ''
  const match = /^Bearer ([^\s,]+)$/i.exec(authorization)
  const providedKey = match ? match[1] : ''

  if (!process.env.EXTERNAL_API_KEY || !process.env.EXTERNAL_API_KEY.trim()) {
    return res.status(503).send({ message: 'External API is not configured' })
  }

  const now = Date.now()
  if (now >= nextSweep) {
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key)
    nextSweep = now + WINDOW_MS
  }
  const client = req.ip || req.socket?.remoteAddress || 'unknown'
  let entry = attempts.get(client)
  if (entry && entry.until <= now) {
    attempts.delete(client)
    entry = null
  }
  if (!entry) {
    if (attempts.size >= MAX_CLIENTS) return res.status(429).send({ message: 'Too many requests' })
    entry = { count: 0, until: now + WINDOW_MS }
    attempts.set(client, entry)
  }
  const configuredLimit = Number(process.env.EXTERNAL_API_RATE_LIMIT || 120)
  const limit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 120
  if (++entry.count > limit) {
    res.set('Retry-After', String(Math.ceil((entry.until - now) / 1000)))
    return res.status(429).send({ message: 'Too many requests' })
  }
  const providedBuffer = digest(providedKey.slice(0, 4096))
  let valid = false
  for (const expectedKey of expectedKeys) {
    valid = crypto.timingSafeEqual(digest(expectedKey), providedBuffer) || valid
  }

  if (!providedKey || providedKey.length > 4096 || !valid) {
    return res.status(401).send({ message: 'Invalid API key' })
  }

  next()
}
