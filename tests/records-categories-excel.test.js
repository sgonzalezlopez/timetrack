const { test } = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('exceljs')
const { updateCategoriesExcel, categoryGroup } = require('../utils/records-categories-excel')

async function fixture() {
    const workbook = new ExcelJS.Workbook()
    const index = workbook.addWorksheet('Índice')
    index.getCell('C2').value = 'Fecha de actualización:'
    index.getCell('D2').value = new Date('2020-01-01')
    const sheet = workbook.addWorksheet('Por Categorías')
    sheet.getCell('A1').value = 'ÍNDICE'
    sheet.getCell('A3').value = { formula: 'Índice!D2', result: new Date('2020-01-01') }
    const titles = ['ABSOLUTA', 'JÚNIOR', 'JÚNIOR A', 'JÚNIOR B', 'JÚNIOR C', 'Y+', 'MÁSTER']
    for (let i = 0; i < titles.length; i++) {
        const row = Math.floor(i / 2) * 8 + 1, col = i % 2 ? 9 : 2
        const cells = [titles[i], 'Distancia/Sexo', 'Fecha', 'Patinador', 'Categoría', 'Tiempo total']
        cells.forEach((value, offset) => {
            sheet.getRow(row).getCell(col + offset).value = value
            sheet.getRow(row).getCell(col + offset).font = { bold: true, name: 'Arial' }
        })
        for (const [offset, gender] of [[1, 'M'], [3, 'F']]) {
            sheet.getRow(row + offset).getCell(col + 1).value = `500M, ${gender}`
            sheet.getRow(row + offset + 1).getCell(col + 2).value = new Date('2020-01-01')
            sheet.getRow(row + offset + 1).getCell(col + 3).value = 'Old name'
            for (let c = col; c <= col + 5; c++) sheet.getRow(row + offset + 1).getCell(c).font = {
                name: 'Arial', bold: true, color: { argb: 'FF123456' }
            }
        }
    }
    workbook.addWorksheet('Clas. histórica').getCell('A1').value = 'Leave unchanged'
    return workbook
}
const record = (category, time, overrides = {}) => ({
    category, date: '2026-10-23', distance: 500, times: [time], race: '500', country: 'ESP',
    skater: { fullname: category, gender: category.startsWith('L') ? 'F' : 'M', country: 'ESP' },
    competition: { training: false }, ...overrides
})

test('category records honor result nationality even when the current profile has changed', async () => {
    const { count, sheet } = await update([
        record('MA1', 41000, { country: 'ES', skater: { fullname: 'Changed', gender: 'M', country: 'FR' } }),
        record('MA1', 39000, { country: 'FR' }),
        record('MA1', 38000, { country: undefined })
    ])
    assert.equal(count, 3)
    assert.equal(block(sheet, 'ABSOLUTA').find(b => b.label === '500M, M').time, 41000)
})

test('never generates an empty replacement when no received marks qualify for any category slot', async () => {
    for (const records of [
        [],
        [record('MA1', 40000, { country: undefined })],
        [record('MA1', 40000, { country: 'FR' })],
        [record('MA1', 40000, { competition: { training: true } })],
        [record('MA1', 40000, { distance: 2500 })],
        [record('MA1', 40000, { skater: { fullname: 'Mixed', gender: 'X' } })]
    ]) {
        await assert.rejects(update(records), { message: 'RECORDS_CATEGORIES_EMPTY' })
    }
})
async function update(records, options = {}, workbook) {
    workbook = workbook || await fixture()
    const output = await updateCategoriesExcel(await workbook.xlsx.writeBuffer(), records, {
        now: new Date(2026, 9, 23, 12), seasonStartMonth: 7, ...options
    })
    const updated = new ExcelJS.Workbook()
    await updated.xlsx.load(output.buffer)
    return { ...output, updated, sheet: updated.getWorksheet('Por Categorías') }
}
function block(sheet, title) {
    let found
    sheet.eachRow(row => row.eachCell(cell => { if (cell.value === title) found = { row: row.number, col: cell.col } }))
    assert.ok(found, title)
    const values = []
    for (let row = found.row + 1; row <= sheet.rowCount; row++) {
        if (sheet.getRow(row).getCell(found.col).value) break
        const label = sheet.getRow(row).getCell(found.col + 1).value
        if (typeof label === 'string' && /M, [MFX]$/.test(label)) {
            const result = sheet.getRow(row + 1)
            values.push({ label, row: row + 1, name: result.getCell(found.col + 3).value,
                category: result.getCell(found.col + 4).value, time: result.getCell(found.col + 5).value, col: found.col })
        }
    }
    return values
}

