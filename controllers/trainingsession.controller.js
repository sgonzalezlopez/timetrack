const Model = require("../models/trainingsession.model");
const filter = require('../middlewares/data.filter')
const registry = require('../models/registry.model')
const mongoose = require('mongoose')

exports.getAll = async (req, res, next) => {
    try {
        await Model.find(filter.getFilter('TrainingSession', {}, req.user))
        .populate('skaters')
        .populate({path : 'competition', populate : { path : 'track'}})
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
        await Model.find(filter.getFilter('TrainingSession', {_id:req.params.id}, req.user))
        .populate('skaters')
        .populate({path : 'competition', populate : { path : 'track'}})
        .then(item => {
            if (item.length == 0) return res.send(null)
            res.send(item[0])
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
        await Model.findOneAndUpdate(filter.getFilter('TrainingSession', {_id : req.params.id}, req.user), parseBody(req.body), {returnDocument: 'after'})
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
        await Model.deleteOne(filter.getFilter('TrainingSession', {_id : req.params.id}, req.user))
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
        await Model.find(filter.getFilter('TrainingSession', req.body, req.user))
        .populate('skaters')
        .populate({path : 'competition', populate : { path : 'track'}})
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

exports.getInputs = async (req, res, next) => {
    try {
        const ts = await Model.findById(req.params.id)
            .populate('skaters')
            .populate({path : 'competition', populate : { path : 'track'}})
        if (!ts || !ts.competition) return next(new Error(res.__('ITEM_NOT_FOUND')))

        const f = {competition : ts.competition, race : ts.race, trainingHeat : req.params.heat}
        const existing = await registry.find(f).populate('skater')
        const existingSkaters = existing.map(x => x.skater.id)
        const pending = ts.skaters.filter(s => !existingSkaters.includes(s.id))
        const timesNumber = Math.ceil(ts.distance / parseInt(ts.competition.track.distance) * ts.partialsPerLap)

        pending.forEach(element => {
            existing.push({skater:element, times : Array(timesNumber), totalTime : 0})
        })
        res.send(existing)
    } catch (err) {
        next(err)
    }
}

exports.getSkaterInputs = async (req, res, next) => {
    try {
    var ts = await Model.findById(req.params.id)
    .populate('skaters')
    .populate({path : 'competition', populate : { path : 'track'}});
    if (!ts || !ts.competition) return next(new Error(res.__('ITEM_NOT_FOUND')), null)

    if (ts.skaters.find(f => f.id ==req.params.skaterId) == null) return res.send({})
    
    var f = {competition : ts.competition, race : ts.race, skater : req.params.skaterId}

    var skater = await require('../models/skater.model').findById(req.params.skaterId)
    var existing = await registry.find(f).populate('skater')
    var timesNumber = Math.ceil(ts.distance / parseInt(ts.competition.track.distance) * ts.partialsPerLap);

    for (let i = 1; i <= ts.heats; i++) {
        if (!existing.find(f=> f.trainingHeat == i)) existing.push({skater:skater, times : Array(timesNumber),  trainingHeat : i, totalTime : 0})
    }

    res.send(existing)
    }
    catch (err) {
        console.error(err);
        next(err)
    }
}


exports.getRegistries = async (req, res, next) => {
    try {
        const ts = await Model.findById(req.params.id)
        if (!ts || !ts.competition) return next(new Error(res.__('ITEM_NOT_FOUND')))
        req.body = { competition: ts.competition, race: ts.race }
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
        return Model.find(filter.getFilter('TrainingSession', {_id : id}, user))
        .populate('skaters')
        .populate({path : 'competition', populate : { path : 'track'}})
        .then(item => {
            if (item.length == 0) return null;
            return item[0]
        })
    } catch (err) {
        console.error(err);
        throw err
    }

}