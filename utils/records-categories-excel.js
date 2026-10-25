const ExcelJS = require('exceljs')
const { normalize } = require('./registry-import')
const { seasonFor } = require('./registry-import-events')
const { cellText, splitTime, getUpdateDateCell } = require('./records-excel')
const { writeRecordsWorkbook } = require('./records-workbook')
const { finalTime } = require('./records-time')

const groups = ['absoluta', 'junior', 'junior a', 'junior b', 'junior c', 'y', 'master']
const distances = new Set([100, 300, 500, 1000, 1500, 3000, 5000, 10000])
const headers = new Map([
    ['distancia sexo', 'race'], ['fecha', 'date'], ['patinador', 'skater'],
    ['categoria', 'category'], ['tiempo total', 'totalTime']
])
const clone = value => JSON.parse(JSON.stringify(value))

function categoryGroup(category) {
    const code = String(category || '').trim().toUpperCase()
    if (/^[LM]A[12]$/.test(code)) return 'junior a'
    if (/^[LM]B[12]$/.test(code)) return 'junior b'
    if (/^[LM]C[12]$/.test(code)) return 'junior c'
    if (/^[LM]Y(?:[A-Z0-9]|\+)*$/.test(code)) return 'y'
    if (/^[LM]\d+(?:[A-Z]|\+)?$/.test(code)) return 'master'
    return null
}