test('classifies exact A/B/C groups, all youth and numeric master codes', () => {
    for (const [code, group] of [
        ['MA1', 'junior a'], ['LA2', 'junior a'], ['MB2', 'junior b'], ['LC1', 'junior c'],
        ['LY+', 'y'], ['MYA', 'y'], ['LYC', 'y'], ['M30', 'master'], ['L65', 'master'],
        ['MSA', null], ['MN4', null], ['UNKNOWN', null]
    ]) assert.equal(categoryGroup(code), group)
})

test('unrepresented mixed and other-distance results do not block category updates', async () => {
    const { sheet } = await update([
        record('MA2', 40000),
        record('MSA', 0, { date: null, distance: 2500,
            skater: { fullname: 'Mixed relay', country: 'ES', gender: 'X' } }),
        record('MA2', 0, { date: null, distance: 10000 })
    ])
    assert.equal(block(sheet, 'JÚNIOR A').find(r => r.label === '500M, M').time, 40000)
})

test('supports X slots explicitly present in the category template', async () => {
    const workbook = await fixture()
    workbook.getWorksheet('Por Categorías').getCell('C2').value = '2500M, X'
    const { sheet } = await update([
        record('MSA', 179650, { distance: 2500, times: [null, 179650], totalTime: 179650,
            skater: { fullname: 'Mixed relay', country: 'ES', gender: 'X' } })
    ], {}, workbook)
    const result = block(sheet, 'ABSOLUTA').find(r => r.label === '2500M, X')
    assert.equal(result.name, 'Mixed relay')
    assert.equal(result.time, '2:59.650')
})

test('reports invalid selected marks once even when used by several category blocks', async () => {
    await assert.rejects(update([record('MA2', 0, { _id: 'bad', date: null })]), error => {
        assert.equal(error.message, 'RECORDS_EXCEL_DATA')
        assert.equal(error.issues.length, 1)
        assert.equal(error.issues[0].id, 'bad')
        assert.deepEqual(error.issues[0].reasons, ['RECORDS_EXCEL_INVALID_DATE', 'RECORDS_ALLROUND_INVALID_TIMES'])
        return true
    })
})

test('updates each exact group independently and excludes foreign skaters and training', async () => {
    const records = [
        record('MSA', 30000), record('MA2', 33000), record('MB2', 32000),
        record('MC1', 31000), record('MYA', 29000), record('M30', 34000),
        record('LA2', 35000), record('LYC', 36000),
        record('MA1', 1, { country: 'FRA', skater: { fullname: 'Foreign', country: 'FRA', gender: 'M' } }),
        record('MA1', 2, { competition: { training: true } })
    ]
    const { sheet, updated } = await update(records)
    for (const [title, name] of [
        ['ABSOLUTA', 'MYA'], ['JÚNIOR', 'MC1'], ['JÚNIOR A', 'MA2'], ['JÚNIOR B', 'MB2'],
        ['JÚNIOR C', 'MC1'], ['Y+', 'MYA'], ['MÁSTER', 'M30']
    ]) assert.equal(block(sheet, title).find(r => r.label === '500M, M').name, name, title)
    assert.equal(block(sheet, 'JÚNIOR B').find(r => r.label === '500M, F').name, null)
    assert.equal(updated.getWorksheet('Clas. histórica').getCell('A1').value, 'Leave unchanged')
    assert.equal(sheet.getCell('A3').value.result.toISOString(), '2026-10-23T00:00:00.000Z')
})

test('includes Spanish skaters with the ES code used by the skater country selector', async () => {
    const { sheet } = await update([record('MA2', 40000, {
        skater: { fullname: 'Spanish skater', gender: 'M', country: 'ES' }
    })])
    assert.equal(block(sheet, 'ABSOLUTA').find(r => r.label === '500M, M').name, 'Spanish skater')
    assert.equal(block(sheet, 'JÚNIOR A').find(r => r.label === '500M, M').name, 'Spanish skater')
})

test('selects category winners by final total regardless of incomplete splits', async () => {
    const { sheet } = await update([
        record('MA2', 90000, { times: [null, 0, 90000], totalTime: 40000 }),
        record('MA1', 10000, { totalTime: 42000 })
    ])
    const winner = block(sheet, 'JÚNIOR A').find(r => r.label === '500M, M')
    assert.equal(winner.category, 'MA2')
    assert.equal(winner.time, 40000)
})

test('adds 100m only where there are eligible results, and expands bands without overwriting other blocks', async () => {
    const { sheet } = await update([
        record('LA2', 12000, { distance: 100 }), record('MYA', 13000, { distance: 100 }),
        record('MA2', 40000)
    ])
    for (const title of ['ABSOLUTA', 'JÚNIOR', 'JÚNIOR A']) {
        assert.equal(block(sheet, title).some(r => r.label === '100M, F'), true, title)
    }
    for (const title of ['JÚNIOR B', 'JÚNIOR C', 'MÁSTER']) {
        assert.equal(block(sheet, title).some(r => r.label.startsWith('100M')), false, title)
    }
    assert.equal(block(sheet, 'Y+').some(r => r.label === '100M, M'), true)
    assert.equal(block(sheet, 'JÚNIOR A').find(r => r.label === '500M, M').name, 'MA2')
    assert.equal(block(sheet, 'MÁSTER').length, 2)
})

