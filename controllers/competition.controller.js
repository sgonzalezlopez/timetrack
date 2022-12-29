const Model = require("../models/competition.model");
const filter = require('../middlewares/data.filter')

exports.getAll = (req, res) => {
    try {
        Model.find()
        .populate('track')
        .then(items => {
            res.send(items)
        })
    } catch (err) {
        console.error(err);
        throw err
    }
}
    
exports.get = (req, res) => {
    try {
        Model.findById(req.params.id)
        .populate('track')
        .then(item => {
            res.send(item)
        })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.create = (req, res) => {
    try {
        Model.create(parseBody(req.body))
        .then(item => {
            res.send(item)
        })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.update = (req, res) => {
    try {
        Model.findOneAndUpdate({_id:req.params.id}, parseBody(req.body))
        .then(item => {
            if (item) res.send(item)
            else res.status(400).send({message: res.__('ITEM_NOT_FOUND')})
        })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.delete = (req, res) => {
    try {
        Model.deleteOne({_id:req.params.id})
        .then(item => {
            res.send({message : 'OK'})
        })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.find = (req, res) => {
    try {
        for (const key in req.body) {
            if (Object.hasOwnProperty.call(req.body, key)) {
                if (req.body[key] == '') delete req.body[key]                
            }
        }
        Model.find(req.body)
        .populate('track')
        .then(items => {
            res.send(items)
        })
    } catch (err) {
        console.error(err);
        throw err
    }
}

function parseBody(body) {
    var values = body
    for (const key in body) {
        if (Object.hasOwnProperty.call(body, key)) {
            values[key] = body[key] == "" ? null : body[key];
        }
    }

    return values;
}

exports.getRegistries = (req, res) => {
    req.body = {competition : req.params.id}
    require('./registry.controller').find(req, res);
}

exports.deleteRegistry = (req, res) => {
    req.params.id = req.params.reg;
    require('./registry.controller').delete(req, res);
}

exports.getObject = async function(id, user) {
    try {
        return Model.find(filter.getFilter('Competition', {_id : id}, user))
        .populate('track')
        .then(item => {
            if (item.length == 0) return null;
            return item[0]
        })
    } catch (err) {
        console.error(err);
        throw err
    }

}