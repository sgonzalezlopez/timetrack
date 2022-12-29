const Model = require("../models/club.model");
const filter = require('../middlewares/data.filter')

exports.getAll = (req, res) => {
    try {
        Model.find(filter.getFilter('Club', {}, req.user))
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
        Model.find(filter.getFilter('Club', {_id : req.params.id}, req.user))
        .then(item => {
            if (item.length == 0) res.send(null)
            res.send(item[0])
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
        Model.findOneAndUpdate(filter.getFilter('Club', {_id : req.params.id}, req.user), parseBody(req.body))
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
        Model.deleteOne(filter.getFilter('Club', {_id : req.params.id}, req.user))
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
        Model.find(filter.getFilter('Club', req.body, req.user))
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