const path = require('path');
const express = require('express')
const router = express.Router();
const authentication = require(path.join(__corePath, '/middlewares/authentication'))
const authorization = require(path.join(__corePath, '/middlewares/authorization'))

// Routes
router.use('/management', authentication.isAuthenticatedWeb, authorization.isRole(['coach', 'user']), require('./management.route'))
router.use('/private', authentication.isAuthenticatedWeb, require('./private.route'))

module.exports = router;