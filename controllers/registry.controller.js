const Model = require("../models/registry.model");
const filter = require('../middlewares/data.filter')
const { tidy, groupBy, n, summarize, arrange, fullSeq, complete, min, first } = require('@tidyjs/tidy');
const countrylist = require('i18n-iso-countries');
const i18n = require("../core/i18n/i18n.config");


exports.getAll = (req, res) => {
    try {
        Model.find(filter.getFilter('Registry', {}, req.user))
            .populate({ path: 'skater' })
            .populate({ path: 'club' })
            .populate({ path: 'competition', populate: { path: 'track' } })
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
        Model.find(filter.getFilter('Registry', { _id: req.params.id }, req.user))
            .populate({ path: 'skater' })
            .populate({ path: 'club' })
            .populate({ path: 'competition', populate: { path: 'track' } })
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
        if (!req.body.times) req.body.times = []
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
        Model.findOneAndUpdate(filter.getFilter('Registry', { _id: req.params.id }, req.user), parseBody(req.body))
            .then(item => {
                if (item) res.send(item)
                else res.status(400).send({ message: res.__('ITEM_NOT_FOUND') })
            })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.delete = (req, res) => {
    try {
        Model.deleteOne(filter.getFilter('Registry', { _id: req.params.id }, req.user))
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

        var competitionPopulate = { path: 'competition', populate: { path: 'track' } }
        var skaterPopulate = { path: 'skater', populate: { path: 'currentclub' } }
        competitionPopulate.match = {};
        skaterPopulate.match = {};
        if (req.body.training) competitionPopulate.match.training = { $eq: req.body.training }
        if (req.body.track) competitionPopulate.match.track = { $eq: req.body.track }
        if (req.body.season) competitionPopulate.match.season = { $eq: req.body.season }
        if (req.body.category) req.body.category = { $in: req.body.category }
        if (req.body.gender) skaterPopulate.match.gender = { $eq: req.body.gender }

        Model.find(filter.getFilter('Registry', parseBody(req.body), req.user))
            .populate(skaterPopulate)
            .populate({ path: 'club' })
            .populate(competitionPopulate)
            .then(items => {
                if (req.body.training) items = items.filter(i => i.competition != null)
                if (req.body.track) items = items.filter(i => i.competition != null)
                if (req.body.season) items = items.filter(i => i.competition != null)
                if (req.body.gender) items = items.filter(i => i.skater != null)
                res.send(items)
            })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.findRecords = (req, res) => {
    try {
        for (const key in req.body) {
            if (Object.hasOwnProperty.call(req.body, key)) {
                if (req.body[key] == '') delete req.body[key]
            }
        }

        var competitionPopulate = { path: 'competition', populate: { path: 'track' } }
        var skaterPopulate = { path: 'skater', populate: { path: 'currentclub' } }
        competitionPopulate.match = {};
        skaterPopulate.match = {};
        if (req.body.training) competitionPopulate.match.training = { $eq: req.body.training }
        if (req.body.track) competitionPopulate.match.track = { $eq: req.body.track }
        if (req.body.season) competitionPopulate.match.season = { $eq: req.body.season }
        if (req.body.category) req.body.category = { $in: req.body.category }
        if (req.body.gender) skaterPopulate.match.gender = { $eq: req.body.gender }
        if (req.body.country) skaterPopulate.match.country = { $eq: req.body.country }

        Model.find(parseBody(req.body))
            .populate(skaterPopulate)
            .populate({ path: 'club' })
            .populate(competitionPopulate)
            .then(items => {
                if (req.body.training) items = items.filter(i => i.competition != null)
                if (req.body.track) items = items.filter(i => i.competition != null)
                if (req.body.season) items = items.filter(i => i.competition != null)
                if (req.body.gender) items = items.filter(i => i.skater != null)
                if (req.body.country) items = items.filter(i => i.skater != null)
                items.forEach(a => {
                    a.totalTime = a.times ? a.times.reduce((p, b) => p + b, 0) : null
                    a.country = countrylist.getName(a.skater.country, i18n.getLocale(req))
                    a.season = a.competition.season
                    a.track = a.competition.track.name
                    a.gender = a.skater.gender
                    a.skaterId = a.skater.id
                })

                var gb = req.body.groupBy != 'none' ? [req.body.groupBy, 'race', 'gender'] : ['race', 'gender'];

                groupedByRace = tidy(
                    items,
                    arrange('totalTime'),
                    groupBy(gb, [], groupBy.entries())
                )

                bestByRace = getBestRecords(groupedByRace, req.body.top || 1, req.body.bestForSkater || false)

                res.send(bestByRace)
            })
            .catch(err => {
                console.error(err);
                res.status(500).send(err)
            })
    } catch (err) {
        console.error(err);
        throw err
    }
}


function getBestRecords(data, ntop, bestForSkater) {
    result = [];
    if (data && data.length > 0 && data[0].hasOwnProperty('_doc')) {
        if (ntop == '*') ntop = data.length
        if (bestForSkater == 'true') {
            groupedBySkater = tidy(data, arrange('totalTime'), groupBy('skaterId', [], groupBy.entries()))
            d = getBestRecords(groupedBySkater, 1, 'false')
            d.map((a, index) => { a.position = index + 1})
            return d.slice(0, ntop)

        } else {
            var nBest = data.sort((a, b) => a.totalTime - b.totalTime).slice(0, ntop).map((a, index) => {
                a._doc.totalTime = a._doc.times.reduce((p, b) => p + b, 0)
                a._doc.country = a.country
                a._doc.position = index + 1;
                return a._doc;
            })
        }
        return nBest;
    }
    else {
        data.forEach(element => {
            result = [...result, ...getBestRecords(element[1], ntop, bestForSkater)]
        })
    }
    return result
}

function getElements(races, n) {
    result = [];
    races.forEach(race => {
        var nBest = race[1].sort((a, b) => a.totalTime - b.totalTime).slice(0, n).map((a, index) => {
            a._doc.totalTime = a._doc.times.reduce((p, b) => p + b, 0)
            a._doc.country = a.country
            a._doc.gender = a.gender
            a._doc.position = index + 1;
            return a._doc;
        })
        result = [...result, ...nBest]
    })
    return result;
}


function parseBody(body) {
    try {
        var values = body
        for (const key in body) {
            if (Object.hasOwnProperty.call(body, key)) {
                values[key] = body[key] == "" ? null : body[key];
            }
        }

        return values;
    }
    catch (err) {
        console.error(err);
        throw err
    }
}