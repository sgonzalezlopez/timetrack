const Model = require("../models/track.model");
const geocoder = require("../utils/geocoder")

exports.getAll = async (req, res, next) => {
    try {
        await Model.find()
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
        if (!req.body.hasOwnProperty("geolocation") && req.body.hasOwnProperty('location')) {
            var geolocation = await geocoder.geocode(req.body.location);
            req.body.geolocation = geolocation[0];
        }
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
        const oldItem = await Model.findOne({ _id: req.params.id })
        if (!oldItem) return res.status(400).send({ message: res.__('ITEM_NOT_FOUND') })
        const oldLocation = oldItem.location
        const item = await Model.findOneAndUpdate({ _id: req.params.id }, parseBody(req.body), { returnDocument: 'after' })
        if (!item) return res.status(400).send({ message: res.__('ITEM_NOT_FOUND') })
        if (req.body.lat && req.body.lng) {
            const response = await fetch(`https://eu1.locationiq.com/v1/reverse?key=pk.e614e6e48bc2e93a31d3994d7ea9f383&lat=${req.body.lat}&lon=${req.body.lng}&format=json`)
            const value = await response.json()
            item.location = value.display_name
            const geolocation = await geocoder.geocode(item.location)
            item.geolocation = geolocation[0]
            item.geolocation.latitude = req.body.lat
            item.geolocation.longitude = req.body.lng
            await item.save()
        } else if (oldLocation != req.body.location && req.body.location && !req.body.hasOwnProperty('geolocation')) {
            const geolocation = await geocoder.geocode(req.body.location)
            item.geolocation = geolocation[0]
            await item.save()
        }
        res.send(item)
    } catch (err) {
        next(err)
    }
}

exports.delete = async (req, res, next) => {
    try {
        await Model.deleteOne({ _id: req.params.id })
            .then(item => {
                res.send({ message: 'OK' })
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
        const competitions = await require('../models/competition.model').find({ track: req.params.id })
        req.body = { competition: { $in: competitions.map(item => item._id) } }
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

exports.getObject = async function (id, user) {
    try {
        return Model.findById({ _id: id })
            .then(item => {
                return item;
            })
    } catch (err) {
        console.error(err);
        throw err
    }

}