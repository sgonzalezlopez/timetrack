const Model = require("../models/skater.model");
const Category = require("../models/category.model");
const filter = require('../middlewares/data.filter')

exports.getAll = async (req, res, next) => {
    try {
        await Model.find(filter.getFilter('Skater', {}, req.user))
        .populate('currentclub')
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
        await Model.find(filter.getFilter('Skater', {_id : req.params.id}, req.user))
        .populate('currentclub')
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
        await Model.findOneAndUpdate(filter.getFilter('Skater', {_id : req.params.id}, req.user), parseBody(req.body), {returnDocument: 'after'})
        .then(item => {
            if (item) res.send(item)
            else res.status(400).send({message: res.__('ITEM_NOT_FOUND')})
        })
    } catch (err) {
        console.error(err);
        next(err)
    }
}

exports.updateMany = async (req, res, next) => {
    try {
        if (req.body.filter == null || req.body.filter == '' || req.body.filter == {}) return res.status(400).send({message: res.__('ITEM_NOT_FOUND')})
        await Model.updateMany(req.body.filter, parseBody(req.body.update))
        .then(item => {
            if (item) res.send(item)
            else res.status(400).send({message: res.__('ITEM_NOT_FOUND')})
        })
    } catch (err) {
        console.error(err);
        next(err)
    }
}

// Las categorías de mujeres empiezan por "L" y las de hombres por "M"; el resto aplica a ambos sexos
function categoryGender(name) {
    const initial = (name || '').trim().charAt(0).toUpperCase()
    if (initial === 'L') return 'F'
    if (initial === 'M') return 'M'
    return null
}

exports.updateCategories = async (req, res) => {
    try {
        const categories = (await Category.find()).filter(c => c.name && c.from && c.to)
        const skaters = await Model.find()
        const updated = [], notUpdated = []

        for (const skater of skaters) {
            const info = {
                id: skater.id,
                fullname: `${skater.name || ''} ${skater.lastname || ''}`.trim(),
                previousCategory: skater.currentcategory || null,
                category: null
            }
            if (!skater.birthDate) { notUpdated.push({ ...info, reason: 'NO_BIRTHDATE' }); continue }
            if (!skater.gender) { notUpdated.push({ ...info, reason: 'NO_GENDER' }); continue }

            const matches = categories.filter(c => {
                const gender = categoryGender(c.name)
                return (gender === null || gender === skater.gender) && skater.birthDate >= c.from && skater.birthDate <= c.to
            })
            if (matches.length === 0) { notUpdated.push({ ...info, reason: 'NO_CATEGORY_MATCH' }); continue }
            if (matches.length > 1) { notUpdated.push({ ...info, reason: 'AMBIGUOUS_CATEGORY' }); continue }

            const category = matches[0].name.trim()
            if (skater.currentcategory !== category) {
                skater.currentcategory = category
                await skater.save()
            }
            updated.push({ ...info, category, changed: info.previousCategory !== category })
        }

        res.send({ updated, notUpdated })
    } catch (err) {
        console.error(err)
        res.status(500).send({ message: err.message })
    }
}

exports.delete = async (req, res, next) => {
    try {
        await Model.deleteOne(filter.getFilter('Skater', {_id : req.params.id}, req.user))
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

        if (req.body.hasOwnProperty('name')) req.body.name = new RegExp(req.body.name, 'iu')
        if (req.body.hasOwnProperty('lastname')) req.body.lastname = new RegExp(req.body.lastname, 'iu')

        await Model.find(filter.getFilter('Skater', req.body, req.user))
        .populate('currentclub')
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
        req.body = { skater: req.params.id }
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
        return Model.find(filter.getFilter('Skater', {_id : id}, user))
        .populate('currentclub')
        .then(item => {
            if (item.length == 0) return null;
            return item[0]
        })
    } catch (err) {
        console.error(err);
        throw err
    }

}