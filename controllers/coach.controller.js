const Model = require("../models/coach.model");

exports.getAll = async (req, res, next) => {
    try {
        await Model.find()
        .populate('clubs')
        .populate('user')
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
        .populate('clubs')
        .populate('user')
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
        await Model.findOneAndUpdate({_id:req.params.id}, parseBody(req.body), {new: true})
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
        .populate('clubs')
        .populate('user')
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