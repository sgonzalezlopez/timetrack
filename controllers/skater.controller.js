const Model = require("../models/skater.model");
const Category = require("../models/category.model");
const filter = require('../middlewares/data.filter')

exports.getAll = (req, res) => {
    try {
        Model.find(filter.getFilter('Skater', {}, req.user))
        .populate('currentclub')
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
        Model.find(filter.getFilter('Skater', {_id : req.params.id}, req.user))
        .populate('currentclub')
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
        Model.findOneAndUpdate(filter.getFilter('Skater', {_id : req.params.id}, req.user), parseBody(req.body), {new: true})
        .then(item => {
            if (item) res.send(item)
            else res.status(400).send({message: res.__('ITEM_NOT_FOUND')})
        })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.updateMany = (req, res) => {
    try {
        if (req.body.filter == null || req.body.filter == '' || req.body.filter == {}) return res.status(400).send({message: res.__('ITEM_NOT_FOUND')})
        Model.updateMany(req.body.filter, parseBody(req.body.update), {new: true})
        .then(item => {
            if (item) res.send(item)
            else res.status(400).send({message: res.__('ITEM_NOT_FOUND')})
        })
    } catch (err) {
        console.error(err);
        throw err
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

exports.delete = (req, res) => {
    try {
        Model.deleteOne(filter.getFilter('Skater', {_id : req.params.id}, req.user))
        .then(item => {
            res.send({message : 'OK'})
        })
    } catch (err) {
        console.error(err);
        throw err
    }
}

exports.find = (req, res, next) => {
    try {
        for (const key in req.body) {
            if (Object.hasOwnProperty.call(req.body, key)) {
                if (req.body[key] == '') delete req.body[key]                
            }
        }

        if (req.body.hasOwnProperty('name')) req.body.name = new RegExp(req.body.name, 'iu')
        if (req.body.hasOwnProperty('lastname')) req.body.lastname = new RegExp(req.body.lastname, 'iu')

        Model.find(filter.getFilter('Skater', req.body, req.user))
        .populate('currentclub')
        .then(items => {
            res.send(items)
        })
        .catch(err => {
            console.error(err);
            next(err);
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
    req.body = {skater : req.params.id}
    require('./registry.controller').find(req, res);
}

exports.deleteRegistry = (req, res) => {
    req.params.id = req.params.reg;
    require('./registry.controller').delete(req, res);
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