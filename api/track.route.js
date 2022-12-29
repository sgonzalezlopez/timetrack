const path = require('path');
const express = require('express')
const router = express.Router();
const controller = require("../controllers/track.controller");
const authentication = require(path.join(__corePath, '/middlewares/authentication'))
const authorization = require(path.join(__corePath, '/middlewares/authorization'))

router.get("/", authorization.checkPermision('track', 'R'), controller.getAll);
router.get("/:id/registries", authorization.checkPermision('track', 'R'), controller.getRegistries);
router.delete("/:id/registries/:reg", authorization.checkPermision('track', 'R'), authorization.checkPermision('registry', 'D'), controller.deleteRegistry);
router.get("/:id", authorization.checkPermision('track', 'R'), controller.get);
router.post("/find", authorization.checkPermision('track', 'R'), controller.find);
router.put("/:id", authorization.checkPermision('track', 'U'), controller.update);
router.post("/", authorization.checkPermision('track', 'C'), controller.create);
router.delete("/:id", authorization.checkPermision('track', 'D'), controller.delete);

router.post('/:id', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.put('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.delete('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })


module.exports = router;