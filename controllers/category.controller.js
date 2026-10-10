const ExcelJS = require("exceljs");
const Model = require("../models/category.model");

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
        Model.findOneAndUpdate({_id:req.params.id}, parseBody(req.body), {new: true})
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
        Model.deleteOne({_id:req.params.id})
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
        Model.find(req.body)
        .then(items => {
            res.send(items)
        })
    } catch (err) {
        console.error(err);
        throw err
    }
}

function cellText(cell) {
    let value = cell.value
    if (value && typeof value === 'object') {
        if ('result' in value) value = value.result
        else if (Array.isArray(value.richText)) value = value.richText.map(t => t.text).join('')
        else if ('text' in value) value = value.text
    }
    return value == null ? '' : String(value).trim()
}

function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function utcDate(year, month, day) {
    return new Date(Date.UTC(year, month, Math.min(day, daysInMonth(year, month))))
}

// Primera fila: cabecera. Columnas: edad al final de la temporada, categoría femenina, categoría masculina.
async function readCategoryAges(buffer) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheet = workbook.getWorksheet('Edades') || workbook.worksheets[0]
    if (!sheet) throw new Error('EMPTY_FILE')

    const ranges = {}
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return
        const age = Number(cellText(row.getCell(1)))
        if (!Number.isInteger(age)) return
        for (const column of [2, 3]) {
            const name = cellText(row.getCell(column))
            if (!name) continue
            const range = ranges[name] || (ranges[name] = { min: age, max: age })
            range.min = Math.min(range.min, age)
            range.max = Math.max(range.max, age)
        }
    })
    return ranges
}

exports.updateFromFile = async (req, res) => {
    try {
        const file = req.files && req.files.file
        if (!file) return res.status(400).send({ message: res.__('CATEGORY_UPDATE_FILE_REQUIRED') })

        const startDay = parseInt(req.body.startDay), startMonth = parseInt(req.body.startMonth)
        const endDay = parseInt(req.body.endDay), endMonth = parseInt(req.body.endMonth)
        const valid = (d, m) => m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(2000, m - 1)
        if (!valid(startDay, startMonth) || !valid(endDay, endMonth)) {
            return res.status(400).send({ message: res.__('CATEGORY_UPDATE_SEASON_INVALID') })
        }

        let ranges
        try {
            ranges = await readCategoryAges(file.data)
        } catch (err) {
            return res.status(400).send({ message: res.__('CATEGORY_UPDATE_FILE_INVALID') })
        }
        if (Object.keys(ranges).length === 0) return res.status(400).send({ message: res.__('CATEGORY_UPDATE_FILE_INVALID') })

        // Temporada en curso: termina en la próxima fecha de fin (>= hoy) y empieza en la última fecha de inicio anterior a ese final
        const now = new Date()
        const today = utcDate(now.getFullYear(), now.getMonth(), now.getDate())
        let seasonEnd = utcDate(today.getUTCFullYear(), endMonth - 1, endDay)
        if (seasonEnd < today) seasonEnd = utcDate(today.getUTCFullYear() + 1, endMonth - 1, endDay)
        const endYear = seasonEnd.getUTCFullYear()
        let seasonStart = utcDate(endYear, startMonth - 1, startDay)
        if (seasonStart > seasonEnd) seasonStart = utcDate(endYear - 1, startMonth - 1, startDay)

        const categories = await Model.find()
        const updated = [], notInFile = []
        for (const category of categories) {
            const range = ranges[(category.name || '').trim()]
            if (!range) { notInFile.push(category.name); continue }
            // Nacidos de modo que su edad el último día de temporada esté entre min y max
            const to = utcDate(endYear - range.min, seasonEnd.getUTCMonth(), seasonEnd.getUTCDate())
            const from = utcDate(endYear - range.max - 1, seasonEnd.getUTCMonth(), seasonEnd.getUTCDate())
            from.setUTCDate(from.getUTCDate() + 1)
            category.from = from
            category.to = to
            await category.save()
            updated.push(category.name)
        }

        const missing = Object.keys(ranges).filter(name => !categories.some(c => (c.name || '').trim() === name))
        res.send({ updated, notInFile, missing, seasonStart, seasonEnd })
    } catch (err) {
        console.error(err)
        res.status(500).send({ message: err.message })
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