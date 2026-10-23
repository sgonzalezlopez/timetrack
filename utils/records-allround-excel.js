const ExcelJS = require('exceljs')
const { normalize } = require('./registry-import')
const { cellText, getUpdateDateCell } = require('./records-excel')

const distances = [500, 1000, 1500, 3000]
const clone = value => JSON.parse(JSON.stringify(value))

function allroundTime(milliseconds) {
    const hundredths = Math.round(milliseconds / 10)
    const minutes = Math.floor(hundredths / 6000)
    const seconds = Math.floor(hundredths / 100) % 60
    const fraction = hundredths % 100
    return `${minutes ? `${minutes}.` : ''}${String(seconds).padStart(2, '0')},${String(fraction).padStart(2, '0')}`
}

function compareSkaters(a, b) {
    const completeA = distances.every(d => a.best.has(d))
    const completeB = distances.every(d => b.best.has(d))
    if (completeA !== completeB) return completeA ? -1 : 1
    if (completeA) {
        const score = skater => distances.reduce((sum, d) => sum + Math.round(skater.best.get(d) / 10) * 500 / d, 0)
        const difference = score(a) - score(b)
        if (Math.abs(difference) > 1e-9) return difference
    } else {
        const firstA = distances.find(d => a.best.has(d))
        const firstB = distances.find(d => b.best.has(d))
        if (firstA !== firstB) return firstA - firstB
        const difference = a.best.get(firstA) - b.best.get(firstB)
        if (difference) return difference
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

async function updateAllroundExcel(buffer, records, { now = new Date() } = {}) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheets = workbook.worksheets.filter(s => normalize(s.name) === 'allround historico')
    if (sheets.length !== 1) throw new Error('RECORDS_ALLROUND_SHEET')
    const sheet = sheets[0]
    if (sheet.model.merges.length) throw new Error('RECORDS_EXCEL_LAYOUT')
    const sections = []
    sheet.eachRow(row => {
        const gender = cellText(row.getCell(1).value).trim().toUpperCase()
        if (!['M', 'F'].includes(gender)) return
        const name = normalize(cellText(row.getCell(2).value))
        const columns = distances.map(distance => {
            let column
            row.eachCell(cell => {
                if (normalize(cellText(cell.value)).replace(/ /g, '') === `${distance}m`) column = cell.col
            })
            return column
        })
        let total
        row.eachCell(cell => { if (normalize(cellText(cell.value)) === 'total ar') total = cell.col })
        if (!['patinador', 'patinadora'].includes(name) || columns.some(col => !col) ||
            !total || total <= Math.max(...columns)) throw new Error('RECORDS_ALLROUND_LAYOUT')
        sections.push({ gender, row: row.number, columns, total })
    })
    if (sections.length !== 2 || sections[0].gender !== 'M' || sections[1].gender !== 'F') {
        throw new Error('RECORDS_ALLROUND_LAYOUT')
    }
    const updateCell = getUpdateDateCell(workbook)
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i]
        section.end = i === 0 ? sections[1].row - 2 : sheet.rowCount
        section.header = Array.from({ length: section.total }, (_, col) => ({
            value: sheet.getRow(section.row).getCell(col + 1).value,
            style: clone(sheet.getRow(section.row).getCell(col + 1).style)
        }))
        section.styles = Array.from({ length: section.total }, (_, col) =>
            clone(sheet.getRow(section.row + 1).getCell(col + 1).style))
        section.formulas = new Map()
        for (let row = section.row + 1; row <= section.end; row++) {
            const cell = sheet.getRow(row).getCell(section.total)
            if (cell.formula) section.formulas.set(row, cell.formula)
        }
        if (!section.formulas.size) throw new Error('RECORDS_ALLROUND_LAYOUT')
    }
    const skaters = new Map()
    for (const record of records) {
        if (!distances.includes(record.distance) || !record.skater || record.skater.country !== 'ESP' ||
            !record.competition || [true, 'true'].includes(record.competition.training)) continue
        const id = String(record.skater._id || record.skater.id || '')
        if (!id || !['M', 'F'].includes(record.skater.gender) || !Array.isArray(record.times) ||
            !record.times.length || record.times.some(t => !Number.isFinite(t) || t <= 0)) {
            throw new Error('RECORDS_EXCEL_DATA')
        }
        const key = `${record.skater.gender}:${id}`
        if (!skaters.has(key)) skaters.set(key, {
            id, gender: record.skater.gender,
            name: record.skater.fullname || `${record.skater.name || ''} ${record.skater.lastname || ''}`.trim(),
            best: new Map()
        })
        const skater = skaters.get(key)
        if (!skater.name) throw new Error('RECORDS_EXCEL_DATA')
        const total = record.times.reduce((sum, time) => sum + time, 0)
        if (!skater.best.has(record.distance) || total < skater.best.get(record.distance)) skater.best.set(record.distance, total)
    }
    const men = [...skaters.values()].filter(s => s.gender === 'M').sort(compareSkaters)
    const women = [...skaters.values()].filter(s => s.gender === 'F').sort(compareSkaters)
    const femaleRow = Math.max(sections[1].row, sections[0].row + men.length + 2)
    const lastRow = Math.max(sheet.rowCount, femaleRow + women.length)
    const totalColumn = Math.max(...sections.map(s => s.total))
    for (let row = sections[0].row; row <= lastRow; row++) {
        for (let col = 1; col <= totalColumn; col++) sheet.getRow(row).getCell(col).value = null
    }
    for (const [index, entries] of [men, women].entries()) {
        const section = sections[index]
        const start = index === 0 ? section.row : femaleRow
        section.header.forEach((cell, i) => {
            sheet.getRow(start).getCell(i + 1).value = cell.value
            sheet.getRow(start).getCell(i + 1).style = clone(cell.style)
        })
        const [templateRow, templateFormula] = section.formulas.entries().next().value
        const capacity = Math.max(entries.length, Math.max(...section.formulas.keys()) - section.row)
        for (let i = 0; i < capacity; i++) {
            const rowNumber = start + i + 1
            const row = sheet.getRow(rowNumber)
            row.hidden = false
            section.styles.forEach((style, col) => { row.getCell(col + 1).style = clone(style) })
            const originalRow = section.row + i + 1
            const sourceRow = section.formulas.has(originalRow) ? originalRow : templateRow
            const formula = section.formulas.get(originalRow) || templateFormula
            row.getCell(section.total).value = { formula: formula.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g,
                (match, column, absolute, number) => absolute ? match : `${column}${Number(number) + rowNumber - sourceRow}`) }
            if (i >= entries.length) continue
            const skater = entries[i]
            row.getCell(1).value = i + 1
            row.getCell(2).value = skater.name
            distances.forEach((distance, j) => {
                const cell = row.getCell(section.columns[j])
                cell.value = skater.best.has(distance) ? allroundTime(skater.best.get(distance)) : null
                cell.numFmt = '@'
            })
        }
    }
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    updateCell.value = today
    updateCell.numFmt = 'dd/mm/yyyy'
    sheet.eachRow(row => row.eachCell(cell => {
        const value = cell.value
        if (value && value.formula && value.formula.replace(/'/g, '') === `${updateCell.worksheet.name}!${updateCell.address}`) {
            cell.value = { formula: value.formula, result: today }
        }
    }))
    workbook.calcProperties.fullCalcOnLoad = true
    return { buffer: await workbook.xlsx.writeBuffer(), count: skaters.size, groups: 2 }
}

module.exports = { updateAllroundExcel, allroundTime }
