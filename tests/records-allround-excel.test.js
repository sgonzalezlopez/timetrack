const { test } = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('exceljs')
const { updateAllroundExcel, allroundTime } = require('../utils/records-allround-excel')

async function fixture() {
    const w = new ExcelJS.Workbook()
    const index = w.addWorksheet('Índice')
    index.getCell('C2').value = 'Fecha de actualización:'
    index.getCell('D2').value = new Date('2020-01-01')
    const s = w.addWorksheet('Allround Histórico')
    for (const [row, gender] of [[1, 'M'], [5, 'F']]) {
        s.getRow(row).values = [gender, gender === 'M' ? 'Patinador' : 'Patinadora',
            '500m', '1000m', '1500m', '3000m', 'Total AR']
        for (let n = row + 1; n <= row + 2; n++) {
            s.getCell(`B${n}`).value = 'Old skater'
            s.getCell(`C${n}`).value = '40,00'
            s.getCell(`G${n}`).value = {
                formula: `IF(OR(ISBLANK(C${n}),ISBLANK(D${n}),ISBLANK(E${n}),ISBLANK(F${n})),"No hay alguna marca",C${n}+D${n}/2+E${n}/3+F${n}/6)`
            }
            s.getCell(`B${n}`).font = { name: 'Arial', color: { argb: 'FF123456' } }
        }
    }
    s.getCell('I3').value = 'Ultima actualización:'
    s.getCell('J3').value = { formula: 'Índice!D2', result: new Date('2020-01-01') }
    w.addWorksheet('Other').getCell('A1').value = 'Keep me'
    return w
}

function marks(id, gender, times, overrides = {}) {
    return [500, 1000, 1500, 3000].flatMap((distance, i) => times[i] == null ? [] : [{
        distance, times: [times[i]], skater: { _id: id, fullname: id, gender, country: 'ESP' },
        competition: { training: false }, ...overrides
    }])
}
async function update(records, w) {
    w = w || await fixture()
    const out = await updateAllroundExcel(await w.xlsx.writeBuffer(), records, { now: new Date(2026, 9, 23, 12) })
    const updated = new ExcelJS.Workbook()
    await updated.xlsx.load(out.buffer)
    return { ...out, updated, sheet: updated.getWorksheet('Allround Histórico') }
}

test('orders complete skaters by AR then incomplete by first available distance and time, men above women', async () => {
    const records = [
        ...marks('complete-slower', 'M', [40000, 80000, 120000, 240000]),
        ...marks('complete-faster', 'M', [41000, 78000, 117000, 234000]),
        ...marks('500-slow', 'M', [39000]),
        ...marks('500-fast', 'M', [38000, 90000]),
        ...marks('1000-slow', 'M', [null, 79000]),
        ...marks('1000-fast', 'M', [null, 78000]),
        ...marks('1500-only', 'M', [null, null, 110000]),
        ...marks('3000-only', 'M', [null, null, null, 230000]),
        ...marks('woman', 'F', [43000, 85000, 130000, 260000])
    ]
    const { sheet, count } = await update(records)
    const men = Array.from({ length: 8 }, (_, i) => sheet.getCell(`B${i + 2}`).value)
    assert.deepEqual(men, ['complete-faster', 'complete-slower', '500-fast', '500-slow',
        '1000-fast', '1000-slow', '1500-only', '3000-only'])
    assert.equal(count, 9)
    assert.equal(sheet.getCell('A11').value, 'F')
    assert.equal(sheet.getCell('B12').value, 'woman')
    assert.equal(sheet.getCell('A12').value, 1)
    assert.equal(sheet.getCell('C6').value, null)
    assert.equal(sheet.getCell('D6').value, '1.18,00')
})

test('takes best mark per distance and identity, excludes foreign and training and ignores irrelevant distances', async () => {
    const { sheet, count } = await update([
        ...marks('one', 'M', [41000, 81000]), ...marks('one', 'M', [40000, 82000]),
        ...marks('foreign', 'M', [10000], { skater: { _id: 'foreign', fullname: 'Foreign', gender: 'M', country: 'FRA' } }),
        ...marks('training', 'M', [10000], { competition: { training: true } }),
        ...marks('irrelevant', 'M', [10000], { distance: 100 })
    ])
    assert.equal(count, 1)
    assert.equal(sheet.getCell('B2').value, 'one')
    assert.equal(sheet.getCell('C2').value, '40,00')
    assert.equal(sheet.getCell('D2').value, '1.21,00')
    assert.equal(sheet.getCell('E2').value, null)
})

test('does not merge distinct skaters with identical names and sums split times', async () => {
    const records = [
        ...marks('id-one', 'F', [40000]),
        ...marks('id-two', 'F', [41000])
    ]
    records.forEach(record => { record.skater.fullname = 'Same name' })
    records[0].times = [20000, 20000]
    const { sheet, count } = await update(records)
    assert.equal(count, 2)
    assert.equal(sheet.getCell('B6').value, 'Same name')
    assert.equal(sheet.getCell('B7').value, 'Same name')
    assert.equal(sheet.getCell('C6').value, '40,00')
    assert.equal(sheet.getCell('C7').value, '41,00')
})