test('retains all tied best marks and highlights only current-season results within each block', async () => {
    const { sheet } = await update([
        record('MA2', 40000, { date: '2026-06-30' }),
        record('MA1', 40000, { date: '2026-07-01' })
    ])
    const first = block(sheet, 'JÚNIOR A').find(r => r.label === '500M, M')
    assert.equal(sheet.getRow(first.row).getCell(first.col + 3).value, 'MA2')
    assert.equal(sheet.getRow(first.row + 1).getCell(first.col + 3).value, 'MA1')
    assert.equal(!!sheet.getRow(first.row).getCell(first.col + 3).font.bold, false)
    assert.equal(sheet.getRow(first.row + 1).getCell(first.col + 3).font.bold, true)
    assert.equal(sheet.getRow(first.row).getCell(first.col + 3).font.color.argb, 'FF123456')
    const inline = await update([
        record('MA2', 40000, { date: '2025-12-31' }), record('LA2', 41000, { date: '2026-01-01' })
    ], { seasonStartMonth: 1 })
    for (const slot of block(inline.sheet, 'JÚNIOR A')) {
        assert.equal(!!inline.sheet.getRow(slot.row).getCell(slot.col + 3).font.bold, slot.label.endsWith('F'))
    }
})

test('rejects unrecognized layouts and invalid marks explicitly', async () => {
    const workbook = await fixture()
    workbook.getWorksheet('Por Categorías').getCell('B1').value = 'Other'
    await assert.rejects(update([], {}, workbook), /RECORDS_CATEGORIES_LAYOUT/)
    await assert.rejects(update([record('MA2', 0)]), /RECORDS_EXCEL_DATA/)
    await assert.rejects(update([]), /RECORDS_CATEGORIES_EMPTY/)
})

test('keeps one earliest best mark per skater while retaining ties between distinct identities', async () => {
    const skater = { _id: 'one', fullname: 'Same name', country: 'ES', gender: 'M' }
    const { sheet } = await update([
        record('MA2', 40000, { skater, date: '2026-07-01' }),
        record('MA2', 40000, { skater, date: '2025-01-01' }),
        record('MA2', 40000, { skater: { ...skater, _id: 'two' }, date: '2026-08-01' })
    ])
    const slot = block(sheet, 'JÚNIOR A').find(r => r.label === '500M, M')
    assert.equal(sheet.getRow(slot.row).getCell(slot.col + 2).value.toISOString().slice(0, 10), '2025-01-01')
    assert.equal(sheet.getRow(slot.row + 1).getCell(slot.col + 3).value, 'Same name')
    assert.equal(sheet.getRow(slot.row + 2).getCell(slot.col + 3).value, null)
})

test('moves and resizes all category tables with their blocks without corrupting headers', async () => {
    const workbook = await fixture()
    const source = workbook.getWorksheet('Por Categorías')
    const titles = ['ABSOLUTA', 'JÚNIOR', 'JÚNIOR A', 'JÚNIOR B', 'JÚNIOR C', 'Y+', 'MÁSTER']
    for (let i = 0; i < titles.length; i++) {
        const row = Math.floor(i / 2) * 8 + 1, col = i % 2 ? 10 : 3
        source.addTable({ name: `Group${i}`, ref: source.getRow(row).getCell(col).address,
            headerRow: true, totalsRow: false, columns: ['Distancia/Sexo', 'Fecha', 'Patinador', 'Categoría', 'Tiempo total'].map(name => ({ name })),
            rows: Array.from({ length: 4 }, (_, offset) =>
                Array.from({ length: 5 }, (_, c) => source.getRow(row + offset + 1).getCell(col + c).value)) })
        source.getRow(row + 2).getCell(col + 1).numFmt = 'd/m/yyyy'
        source.getRow(row + 2).getCell(col + 4).numFmt = '#,##0'
    }
    const { sheet } = await update([record('MA2', 40000), record('LA2', 12000, { distance: 100 })], {}, workbook)
    for (const table of sheet.getTables()) {
        const header = table.table.tableRef.split(':')[0]
        assert.equal(sheet.getCell(header).value, 'Distancia/Sexo')
        assert.equal(table.table.autoFilterRef, table.table.tableRef)
    }
    const slot = block(sheet, 'ABSOLUTA').find(r => r.label === '500M, M')
    assert.equal(sheet.getRow(slot.row).getCell(slot.col + 5).numFmt, '#,##0')
    assert.equal(sheet.getRow(slot.row).getCell(slot.col + 2).numFmt, 'd/m/yyyy')
    assert.notEqual(sheet.getTable('Group2').table.tableRef, 'C9:G13')
})
