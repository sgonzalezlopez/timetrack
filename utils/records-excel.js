const ExcelJS = require('exceljs')
const { normalize } = require('./registry-import')
const { seasonFor } = require('./registry-import-events')
const { writeRecordsWorkbook } = require('./records-workbook')
const { finalTime, hasCompleteSplits } = require('./records-time')

const fields = new Map([
    ['pos', 'position'], ['posicion', 'position'], ['fecha', 'date'], ['patinador', 'skater'],
    ['categoria', 'category'], ['parciales', 'times'], ['tiempo total', 'totalTime'],
    ['evento', 'competition'], ['velocidad', 'speed'], ['prueba', 'race'],
    ['sexo', 'gender'], ['distancia', 'distance'], ['club', 'club']
])

function cellText(value) {
    if (value && typeof value === 'object') {
        if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('')
        if (value.text) return value.text
        if ('result' in value) return String(value.result || '')
    }
    return String(value == null ? '' : value)
}

function splitTime(value) {
    const milliseconds = value % 1000
    const seconds = Math.floor(value / 1000) % 60
    const minutes = Math.floor(value / 60000) % 60
    const hours = Math.floor(value / 3600000)
    return `${hours ? `${hours}:` : ''}${minutes || hours ? `${String(minutes).padStart(2, '0')}:` : ''}` +
        `${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
}

function getUpdateDateCell(workbook) {
    const index = workbook.worksheets.find(s => normalize(s.name) === 'indice')
    const cells = []
    if (index) index.eachRow(row => row.eachCell(cell => {
        if (normalize(cellText(cell.value)).includes('fecha de actualizacion')) {
            const candidate = row.getCell(cell.col + 1)
            if (candidate.isMerged) throw new Error('RECORDS_EXCEL_DATE')
            cells.push(candidate)
        }
    }))
    if (cells.length !== 1) throw new Error('RECORDS_EXCEL_DATE')
    return cells[0]
}

function shiftTailFormula(formula, sheetName, localSheet, firstRow, offset) {
    const reference = /"(?:[^"]|"")*"|(?:(?:'((?:[^']|'')+)'|([A-Za-z_\u00c0-\uffff][\w.\u00c0-\uffff]*))!)?(\$?[A-Z]{1,3})(\$?)([1-9]\d*)(?::(\$?[A-Z]{1,3})(\$?)([1-9]\d*))?/g
    return formula.replace(reference, (match, quoted, plain, col, absolute, row, endCol, endAbsolute, endRow, index) => {
        if (match.startsWith('"') || /[\w.[\]]/.test(formula[index - 1] || '') ||
            /[\w(]/.test(formula[index + match.length] || '')) return match
        const target = quoted ? quoted.replace(/''/g, "'") : plain || localSheet
        if (target.toLowerCase() !== sheetName.toLowerCase()) return match
        const moved = Number(row) >= firstRow ? Number(row) + offset : Number(row)
        const movedEnd = endRow && (Number(endRow) >= firstRow ? Number(endRow) + offset : Number(endRow))
        if (moved > 1048576 || movedEnd > 1048576) throw new Error('RECORDS_EXCEL_LAYOUT')
        const prefix = quoted ? `'${quoted}'!` : plain ? `${plain}!` : ''
        return `${prefix}${col}${absolute}${moved}${endCol ? `:${endCol}${endAbsolute}${movedEnd}` : ''}`
    })
}

async function updateRecordsExcel(buffer, records, { now = new Date(), groupBy = 'none', seasonStartMonth = 1 } = {}) {
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    const currentSeason = seasonFor(today, seasonStartMonth)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheets = workbook.worksheets.filter(sheet => normalize(sheet.name) === 'clas historica')
    if (sheets.length !== 1) throw new Error('RECORDS_EXCEL_SHEET')
    const sheet = sheets[0]
    let headerRow, columns
    for (let number = 1; number <= Math.min(sheet.rowCount, 20); number++) {
        const found = new Map()
        sheet.getRow(number).eachCell((cell, column) => {
            const field = fields.get(normalize(cellText(cell.value)))
            if (field) {
                if (found.has(field)) throw new Error('RECORDS_EXCEL_COLUMNS')
                found.set(field, column)
            }
        })
        if (['date', 'skater', 'totalTime', 'competition'].every(field => found.has(field))) {
            headerRow = number
            columns = found
            break
        }
    }
    if (!headerRow) throw new Error('RECORDS_EXCEL_COLUMNS')
    const updateCell = getUpdateDateCell(workbook)
    const index = updateCell.worksheet
    const styles = number => {
        const row = sheet.getRow(number)
        return {
            height: row.height,
            cells: Array.from({ length: sheet.columnCount }, (_, i) => JSON.parse(JSON.stringify(row.getCell(i + 1).style)))
        }
    }
    let headingTemplate, resultTemplate, currentBlock
    let preservedStart, preservedEnd
    const blocks = new Map()
    const blockKey = (race, gender) => `${normalize(String(race)).replace(/^(\d+)m$/, '$1')}:${gender}`
    const dateCells = []
    sheet.eachRow((row, number) => {
        if (number <= headerRow) return
        if (!preservedStart && normalize(cellText(row.getCell(1).value)) === 'ar sprint m') preservedStart = number
        if (preservedStart) {
            if (row.hasValues) preservedEnd = number
            return
        }
        row.eachCell(cell => {
            if (normalize(cellText(cell.value)) === 'a fecha') dateCells.push({ row: number, col: cell.col + 1 })
        })
        const date = row.getCell(columns.get('date')).value
        const label = cellText(row.getCell(1).value)
        const match = label.match(/^(.*),\s*([MFX])\s*$/i)
        if (match) {
            currentBlock = {
                label: match[1].trim(), order: blocks.size, heading: styles(number)
            }
            blocks.set(blockKey(match[1].trim(), match[2].toUpperCase()), currentBlock)
            if (!headingTemplate) headingTemplate = currentBlock.heading
        }
        if (date instanceof Date) {
            if (!resultTemplate) resultTemplate = styles(number)
            if (currentBlock && !currentBlock.result) {
                currentBlock.result = styles(number)
                currentBlock.textTime = typeof row.getCell(columns.get('totalTime')).value === 'string'
            }
        }
    })
    if (sheet.model.merges.some(range => {
        const match = range.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/)
        return !match || Number(match[2]) > headerRow
    })) throw new Error('RECORDS_EXCEL_LAYOUT')
    const groups = new Map(), issues = []
    for (const record of records) {
        if (preservedStart && /^ar(?:\s|$)/.test(normalize(record.race))) continue
        const reasons = []
        if (!record.skater) reasons.push('RECORDS_EXCEL_INVALID_SKATER')
        if (!record.competition) reasons.push('RECORDS_EXCEL_INVALID_EVENT')
        if (!record.race) reasons.push('RECORDS_EXCEL_INVALID_RACE')
        if (record.skater && !['F', 'M', 'X'].includes(record.skater.gender)) reasons.push('RECORDS_EXCEL_INVALID_GENDER')
        if (!record.date || !Number.isFinite(new Date(record.date).getTime())) reasons.push('RECORDS_EXCEL_INVALID_DATE')
        if (finalTime(record) === null) reasons.push('RECORDS_ALLROUND_INVALID_TIMES')
        if (reasons.length) {
            issues.push({
                id: String(record._id || record.id || ''),
                skater: record.skater && (record.skater.fullname ||
                    `${record.skater.name || ''} ${record.skater.lastname || ''}`.trim()) || '',
                date: record.date ? String(record.date) : '', distance: record.distance, race: record.race || '',
                competition: record.competition && (record.competition.fullname || record.competition.name) || '',
                gender: record.skater && record.skater.gender || '',
                times: Array.isArray(record.times) ? Array.from(record.times) : null,
                totalTime: finalTime(record), reasons
            })
            continue
        }
        const extra = groupBy === 'country' ? record.countryName || record.country :
            groupBy === 'track' ? record.competition.track && record.competition.track.name :
                groupBy === 'season' ? record.competition.season : ''
        const key = JSON.stringify([extra || '', record.race, record.skater.gender])
        if (!groups.has(key)) groups.set(key, { extra, race: record.race, gender: record.skater.gender, records: [] })
        groups.get(key).records.push(record)
    }
    if (issues.length) {
        const error = new Error('RECORDS_EXCEL_DATA')
        error.issues = issues
        throw error
    }
    const generatedEnd = headerRow + [...groups.values()].reduce((sum, group) => sum + 1 + group.records.length, 0)
    const tailOffset = preservedStart ? Math.max(0, generatedEnd + 1 - preservedStart) : 0
    if (preservedEnd && preservedEnd + tailOffset > 1048576) throw new Error('RECORDS_EXCEL_LAYOUT')
    if (tailOffset) {
        const formulas = []
        for (const worksheet of workbook.worksheets) worksheet.eachRow(row => row.eachCell(cell => {
            if (cell.formula) {
                const value = cell.value.formula ? { ...cell.value } : { formula: cell.formula,
                    ...(cell.result === undefined ? {} : { result: cell.result }) }
                value.formula = shiftTailFormula(cell.formula, sheet.name, worksheet.name, preservedStart, tailOffset)
                if (value.ref) value.ref = shiftTailFormula(value.ref, sheet.name, worksheet.name, preservedStart, tailOffset)
                formulas.push({ cell, value })
            }
        }))
        for (const { cell, value } of formulas) cell.value = value
    }
    const preserved = []
    if (preservedStart) {
        for (let row = preservedStart; row <= preservedEnd; row++) {
            const source = sheet.getRow(row)
            preserved.push({
                number: row + tailOffset, height: source.height, hidden: source.hidden, outlineLevel: source.outlineLevel,
                cells: Array.from({ length: sheet.columnCount }, (_, i) => {
                    const cell = source.getCell(i + 1)
                    const value = cell.value && cell.value.sharedFormula ? { formula: cell.formula,
                        ...(cell.result === undefined ? {} : { result: cell.result }) } : structuredClone(cell.value)
                    return { value, style: structuredClone(cell.style), note: structuredClone(cell.note) }
                })
            })
        }
    }
    sheet.eachRow((row, number) => {
        if (number > headerRow) row.eachCell({ includeEmpty: true }, cell => {
            cell.value = null
            // ExcelJS's note setter creates a comment even for null or undefined.
            delete cell._comment
        })
    })
    function addRow(number, template) {
        const row = sheet.getRow(number)
        row.hidden = false
        if (template) {
            row.height = template.height
            template.cells.forEach((style, i) => { row.getCell(i + 1).style = JSON.parse(JSON.stringify(style)) })
        }
        return row
    }
    let number = headerRow + 1
    const ordered = [...groups.values()]
    const extras = [...new Set(ordered.map(group => group.extra))]
    const order = group => {
        const key = blockKey(group.race, group.gender)
        if (seasonStartMonth === 7 && /^100:[MFX]$/.test(key)) return -3 + 'MFX'.indexOf(group.gender)
        return blocks.get(key)?.order ?? blocks.size
    }
    ordered.sort((a, b) => extras.indexOf(a.extra) - extras.indexOf(b.extra) ||
        order(a) - order(b))
    for (const group of ordered) {
        const block = blocks.get(blockKey(group.race, group.gender))
        const heading = addRow(number++, block ? block.heading : headingTemplate)
        const race = block ? block.label : /^\d+(?:[.,]\d+)?$/.test(String(group.race).trim()) ?
            `${group.race}M` : String(group.race)
        heading.getCell(1).value = `${group.extra ? `${group.extra} · ` : ''}${race}, ${group.gender}`
        group.records.sort((a, b) => finalTime(a) - finalTime(b))
        group.records.forEach((record, i) => {
            const totalTime = finalTime(record)
            const values = {
                position: i + 1, date: new Date(record.date),
                skater: record.skater.fullname || `${record.skater.name || ''} ${record.skater.lastname || ''}`.trim(),
                category: record.category || '', times: hasCompleteSplits(record) ? record.times.map(splitTime).join(', ') : '',
                totalTime, competition: record.competition.fullname || record.competition.name || '',
                speed: record.distance ? `${Math.round(record.distance * 3600 / totalTime * 100) / 100} km/h` : '',
                race: record.race, gender: record.skater.gender, distance: record.distance,
                club: record.club && record.club.name || ''
            }
            const row = addRow(number++, block && block.result || resultTemplate)
            for (const [field, column] of columns) {
                row.getCell(column).value = values[field]
                if (field === 'date') row.getCell(column).numFmt = 'dd/mm/yyyy'
                if (field === 'totalTime') {
                    const textTime = totalTime >= 60000 || (block && block.result ? block.textTime : record.distance >= 1000)
                    row.getCell(column).value = textTime ? splitTime(totalTime).replace(/^0(?=\d:)/, '') : totalTime
                    row.getCell(column).numFmt = textTime ? '@' :
                        row.getCell(column).numFmt && row.getCell(column).numFmt !== '0' ? row.getCell(column).numFmt : '#,##0'
                }
            }
            const current = seasonFor(record.date, seasonStartMonth) === currentSeason
            row.eachCell({ includeEmpty: true }, cell => {
                cell.font = { ...cell.font, bold: current }
            })
        })
    }
    for (const saved of preserved) {
        const row = sheet.getRow(saved.number)
        row.height = saved.height
        row.hidden = saved.hidden
        row.outlineLevel = saved.outlineLevel
        saved.cells.forEach(({ value, style, note }, i) => {
            const cell = row.getCell(i + 1)
            cell.value = value
            cell.style = style
            if (note) cell.note = note
        })
    }
    for (const table of sheet.getTables()) {
        const range = table.table.tableRef.match(/^([A-Z]+)(\d+):([A-Z]+)\d+$/)
        if (!range || Number(range[2]) !== headerRow) throw new Error('RECORDS_EXCEL_LAYOUT')
        table.table.tableRef = `${range[1]}${headerRow}:${range[3]}${Math.max(headerRow + 1, number - 1,
            preservedEnd ? preservedEnd + tailOffset : 0)}`
        table.table.autoFilterRef = table.table.tableRef
    }
    updateCell.value = today
    updateCell.numFmt = 'dd/mm/yyyy'
    const dateColumn = dateCells.length && dateCells[0].col >= 3 ? dateCells[0].col : 5
    sheet.getRow(headerRow + 1).getCell(dateColumn - 1).value = 'A fecha:'
    sheet.getRow(headerRow + 1).getCell(dateColumn).value = {
        formula: `'${index.name.replace(/'/g, "''")}'!${updateCell.address}`, result: today
    }
    sheet.getRow(headerRow + 1).getCell(dateColumn).numFmt = 'dd/mm/yyyy'
    workbook.calcProperties.fullCalcOnLoad = true
    return { buffer: await writeRecordsWorkbook(workbook, buffer),
        count: [...groups.values()].reduce((sum, group) => sum + group.records.length, 0), groups: groups.size }
}

module.exports = { updateRecordsExcel, cellText, splitTime, getUpdateDateCell, shiftTailFormula }
