const path = require('path');
const express = require('express')
const router = express.Router();
const controller = require("../controllers/registry.controller");
const importer = require("../controllers/registry-import.controller");
const recordsExcel = require("../controllers/records-excel.controller");
const authentication = require(path.join(__corePath, '/middlewares/authentication'))
const authorization = require(path.join(__corePath, '/middlewares/authorization'))

router.get("/", authorization.checkPermision('registry', 'R'), controller.getAll);
router.get("/import-formats", authorization.checkPermision('registry', 'C'), importer.formats);
router.get("/import-options", authorization.checkPermision('registry', 'C'), importer.options);
router.post("/import/preview", authorization.checkPermision('registry', 'C'), authorization.checkPermision('competition', 'R'), authorization.checkPermision('track', 'R'), importer.preview);
router.post("/import/commit", authorization.checkPermision('registry', 'C'), authorization.checkPermision('competition', 'R'), authorization.checkPermision('track', 'R'), importer.commit);
router.get("/races/options", authorization.checkPermision('registry', 'R'), controller.getRaceSummaryOptions);
router.post("/races/find", authorization.checkPermision('registry', 'R'), controller.findRaceSummaries);
router.put("/races", authorization.checkPermision('registry', 'U'), controller.updateRaceSummary);
router.post("/races/merge", authorization.checkPermision('registry', 'U'), controller.mergeRaceSummaries);
router.post("/stats/summary", authorization.checkPermision('registry', 'R'), controller.getStatsSummary);
router.post("/stats/summary/find", authorization.checkPermision('registry', 'R'), controller.getStatsSummary);
router.post("/stats/race", authorization.checkPermision('registry', 'R'), controller.getStatsRace);
router.post("/stats/race/find", authorization.checkPermision('registry', 'R'), controller.getStatsRace);
router.post("/records/find", authorization.checkPermision('registry', 'R'), controller.findRecords);
router.post("/records/excel", authorization.checkPermision('registry', 'R'), authorization.isAdmin, recordsExcel.update);
router.post("/records/excel/categories", authorization.checkPermision('registry', 'R'), authorization.isAdmin, recordsExcel.updateCategories);
router.post("/records/excel/allround", authorization.checkPermision('registry', 'R'), authorization.isAdmin, recordsExcel.updateAllround);
router.post("/maintenance/country-backfill", authorization.checkPermision('registry', 'U'), authorization.isAdmin, controller.backfillCountry);
router.post("/find", authorization.checkPermision('registry', 'R'), controller.find);
router.get("/:id", authorization.checkPermision('registry', 'R'), controller.get);
router.put("/:id", authorization.checkPermision('registry', 'U'), controller.update);
router.post("/", authorization.checkPermision('registry', 'C'), controller.create);
router.delete("/:id", authorization.checkPermision('registry', 'D'), controller.delete);

router.post('/:id', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.put('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.delete('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })


module.exports = router;