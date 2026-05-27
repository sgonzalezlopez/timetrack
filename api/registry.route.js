const path = require('path');
const express = require('express')
const router = express.Router();
const controller = require("../controllers/registry.controller");
const authentication = require(path.join(__corePath, '/middlewares/authentication'))
const authorization = require(path.join(__corePath, '/middlewares/authorization'))

router.get("/", authorization.checkPermision('registry', 'R'), controller.getAll);
router.get("/races/options", authorization.checkPermision('registry', 'R'), controller.getRaceSummaryOptions);
router.post("/races/find", authorization.checkPermision('registry', 'R'), controller.findRaceSummaries);
router.put("/races", authorization.checkPermision('registry', 'U'), controller.updateRaceSummary);
router.post("/races/merge", authorization.checkPermision('registry', 'U'), controller.mergeRaceSummaries);
router.post("/stats/summary", authorization.checkPermision('registry', 'R'), controller.getStatsSummary);
router.post("/stats/summary/find", authorization.checkPermision('registry', 'R'), controller.getStatsSummary);
router.post("/stats/race", authorization.checkPermision('registry', 'R'), controller.getStatsRace);
router.post("/stats/race/find", authorization.checkPermision('registry', 'R'), controller.getStatsRace);
router.post("/records/find", authorization.checkPermision('registry', 'R'), controller.findRecords);
router.post("/find", authorization.checkPermision('registry', 'R'), controller.find);
router.get("/:id", authorization.checkPermision('registry', 'R'), controller.get);
router.put("/:id", authorization.checkPermision('registry', 'U'), controller.update);
router.post("/", authorization.checkPermision('registry', 'C'), controller.create);
router.delete("/:id", authorization.checkPermision('registry', 'D'), controller.delete);

router.post('/:id', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.put('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.delete('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })


module.exports = router;