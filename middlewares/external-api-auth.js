const crypto = require('crypto')

module.exports = function authenticateExternalApi(req, res, next) {
  const expectedKey = process.env.EXTERNAL_API_KEY
  const authorization = req.get('authorization') || ''
  const providedKey = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''

  if (!expectedKey) {
    return res.status(503).send({ message: 'External API is not configured' })
  }

  const expectedBuffer = Buffer.from(expectedKey)
  const providedBuffer = Buffer.from(providedKey)

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return res.status(401).send({ message: 'Invalid API key' })
  }

  next()
}