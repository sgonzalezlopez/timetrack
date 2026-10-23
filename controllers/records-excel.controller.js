const { getRecords } = require('./registry.controller')
const { updateRecordsExcel } = require('../utils/records-excel')

exports.update = async (req, res, next) => {
    const file = req.files && req.files.file
    if (!file || Array.isArray(file) || !file.data || !/\.xlsx$/i.test(file.name) ||
        file.size > 25 * 1024 * 1024) {
        return res.status(400).send({ message: res.__('RECORDS_EXCEL_FILE') })
    }
    let filters
    try {
        filters = JSON.parse(req.body.filters)
        if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('Invalid filters')
    } catch (err) {
        console.error('Records Excel filters:', err)
        return res.status(400).send({ message: res.__('RECORDS_EXCEL_FILTERS') })
    }
    try {
        filters.groupBy = filters.groupBy || 'none'
        req.body = filters
        const groupBy = filters.groupBy
        const records = await getRecords(req)
        let result
        try {
            result = await updateRecordsExcel(file.data, records, {
                groupBy, seasonStartMonth: req.app.locals.registryImportSeasonStartMonth
            })
        } catch (err) {
            console.error('Records Excel workbook:', err)
            const known = ['RECORDS_EXCEL_SHEET', 'RECORDS_EXCEL_COLUMNS', 'RECORDS_EXCEL_DATE',
                'RECORDS_EXCEL_LAYOUT', 'RECORDS_EXCEL_DATA']
            return res.status(400).send({ message: res.__(known.includes(err.message) ? err.message : 'RECORDS_EXCEL_FILE') })
        }
        res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        res.set('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(file.name))
        res.set('X-Records-Count', String(result.count))
        res.set('X-Records-Groups', String(result.groups))
        res.send(Buffer.from(result.buffer))
    } catch (err) { next(err) }
}
