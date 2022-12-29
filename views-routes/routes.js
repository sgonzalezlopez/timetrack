const express = require('express')
const router = express.Router();
const authentication = require('../core/middlewares/authentication')
const authorization = require('../core/middlewares/authorization')

// Routes
router.use('/management', authentication.isAuthenticatedWeb, authorization.isRole('coach'), require('./management.route'))
router.use('/private', authentication.isAuthenticatedWeb, require('./private.route'))

module.exports = router;