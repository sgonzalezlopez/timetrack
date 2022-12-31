const express = require('express')
const router = express.Router();
const path = require('path')
const controller = require("../controllers/category.controller");
const authentication = require(path.join(__corePath, '/middlewares/authentication'))
const authorization = require(path.join(__corePath, '/middlewares/authorization'))

router.get("/", authorization.checkPermision('category', 'R'), controller.getAll);
router.get("/:id", authorization.checkPermision('category', 'R'), controller.get);
router.post("/find", authorization.checkPermision('category', 'R'), controller.find);
router.put("/:id", authorization.checkPermision('category', 'U'), controller.update);
router.post("/", authorization.checkPermision('category', 'C'), controller.create);
router.delete("/:id", authorization.checkPermision('category', 'D'), controller.delete);

router.post('/:id', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.put('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })
router.delete('/', (req, res) => { res.status(404).send({ message: 'Operation not supported' }) })


module.exports = router;