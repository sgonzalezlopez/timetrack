const path = require('path');
const express = require('express')
const router = express.Router();
const controller = require("../controllers/trainingsession.controller");
const authentication = require(path.join(__corePath, '/middlewares/authentication'))
const authorization = require(path.join(__corePath, '/middlewares/authorization'))

router.get("/", authorization.checkPermision('trainingsession', 'R'), controller.getAll);
router.get("/:id/registries", authorization.checkPermision('trainingsession', 'R'), controller.getRegistries);
router.get("/:id/skaterinputs/:skaterId", authorization.checkPermision('trainingsession', 'R'), controller.getSkaterInputs);
router.get("/:id/inputs/:heat", authorization.checkPermision('trainingsession', 'R'), controller.getInputs);
router.delete("/:id/registries/:reg", authorization.checkPermision('trainingsession', 'R'), authorization.checkPermision('registry', 'D'), controller.deleteRegistry);
router.get("/:id", authorization.checkPermision('trainingsession', 'R'), controller.get);
router.post("/find", authorization.checkPermision('trainingsession', 'R'), controller.find);
router.put("/:id", authorization.checkPermision('trainingsession', 'U'), controller.update);
router.post("/", authorization.checkPermision('trainingsession', 'C'), controller.create);
router.delete("/:id", authorization.checkPermision('trainingsession', 'D'), controller.delete);

router.post('/:id', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.put('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.delete('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })


module.exports = router;