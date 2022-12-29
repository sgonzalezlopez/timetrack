const express = require('express')
    const router = express.Router();
    const controller = require("../controllers/club.controller");
    const authentication = require('../core/middlewares/authentication')
    const authorization = require('../core/middlewares/authorization')
    
    router.get("/", authorization.checkPermision('club', 'R'), controller.getAll);
    router.get("/:id", authorization.checkPermision('club', 'R'), controller.get);
    router.post("/find", authorization.checkPermision('club', 'R'), controller.find);
    router.put("/:id", authorization.checkPermision('club', 'U'), controller.update);
    router.post("/", authorization.checkPermision('club', 'C'), controller.create);
    router.delete("/:id", authorization.checkPermision('club', 'D'), controller.delete);
    
    router.post('/:id', (req, res) => { res.status(404).send({ message : 'Operation not supported'})})
    router.put('/', (req, res) => { res.status(404).send({ message : 'Operation not supported'})})
    router.delete('/', (req, res) => { res.status(404).send({ message : 'Operation not supported'})})
    
    
module.exports = router;