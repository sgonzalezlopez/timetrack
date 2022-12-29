const path = require('path');
const express = require('express')
const router = express.Router();
const controller = require("../controllers/registry.controller");
const authentication = require(path.join(__corePath, '/middlewares/authentication'))
const authorization = require(path.join(__corePath, '/middlewares/authorization'))

router.get("/", authorization.checkPermision('registry', 'R'), controller.getAll);
router.get("/:id", authorization.checkPermision('registry', 'R'), controller.get);
router.post("/records/find", authorization.checkPermision('registry', 'R'), controller.findRecords);
router.post("/find", authorization.checkPermision('registry', 'R'), controller.find);
router.put("/:id", authorization.checkPermision('registry', 'U'), controller.update);
router.post("/", authorization.checkPermision('registry', 'C'), controller.create);
router.delete("/:id", authorization.checkPermision('registry', 'D'), controller.delete);

router.post('/:id', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.put('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.delete('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })


module.exports = router;