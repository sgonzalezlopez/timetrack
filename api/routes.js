const express = require('express')
const router = express.Router();
const authentication = require('../core/middlewares/authentication')
const authorization = require('../core/middlewares/authorization')


// Routes
router.use('/trainingsession', require('./trainingsession.route'))
router.use('/coach', require('./coach.route'))
router.use('/registry', require('./registry.route'))
router.use('/track', require('./track.route'))
router.use('/skater', require('./skater.route'))
router.use('/competition', require('./competition.route'))
router.use('/club', require('./club.route'))

module.exports = router;

