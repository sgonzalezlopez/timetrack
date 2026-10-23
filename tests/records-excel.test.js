const { test } = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('exceljs')
const { updateRecordsExcel } = require('../utils/records-excel')

async function fixture({ reordered = false } = {}) {
    const workbook = new ExcelJS.Workbook()
    const index = workbook.addWorksheet('Índice')
    index.getCell('C2').value = 'Fecha de actualización:'
    index.getCell('D2').value = new Date('2020-01-01T00:00:00Z')
    const sheet = workbook.addWorksheet('Clas. histórica')
    sheet.addRow(reordered ?
        ['Fecha', 'Evento', 'Tiempo total', 'Patinador', 'Categoría', 'Parciales', 'Pos', 'Velocidad'] :
        ['Pos', 'Fecha', 'Patinador', 'Categoría', 'Parciales', 'Tiempo total', 'Evento', 'Velocidad', 'ÍNDICE'])
    sheet.getCell('A2').value = '500M, M'
    sheet.getCell('D2').value = 'A fecha:'
    sheet.getCell('E2').value = { formula: "'Índice'!D2", result: new Date('2020-01-01T00:00:00Z') }
    sheet.getCell('A2').font = { bold: true, color: { argb: 'FFAA00FF' } }
    sheet.addRow(reordered ?
        [new Date('2020-01-01'), 'Old', 50000, 'Old skater'] :
        [1, new Date('2020-01-01'), 'Old skater', 'MA2', '50.000', 50000, 'Old', '36 km/h'])
    sheet.getRow(3).height = 24
    sheet.getRow(3).getCell(reordered ? 1 : 2).numFmt = 'dd/mm/yyyy'
    sheet.getColumn(3).width = 30
    sheet.getCell('A60').value = 'STALE'
    const other = workbook.addWorksheet('Temporada')
    other.mergeCells('A1:B1')
    other.getCell('A1').value = 'Keep me'
    other.getCell('C2').value = { formula: "'Índice'!D2", result: new Date('2020-01-01T00:00:00Z') }
    return workbook
}

const result = overrides => ({
    race: '500', date: '2026-10-23', distance: 500, times: [11148, 29884],
    category: 'LA2', skater: { fullname: 'Ona Rodríguez Cornejo', gender: 'F', country: 'ESP' },
    competition: { fullname: 'International Race (Inzell)', name: 'International Race', season: '2026-2027',
        track: { name: 'Max Aicher Arena' } }, ...overrides
})
const now = new Date(2026, 9, 23, 12)
async function update(workbook, records, options = {}) {
    const original = await workbook.xlsx.writeBuffer()
    const output = await updateRecordsExcel(original, records, { now, ...options })
    const updated = new ExcelJS.Workbook()
    await updated.xlsx.load(output.buffer)
    return { ...output, updated }
}

test('replaces historical results, groups by race and gender and preserves other sheets and styles', async () => {
    const workbook = await fixture()
    const otherBefore = workbook.getWorksheet('Temporada').getSheetValues()
    const { updated, count, groups } = await update(workbook, [
        result({ times: [42000] }), result(), result({ race: '1000', distance: 1000, times: [80000] })
    ])
    const sheet = updated.getWorksheet('Clas. histórica')
    assert.equal(count, 3)
    assert.equal(groups, 2)
    assert.equal(sheet.getCell('A2').value, '500M, F')
    assert.equal(sheet.getCell('A2').font.bold, true)
    assert.equal(sheet.getCell('F3').value, 41032)
    assert.equal(sheet.getCell('E3').value, '11.148, 29.884')
    assert.equal(sheet.getCell('C3').value, 'Ona Rodríguez Cornejo')
    assert.equal(sheet.getCell('A4').value, 2)
    assert.equal(sheet.getCell('A5').value, '1000M, F')
    assert.equal(sheet.getCell('A60').value, null)
    assert.equal(sheet.getRow(3).height, 24)
    assert.equal(sheet.getColumn(3).width, 30)
    assert.equal(sheet.getCell('B3').numFmt, 'dd/mm/yyyy')
    assert.deepEqual(updated.getWorksheet('Temporada').getSheetValues(), otherBefore)
    assert.deepEqual(updated.getWorksheet('Temporada').model.merges, ['A1:B1'])
    assert.equal(updated.getWorksheet('Índice').getCell('D2').value.toISOString(), '2026-10-23T00:00:00.000Z')
    assert.equal(sheet.getCell('E2').value.formula, "'Índice'!D2")
    assert.equal(sheet.getCell('E2').value.result.toISOString(), '2026-10-23T00:00:00.000Z')
})

