const express = require('express')
    const router = express.Router();
    const controller = require("../controllers/skater.controller");
    const authentication = require('../core/middlewares/authentication')
    const authorization = require('../core/middlewares/authorization')
    
    router.get("/", authorization.checkPermision('skater', 'R'), controller.getAll);
    router.get("/:id/registries", authorization.checkPermision('skater', 'R'), controller.getRegistries);
    router.delete("/:id/registries/:reg", authorization.checkPermision('skater', 'R'), authorization.checkPermision('registry', 'D'), controller.deleteRegistry);
    router.get("/:id", authorization.checkPermision('skater', 'R'), controller.get);
    router.post("/find", authorization.checkPermision('skater', 'R'), controller.find);
    router.put("/:id", authorization.checkPermision('skater', 'U'), controller.update);
    router.post("/", authorization.checkPermision('skater', 'C'), controller.create);
    router.delete("/:id", authorization.checkPermision('skater', 'D'), controller.delete);
    
    router.post('/:id', (req, res) => { res.status(404).send({ message : 'Operation not supported'})})
    router.put('/', (req, res) => { res.status(404).send({ message : 'Operation not supported'})})
    router.delete('/', (req, res) => { res.status(404).send({ message : 'Operation not supported'})})
    
    
module.exports = router;