const path = require('path');
const express = require('express')
const router = express.Router();
const authentication = require(path.join(__corePath, '/middlewares/authentication'))
const authorization = require(path.join(__corePath, '/middlewares/authorization'))


// Routes
router.use('/category', require('./category.route'))
router.use('/trainingsession', require('./trainingsession.route'))
router.use('/coach', require('./coach.route'))
router.use('/registry', require('./registry.route'))
router.use('/track', require('./track.route'))
router.use('/skater', require('./skater.route'))
router.use('/competition', require('./competition.route'))
router.use('/club', require('./club.route'))

module.exports = router;