async function updateCategoriesExcel(buffer, records, { now = new Date(), seasonStartMonth = 1 } = {}) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheets = workbook.worksheets.filter(s => normalize(s.name) === 'por categorias')
    if (sheets.length !== 1) throw new Error('RECORDS_CATEGORIES_SHEET')
    const sheet = sheets[0]
    if (sheet.model.merges.length) throw new Error('RECORDS_EXCEL_LAYOUT')
    const updateCell = getUpdateDateCell(workbook)
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    const currentSeason = seasonFor(today, seasonStartMonth)
    const blocks = []
    sheet.eachRow(row => row.eachCell(cell => {
        const group = normalize(cellText(cell.value))
        if (!groups.includes(group)) return
        if (headers.get(normalize(cellText(row.getCell(cell.col + 1).value))) !== 'race') return
        const columns = new Map()
        for (let col = cell.col + 1; col <= sheet.columnCount; col++) {
            const field = headers.get(normalize(cellText(row.getCell(col).value)))
            if (!field) break
            if (columns.has(field)) throw new Error('RECORDS_CATEGORIES_LAYOUT')
            columns.set(field, col)
        }
        if (columns.size !== headers.size) throw new Error('RECORDS_CATEGORIES_LAYOUT')
        blocks.push({ group, title: cellText(cell.value), row: row.number, col: cell.col, columns,
            start: cell.col, end: Math.max(...columns.values()) })
    }))
    if (blocks.length !== groups.length || new Set(blocks.map(b => b.group)).size !== groups.length) {
        throw new Error('RECORDS_CATEGORIES_LAYOUT')
    }
    for (const block of blocks) {
        const next = blocks.filter(b => b.col === block.col && b.row > block.row).sort((a, b) => a.row - b.row)[0]
        block.lastRow = next ? next.row - 1 : sheet.rowCount
        block.slots = []
        block.tables = sheet.getTables().filter(table => {
            const range = table.table.tableRef.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
            return range && Number(range[2]) === block.row &&
                sheet.getCell(`${range[1]}${range[2]}`).col === block.columns.get('race')
        })
        block.header = []
        for (let col = block.start; col <= block.end; col++) {
            const cell = sheet.getRow(block.row).getCell(col)
            block.header.push({ col, value: cell.value, style: clone(cell.style) })
        }
        for (let number = block.row + 1; number <= block.lastRow; number++) {
            const row = sheet.getRow(number)
            const label = cellText(row.getCell(block.columns.get('race')).value)
            const match = label.match(/^\s*(\d+(?:[.,]\d+)?)\s*M?\s*,\s*([MFX])\s*$/i)
            if (!match) continue
            const distance = Number(match[1].replace(',', '.'))
            if (!distances.has(distance)) continue
            if (block.slots.some(s => s.distance === distance && s.gender === match[2].toUpperCase())) {
                throw new Error('RECORDS_CATEGORIES_LAYOUT')
            }
            block.slots.push({ distance, gender: match[2].toUpperCase() })
            if (!block.labelStyle) {
                block.labelStyle = Array.from({ length: block.end - block.start + 1 }, (_, i) =>
                    clone(row.getCell(block.start + i).style))
                block.resultStyle = Array.from({ length: block.end - block.start + 1 }, (_, i) =>
                    clone(sheet.getRow(number + 1).getCell(block.start + i).style))
                block.labelHeight = row.height
                block.resultHeight = sheet.getRow(number + 1).height
            }
        }
        if (!block.slots.length) throw new Error('RECORDS_CATEGORIES_LAYOUT')
    }
    const eligible = records.filter(record => distances.has(record.distance) &&
        record.skater && ['ES', 'ESP'].includes(record.country) &&
        record.competition && ![true, 'true'].includes(record.competition.training))
    const qualifies = (record, group) => {
        const category = categoryGroup(record.category)
        return group === 'absoluta' || category === group ||
            group === 'junior' && ['junior a', 'junior b', 'junior c'].includes(category)
    }
    const issues = new Map()
    for (const block of blocks) {
        for (const record of eligible) {
            const { distance } = record
            const gender = record.skater.gender
            if (['M', 'F'].includes(gender) &&
                qualifies(record, block.group) &&
                !block.slots.some(s => s.distance === distance && s.gender === gender)) {
                block.slots.push({ distance, gender })
            }
        }
        block.slots.sort((a, b) => a.distance - b.distance || 'MFX'.indexOf(a.gender) - 'MFX'.indexOf(b.gender))
        for (const slot of block.slots) {
            const matches = eligible.filter(r => r.distance === slot.distance &&
                r.skater.gender === slot.gender && qualifies(r, block.group))
            for (const record of matches) {
                const reasons = []
                if (!record.date || !Number.isFinite(new Date(record.date).getTime())) reasons.push('RECORDS_EXCEL_INVALID_DATE')
                if (finalTime(record) === null) reasons.push('RECORDS_ALLROUND_INVALID_TIMES')
                if (reasons.length) issues.set(record, {
                    id: String(record._id || record.id || ''),
                    skater: record.skater.fullname || `${record.skater.name || ''} ${record.skater.lastname || ''}`.trim(),
                    date: record.date ? String(record.date) : '', distance: record.distance, race: record.race || '',
                    competition: record.competition.fullname || record.competition.name || '',
                    gender: record.skater.gender, totalTime: finalTime(record),
                    times: Array.isArray(record.times) ? Array.from(record.times) : null, reasons
                })
            }
            const total = finalTime
            matches.sort((a, b) => total(a) - total(b) || new Date(a.date) - new Date(b.date))
            const seen = new Set()
            slot.records = matches.length ? matches.filter(record => {
                if (total(record) !== total(matches[0])) return false
                const identity = String(record.skater._id || record.skater.id ||
                    normalize(record.skater.fullname || `${record.skater.name || ''} ${record.skater.lastname || ''}`))
                if (seen.has(identity)) return false
                seen.add(identity)
                return true
            }) : []
        }
    }
    if (issues.size) {
        const error = new Error('RECORDS_EXCEL_DATA')
        error.issues = [...issues.values()]
        throw error
    }
    if (!blocks.some(block => block.slots.some(slot => slot.records.length))) {
        throw new Error('RECORDS_CATEGORIES_EMPTY')
    }
    for (const block of blocks) {
        for (let row = block.row; row <= block.lastRow; row++) {
            for (let col = block.start; col <= block.end; col++) {
                const cell = sheet.getRow(row).getCell(col)
                cell.value = null
                cell.style = {}
            }
        }
    }
    const bands = [...new Set(blocks.map(b => b.row))].sort((a, b) => a - b)
    let startRow = bands[0], count = 0, pairs = 0
    for (let band = 0; band < bands.length; band++) {
        const bandBlocks = blocks.filter(b => b.row === bands[band])
        let height = 1
        for (const block of bandBlocks) {
            block.header.forEach(c => {
                const cell = sheet.getRow(startRow).getCell(c.col)
                cell.value = c.value
                cell.style = clone(c.style)
            })
            let rowNumber = startRow + 1
            for (const slot of block.slots) {
                const label = sheet.getRow(rowNumber++)
                label.height = block.labelHeight
                block.labelStyle.forEach((style, i) => { label.getCell(block.start + i).style = clone(style) })
                label.getCell(block.columns.get('race')).value = `${slot.distance}M, ${slot.gender}`
                pairs++
                for (const record of slot.records.length ? slot.records : [null]) {
                    const row = sheet.getRow(rowNumber++)
                    row.height = block.resultHeight
                    block.resultStyle.forEach((style, i) => { row.getCell(block.start + i).style = clone(style) })
                    const values = record ? {
                        date: new Date(record.date),
                        skater: record.skater.fullname || `${record.skater.name || ''} ${record.skater.lastname || ''}`.trim(),
                        category: record.category || '',
                        totalTime: finalTime(record) < 60000 && record.distance < 1000 ? finalTime(record) :
                            splitTime(finalTime(record)).replace(/^0(?=\d:)/, '')
                    } : {}
                    for (const [field, col] of block.columns) {
                        row.getCell(col).value = values[field] == null ? null : values[field]
                        if (field === 'date') row.getCell(col).numFmt = row.getCell(col).numFmt || 'dd/mm/yyyy'
                        if (field === 'totalTime') row.getCell(col).numFmt = typeof values.totalTime === 'number' ?
                            row.getCell(col).numFmt && row.getCell(col).numFmt !== '0' ? row.getCell(col).numFmt : '#,##0' : '@'
                    }
                    for (let col = block.start; col <= block.end; col++) {
                        const cell = row.getCell(col)
                        cell.font = { ...cell.font, bold: !!record && seasonFor(record.date, seasonStartMonth) === currentSeason }
                    }
                    if (record) count++
                }
            }
            for (const table of block.tables) {
                const range = table.table.tableRef.match(/^([A-Z]+)\d+:([A-Z]+)\d+$/)
                table.table.tableRef = `${range[1]}${startRow}:${range[2]}${rowNumber - 1}`
                table.table.autoFilterRef = table.table.tableRef
            }
            height = Math.max(height, rowNumber - startRow)
        }
        startRow += height + 3
    }
    updateCell.value = today
    updateCell.numFmt = 'dd/mm/yyyy'
    sheet.eachRow(row => row.eachCell(cell => {
        const value = cell.value
        if (value && typeof value === 'object' && value.formula &&
            value.formula.replace(/'/g, '') === `${updateCell.worksheet.name}!${updateCell.address}`) {
            cell.value = { formula: value.formula, result: today }
        }
    }))
    workbook.calcProperties.fullCalcOnLoad = true
    return { buffer: await writeRecordsWorkbook(workbook, buffer), count, groups: pairs }
}

module.exports = { updateCategoriesExcel, categoryGroup }
