const Model = require("../models/track.model");
const geocoder = require("../utils/geocoder")

exports.getAll = (req, res) => {
    try {
        Model.find()
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
            .then(item => {
                res.send(item)
            })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.create = async (req, res) => {
    try {
        if (!req.body.hasOwnProperty("geolocation") && req.body.hasOwnProperty('location')) {
            var geolocation = await geocoder.geocode(req.body.location);
            req.body.geolocation = geolocation[0];
        }
        Model.create(parseBody(req.body))
            .then(item => {
                res.send(item)
            })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.update = async (req, res) => {
    try {
        olditem = await Model.findOne({ _id: req.params.id });

        if (!olditem) return res.status(400).send({ message: res.__('ITEM_NOT_FOUND') })
        var oldLocation = olditem.location;

        Model.findOneAndUpdate({ _id: req.params.id }, parseBody(req.body))
            .then(async item => {
                try {


                    if (req.body.lat && req.body.lng) {
                        // const resp = await geocoder.reverse({ lat: 45.767, lon: 4.833 });
                        // var location = await geocoder.reverse({ lat : parseFloat(req.body.lat), lon : parseFloat(req.body.lng)})
                        var resp = await fetch(`https://eu1.locationiq.com/v1/reverse?key=pk.e614e6e48bc2e93a31d3994d7ea9f383&lat=${req.body.lat}&lon=${req.body.lng}&format=json`)
                        val = await resp.json();
                        item.location = val.display_name;
                        var geolocation = await geocoder.geocode(item.location);
                        item.geolocation = geolocation[0];
                        item.geolocation.latitude = req.body.lat
                        item.geolocation.longitude = req.body.lng
                        item.save().then(item => {
                            res.send(item)
                        })

                    }
                    else if (oldLocation != req.body.location && req.body.location && !req.body.hasOwnProperty("geolocation")) {
                        var geolocation = await geocoder.geocode(req.body.location);
                        item.geolocation = geolocation[0];
                        item.save().then(item => {
                            res.send(item)
                        })
                    } else {
                        if (item) res.send(item)
                        else res.status(400).send({ message: res.__('ITEM_NOT_FOUND') })
                    }
                }
                catch (err) {
                    console.error(err);
                    res.status(400).send({ message: err })
                }
            })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.delete = (req, res) => {
    try {
        Model.deleteOne({ _id: req.params.id })
            .then(item => {
                res.send({ message: 'OK' })
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
    require('../models/competition.model').find({ track: req.params.id })
        .then(items => {
            req.body = { competition: { $in: items.map(i => i._id) } };
            require('./registry.controller').find(req, res);
        })
}

exports.deleteRegistry = (req, res) => {
    req.params.id = req.params.reg;
    require('./registry.controller').delete(req, res);
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