test('empty or ineligible results fail without producing an empty replacement workbook', async () => {
    await assert.rejects(update([]), /RECORDS_ALLROUND_EMPTY/)
    await assert.rejects(update(marks('foreign', 'M', [40000], {
        skater: { _id: 'foreign', fullname: 'Foreign', gender: 'M', country: 'FRA' }
    })), /RECORDS_ALLROUND_EMPTY/)
})

test('accepts the ES code saved by the skater selector as well as legacy ESP', async () => {
    const records = [...marks('one', 'M', [40000]), ...marks('two', 'F', [42000])]
    records[0].skater.country = 'ES'
    const { sheet, count } = await update(records)
    assert.equal(count, 2)
    assert.equal(sheet.getCell('B2').value, 'one')
    assert.equal(sheet.getCell('B6').value, 'two')
})

test('preserves and extends AR formulas as formulas, updates dates and leaves unrelated cells unchanged', async () => {
    const workbook = await fixture()
    const formula = workbook.getWorksheet('Allround Histórico').getCell('G2').formula
    const { sheet, updated } = await update([
        ...marks('one', 'M', [40000]), ...marks('two', 'M', [41000]),
        ...marks('three', 'M', [42000]), ...marks('four', 'M', [43000]),
        ...marks('woman', 'F', [44000])
    ], workbook)
    assert.equal(sheet.getCell('G2').formula, formula)
    assert.match(sheet.getCell('G5').formula, /ISBLANK\(C5\)/)
    assert.equal(sheet.getCell('G5').value.result, undefined)
    assert.equal(sheet.getCell('A7').value, 'F')
    assert.match(sheet.getCell('G8').formula, /ISBLANK\(C8\)/)
    assert.equal(sheet.getCell('B8').font.name, 'Arial')
    assert.equal(sheet.getCell('I3').value, 'Ultima actualización:')
    assert.equal(sheet.getCell('J3').value.result.toISOString(), '2026-10-23T00:00:00.000Z')
    assert.equal(updated.getWorksheet('Other').getCell('A1').value, 'Keep me')
    assert.equal(updated.getWorksheet('Índice').getCell('D2').value.toISOString(), '2026-10-23T00:00:00.000Z')
})

test('handles shared AR formulas and rejects missing formulas or invalid marks', async () => {
    const workbook = await fixture()
    const s = workbook.getWorksheet('Allround Histórico')
    s.getCell('G2').value = { formula: 'C2+D2/2+E2/3+F2/6', shareType: 'shared', ref: 'G2:G3' }
    s.getCell('G3').value = { sharedFormula: 'G2' }
    const { sheet } = await update(marks('one', 'M', [40000]), workbook)
    assert.equal(sheet.getCell('G3').formula, 'C3+D3/2+E3/3+F3/6')
    const invalid = await fixture()
    invalid.getWorksheet('Allround Histórico').getCell('G2').value = 1
    invalid.getWorksheet('Allround Histórico').getCell('G3').value = 2
    await assert.rejects(update([], invalid), /RECORDS_ALLROUND_LAYOUT/)
    await assert.rejects(update(marks('one', 'M', [0])), /RECORDS_EXCEL_DATA/)
})

test('formats consistent hundredths for the original AR formulas, including trailing zeroes and carry', () => {
    assert.equal(allroundTime(35080), '35,08')
    assert.equal(allroundTime(40000), '40,00')
    assert.equal(allroundTime(77404), '1.17,40')
    assert.equal(allroundTime(59999), '1.00,00')
})

test('collects all invalid records and reasons, including blanks, nulls, sparse splits and non-finite totals', async () => {
    const times = [[], [null], [0], [-1], [NaN], [Infinity], [, 40000], [Number.MAX_VALUE, Number.MAX_VALUE]]
    const invalid = times.map((value, index) => ({
        ...marks(`skater-${index}`, 'M', [40000])[0],
        _id: `record-${index}`, date: '2026-10-23', times: value,
        competition: { name: 'Test event', training: false }
    }))
    invalid[0].skater.gender = ''
    invalid[1].skater.fullname = ' '
    invalid[2].skater._id = ''
    await assert.rejects(update([...marks('valid', 'F', [42000]), ...invalid]), error => {
        assert.equal(error.message, 'RECORDS_EXCEL_DATA')
        assert.equal(error.issues.length, times.length)
        error.issues.forEach((issue, index) => {
            assert.equal(issue.id, `record-${index}`)
            assert.equal(issue.date, '2026-10-23')
            assert.equal(issue.distance, 500)
            assert.equal(issue.competition, 'Test event')
            assert.ok(issue.reasons.includes('RECORDS_ALLROUND_INVALID_TIMES'))
        })
        assert.ok(error.issues[0].reasons.includes('RECORDS_ALLROUND_INVALID_GENDER'))
        assert.ok(error.issues[1].reasons.includes('RECORDS_ALLROUND_INVALID_NAME'))
        assert.ok(error.issues[2].reasons.includes('RECORDS_ALLROUND_INVALID_ID'))
        return true
    })
})
