const Model = require("../models/trainingsession.model");
const filter = require('../middlewares/data.filter')
const registry = require('../models/registry.model')
const mongoose = require('mongoose')

exports.getAll = (req, res) => {
    try {
        Model.find(filter.getFilter('TrainingSession', {}, req.user))
        .populate('skaters')
        .populate({path : 'competition', populate : { path : 'track'}})
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
        Model.find(filter.getFilter('TrainingSession', {_id:req.params.id}, req.user))
        .populate('skaters')
        .populate({path : 'competition', populate : { path : 'track'}})
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
        Model.findOneAndUpdate(filter.getFilter('TrainingSession', {_id : req.params.id}, req.user), parseBody(req.body))
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
        Model.deleteOne(filter.getFilter('TrainingSession', {_id : req.params.id}, req.user))
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
        Model.find(filter.getFilter('TrainingSession', req.body, req.user))
        .populate('skaters')
        .populate({path : 'competition', populate : { path : 'track'}})
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

exports.getInputs = async (req, res, next) => {
    var ts = await Model.findById(req.params.id)
    .populate('skaters')
    .populate({path : 'competition', populate : { path : 'track'}});
    if (!ts || !ts.competition) return next(new Error(res.__('ITEM_NOT_FOUND')), null)
    
    var f = {competition : ts.competition, race : ts.race, trainingHeat : req.params.heat}

    var existing = await registry.find(f).populate('skater')
    var existingSkaters = existing.map(x => x.skater.id)
    var pending = ts.skaters.filter(s => !existingSkaters.includes(s.id));

    var timesNumber = Math.ceil(ts.distance / parseInt(ts.competition.track.distance) * ts.partialsPerLap);

    pending.forEach(element => {
        existing.push({skater:element, times : Array(timesNumber), totalTime : 0})
    });

    res.send(existing)
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
    var ts = await Model.findById(req.params.id);
    if (!ts || !ts.competition) return next(new Error(res.__('ITEM_NOT_FOUND')), null)
    
    req.body = {competition : ts.competition, race : ts.race}
    require('./registry.controller').find(req, res);
}

exports.deleteRegistry = (req, res) => {
    req.params.id = req.params.reg;
    require('./registry.controller').delete(req, res);
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