test('uses final totals for ranking and leaves incomplete splits empty', async () => {
    const { updated } = await update(await fixture(), [
        result({ times: [0, null, 90000], totalTime: 40000 }),
        result({ times: [], totalTime: 42000 }),
        result({ times: [null, 0, 43000] })
    ])
    const sheet = updated.getWorksheet('Clas. histórica')
    for (const [row, total] of [[3, 40000], [4, 42000], [5, 43000]]) {
        assert.equal(sheet.getCell(`F${row}`).value, total)
        assert.ok(!sheet.getCell(`E${row}`).value)
    }
})

test('recognizes reordered columns instead of using fixed column positions', async () => {
    const { updated } = await update(await fixture({ reordered: true }), [result()])
    const sheet = updated.getWorksheet('Clas. histórica')
    assert.equal(sheet.getCell('A3').value.toISOString(), '2026-10-23T00:00:00.000Z')
    assert.equal(sheet.getCell('B3').value, 'International Race (Inzell)')
    assert.equal(sheet.getCell('C3').value, 41032)
    assert.equal(sheet.getCell('D3').value, 'Ona Rodríguez Cornejo')
    assert.equal(sheet.getCell('G3').value, 1)
})

test('exports mixed relays as a separate X block with valid final totals and missing splits', async () => {
    const workbook = await fixture()
    workbook.getWorksheet('Clas. histórica').getCell('A2').value = 'Relevo Mixto, X'
    const { updated } = await update(workbook, [
        result({ race: 'Relevo Mixto', distance: 2500, times: [null, 179650], totalTime: 179650,
            skater: { fullname: 'Equipo LUISA-NIL', gender: 'X' } }),
        result()
    ])
    const sheet = updated.getWorksheet('Clas. histórica')
    assert.equal(sheet.getCell('A2').value, 'RELEVO MIXTO, X')
    assert.equal(sheet.getCell('A2').font.color.argb, 'FFAA00FF')
    assert.equal(sheet.getCell('C3').value, 'Equipo LUISA-NIL')
    assert.equal(sheet.getCell('F3').value, 179650)
    assert.ok(!sheet.getCell('E3').value)
    assert.equal(sheet.getCell('A4').value, '500M, F')
    await assert.rejects(update(await fixture(), [
        result({ skater: { fullname: 'Invalid', gender: '?' } })
    ]), error => {
        assert.deepEqual(error.issues[0].reasons, ['RECORDS_EXCEL_INVALID_GENDER'])
        return true
    })
})

test('empty filtered results clear the entire historical classification and update dates', async () => {
    const { updated, count, groups } = await update(await fixture(), [])
    assert.equal(count, 0)
    assert.equal(groups, 0)
    assert.equal(updated.getWorksheet('Clas. histórica').getCell('C3').value, null)
    assert.equal(updated.getWorksheet('Clas. histórica').getCell('A60').value, null)
    assert.equal(updated.getWorksheet('Índice').getCell('D2').value.toISOString(), '2026-10-23T00:00:00.000Z')
})

test('group-by values are represented in headings without dropping their separate rankings', async () => {
    const records = [result({ country: 'España' }), result({ country: 'Francia' })]
    const { updated, groups } = await update(await fixture(), records, { groupBy: 'country' })
    assert.equal(groups, 2)
    assert.equal(updated.getWorksheet('Clas. histórica').getCell('A2').value, 'España · 500M, F')
    assert.equal(updated.getWorksheet('Clas. histórica').getCell('A4').value, 'Francia · 500M, F')
})

