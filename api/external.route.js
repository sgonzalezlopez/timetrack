const express = require('express')
const authenticateExternalApi = require('../middlewares/external-api-auth')
const controller = require('../controllers/external-api.controller')

const router = express.Router()

router.use(authenticateExternalApi)
router.post('/registries/search', controller.searchRegistries)
router.post('/skaters/search', controller.searchSkaters)
router.post('/records/search', controller.searchRecords)

module.exports = router