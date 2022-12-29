const express = require('express')
    const router = express.Router();
    const controller = require("../controllers/coach.controller");
    const authentication = require('../core/middlewares/authentication')
    const authorization = require('../core/middlewares/authorization')
    
    router.get("/", authorization.checkPermision('coach', 'R'), controller.getAll);
    router.get("/:id", authorization.checkPermision('coach', 'R'), controller.get);
    router.post("/find", authorization.checkPermision('coach', 'R'), controller.find);
    router.put("/:id", authorization.checkPermision('coach', 'U'), controller.update);
    router.post("/", authorization.checkPermision('coach', 'C'), controller.create);
    router.delete("/:id", authorization.checkPermision('coach', 'D'), controller.delete);
    
    router.post('/:id', (req, res) => { res.status(404).send({ message : 'Operation not supported'})})
    router.put('/', (req, res) => { res.status(404).send({ message : 'Operation not supported'})})
    router.delete('/', (req, res) => { res.status(404).send({ message : 'Operation not supported'})})
    
    
module.exports = router;