test('invalid workbooks or incomplete data fail explicitly without generating an updated workbook', async () => {
    for (const [mutate, expected] of [
        [w => w.getWorksheet('Clas. histórica').name = 'Other', /RECORDS_EXCEL_SHEET/],
        [w => w.getWorksheet('Clas. histórica').getCell('C1').value = 'unknown', /RECORDS_EXCEL_COLUMNS/],
        [w => w.getWorksheet('Índice').getCell('C2').value = '', /RECORDS_EXCEL_DATE/],
        [w => w.getWorksheet('Clas. histórica').mergeCells('A5:B5'), /RECORDS_EXCEL_LAYOUT/]
    ]) {
        const workbook = await fixture()
        mutate(workbook)
        await assert.rejects(update(workbook, [result()]), expected)
    }
    await assert.rejects(update(await fixture(), [result({ times: [0] })]), /RECORDS_EXCEL_DATA/)
    await assert.rejects(updateRecordsExcel(Buffer.from('invalid'), []))
})

test('bolds every result cell only in the current ice or inline season, including boundary dates', async () => {
    for (const [seasonStartMonth, reference, dates, expected] of [
        [7, new Date(2026, 9, 23, 12),
            ['2026-06-30', '2026-07-01', '2027-06-30', '2027-07-01'], [false, true, true, false]],
        [7, new Date(2026, 5, 30, 12),
            ['2025-06-30', '2025-07-01', '2026-06-30', '2026-07-01'], [false, true, true, false]],
        [7, new Date(2026, 6, 1, 12),
            ['2026-06-30', '2026-07-01'], [false, true]],
        [1, new Date(2026, 9, 23, 12),
            ['2025-12-31', '2026-01-01', '2026-12-31', '2027-01-01'], [false, true, true, false]],
        [1, new Date(2027, 0, 1, 12),
            ['2026-12-31', '2027-01-01'], [false, true]]
    ]) {
        const workbook = await fixture()
        workbook.getWorksheet('Clas. histórica').getRow(3).eachCell(cell => {
            cell.font = { name: 'Arial', italic: true, bold: true, color: { argb: 'FF123456' } }
        })

        const records = dates.map((date, i) => result({
            date, times: [40000 + i], competition: { name: 'Race', season: 'incorrect-season-on-purpose' }
        }))
        const { updated } = await update(workbook, records, { now: reference, seasonStartMonth })
        const sheet = updated.getWorksheet('Clas. histórica')
        expected.forEach((bold, i) => {
            for (let column = 1; column <= 8; column++) {
                const font = sheet.getRow(i + 3).getCell(column).font
                assert.equal(!!font.bold, bold, `${seasonStartMonth}: ${dates[i]}, column ${column}`)
                assert.equal(font.name, 'Arial')
                assert.equal(font.italic, true)
                assert.equal(font.color.argb, 'FF123456')
            }
        })
        assert.equal(sheet.getCell('A2').font.bold, true)
    }
})

test('historical validation reports every invalid result and all reasons before changing the workbook', async () => {
    await assert.rejects(update(await fixture(), [
        result({ _id: 'bad-total', totalTime: 0, times: [0, null] }),
        result({ _id: 'missing-data', date: null, race: '', skater: null, competition: null }),
        result({ _id: 'gender', skater: { fullname: 'Test', gender: '' } }),
        result({ totalTime: 40000, times: [null, 0, 40000] })
    ]), error => {
        assert.equal(error.message, 'RECORDS_EXCEL_DATA')
        assert.equal(error.issues.length, 3)
        assert.equal(error.issues[0].id, 'bad-total')
        assert.deepEqual(error.issues[0].reasons, ['RECORDS_ALLROUND_INVALID_TIMES'])
        assert.deepEqual(error.issues[1].reasons, ['RECORDS_EXCEL_INVALID_SKATER', 'RECORDS_EXCEL_INVALID_EVENT',
            'RECORDS_EXCEL_INVALID_RACE', 'RECORDS_EXCEL_INVALID_DATE'])
        assert.deepEqual(error.issues[2].reasons, ['RECORDS_EXCEL_INVALID_GENDER'])
        return true
    })
})
