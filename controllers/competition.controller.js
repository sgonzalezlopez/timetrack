const Model = require("../models/competition.model");
const filter = require('../middlewares/data.filter')

exports.getAll = async (req, res, next) => {
    try {
        await Model.find()
        .populate('track')
        .then(items => {
            res.send(items)
        })
    } catch (err) {
        console.error(err);
        next(err)
    }
}
    
exports.get = async (req, res, next) => {
    try {
        await Model.findById(req.params.id)
        .populate('track')
        .then(item => {
            res.send(item)
        })
    } catch (err) {
        console.error(err);
        next(err)
    }
}

exports.create = async (req, res, next) => {
    try {
        await Model.create(parseBody(req.body))
        .then(item => {
            res.send(item)
        })
    } catch (err) {
        console.error(err);
        next(err)
    }
}

exports.update = async (req, res, next) => {
    try {
        await Model.findOneAndUpdate({_id:req.params.id}, parseBody(req.body), {returnDocument: 'after'})
        .then(item => {
            if (item) res.send(item)
            else res.status(400).send({message: res.__('ITEM_NOT_FOUND')})
        })
    } catch (err) {
        console.error(err);
        next(err)
    }
}

exports.delete = async (req, res, next) => {
    try {
        await Model.deleteOne({_id:req.params.id})
        .then(item => {
            res.send({message : 'OK'})
        })
    } catch (err) {
        console.error(err);
        next(err)
    }
}

exports.find = async (req, res, next) => {
    try {
        for (const key in req.body) {
            if (Object.hasOwnProperty.call(req.body, key)) {
                if (req.body[key] == '') delete req.body[key]                
            }
        }
        await Model.find(req.body)
        .populate('track')
        .then(items => {
            res.send(items)
        })
    } catch (err) {
        console.error(err);
        next(err)
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

exports.getRegistries = async (req, res, next) => {
    try {
        req.body = { competition: req.params.id }
        await require('./registry.controller').find(req, res, next)
    } catch (err) {
        next(err)
    }
}

exports.deleteRegistry = async (req, res, next) => {
    try {
        req.params.id = req.params.reg
        await require('./registry.controller').delete(req, res, next)
    } catch (err) {
        next(err)
    }
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