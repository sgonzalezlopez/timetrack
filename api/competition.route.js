const path = require('path');
const express = require('express')
const router = express.Router();
const controller = require("../controllers/competition.controller");
const authentication = require(path.join(__corePath, '/middlewares/authentication'))
const authorization = require(path.join(__corePath, '/middlewares/authorization'))

router.get("/", authorization.checkPermision('competition', 'R'), controller.getAll);
router.get("/:id/registries", authorization.checkPermision('competition', 'R'), controller.getRegistries);
router.delete("/:id/registries/:reg", authorization.checkPermision('competition', 'R'), authorization.checkPermision('registry', 'D'), controller.deleteRegistry);
router.get("/:id", authorization.checkPermision('competition', 'R'), controller.get);
router.post("/find", authorization.checkPermision('competition', 'R'), controller.find);
router.put("/:id", authorization.checkPermision('competition', 'U'), controller.update);
router.post("/", authorization.checkPermision('competition', 'C'), controller.create);
router.delete("/:id", authorization.checkPermision('competition', 'D'), controller.delete);

router.post('/:id', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.put('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.delete('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })


module.exports = router;