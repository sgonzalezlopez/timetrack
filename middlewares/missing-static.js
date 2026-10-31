const path = require('path')

// Only reached after static handlers and application routes have declined the request.
module.exports = function missingStatic(req, res, next) {
  if (['GET', 'HEAD'].includes(req.method) && path.posix.extname(req.path || '')) {
    return res.status(404).send({ message: 'Not found' })
  }
  next()
}
