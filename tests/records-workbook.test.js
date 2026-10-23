const { test } = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('exceljs')
const JSZip = require('jszip')
const { SaxesParser } = require('saxes')
const { writeRecordsWorkbook } = require('../utils/records-workbook')

function elements(xml) {
    const nodes = []
    const parser = new SaxesParser()
    parser.on('opentag', node => nodes.push(node))
    parser.write(xml).close()
    return nodes
}

async function fixture({ filter = false, header = true, totals = false } = {}) {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Table')
    sheet.addTable({
        name: 'OriginalTable', ref: 'C3', headerRow: header, totalsRow: totals,
        columns: [{ name: 'Name', filterButton: filter }, { name: 'Time', filterButton: filter, totalsRowFunction: 'sum' }],
        rows: [['Test', 40000], ['Another', 41000]]
    })
    const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer())
    const entry = zip.file('xl/tables/table1.xml')
    let xml = await entry.async('string')
    if (header) xml = xml.replace(/ headerRowCount="1"/, '')
    if (!filter) xml = xml.replace(/<autoFilter\b[^>]*(?:\/>|>[\s\S]*?<\/autoFilter>)/, '')
    zip.file(entry.name, xml)
    return zip.generateAsync({ type: 'nodebuffer' })
}

test('preserves default table headers and absent autofilters instead of writing invalid autoFilter without ref', async () => {
    const original = await fixture()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(original)
    assert.equal(workbook.getWorksheet('Table').getTable('OriginalTable').headerRow, false)
    const output = await writeRecordsWorkbook(workbook, original)
    const zip = await JSZip.loadAsync(output)
    const nodes = elements(await zip.file('xl/tables/table1.xml').async('string'))
    assert.equal(nodes.find(node => node.name === 'table').attributes.headerRowCount, '1')
    assert.equal(nodes.some(node => node.name === 'autoFilter'), false)
    const updated = new ExcelJS.Workbook()
    await updated.xlsx.load(output)
    assert.equal(updated.getWorksheet('Table').getTable('OriginalTable').headerRow, true)
    assert.equal(updated.getWorksheet('Table').getCell('C4').value, 'Test')
})

test('preserves valid filter ranges, buttons and totals, including when the table does not start at A1', async () => {
    const original = await fixture({ filter: true, totals: true })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(original)
    const zip = await JSZip.loadAsync(await writeRecordsWorkbook(workbook, original))
    const nodes = elements(await zip.file('xl/tables/table1.xml').async('string'))
    assert.equal(nodes.find(node => node.name === 'table').attributes.ref, 'C3:D6')
    assert.equal(nodes.find(node => node.name === 'table').attributes.totalsRowCount, '1')
    assert.equal(nodes.find(node => node.name === 'autoFilter').attributes.ref, 'C3:D5')
    assert.equal(nodes.filter(node => node.name === 'filterColumn').every(node => node.attributes.hiddenButton === '0'), true)
})

test('does not enable headers or filters for a genuinely headerless table', async () => {
    const original = await fixture({ header: false })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(original)
    const zip = await JSZip.loadAsync(await writeRecordsWorkbook(workbook, original))
    const nodes = elements(await zip.file('xl/tables/table1.xml').async('string'))
    assert.equal(nodes.find(node => node.name === 'table').attributes.headerRowCount, '0')
    assert.equal(nodes.some(node => node.name === 'autoFilter'), false)
})
