const JSZip = require('jszip')
const { SaxesParser } = require('saxes')

function tableMetadata(xml) {
    const parser = new SaxesParser({ xmlns: true })
    const metadata = {}
    parser.on('opentag', node => {
        if (node.local === 'table') {
            metadata.name = node.attributes.name.value
            metadata.headerRow = !node.attributes.headerRowCount || node.attributes.headerRowCount.value !== '0'
            metadata.totalsRow = !!node.attributes.totalsRowCount && node.attributes.totalsRowCount.value === '1'
        } else if (node.local === 'autoFilter') {
            metadata.hasFilter = true
            metadata.filterRef = node.attributes.ref && node.attributes.ref.value
        }
    })
    parser.write(xml).close()
    return metadata
}

async function writeRecordsWorkbook(workbook, originalBuffer) {
    const original = await JSZip.loadAsync(originalBuffer)
    const metadata = new Map()
    for (const entry of Object.values(original.files)) {
        if (/^xl\/tables\/[^/]+\.xml$/.test(entry.name)) {
            const table = tableMetadata(await entry.async('string'))
            metadata.set(table.name, table)
        }
    }
    // ExcelJS reads an omitted headerRowCount as false, and emits autoFilter even without a range.
    for (const sheet of workbook.worksheets) {
        for (const table of sheet.getTables()) {
            const source = metadata.get(table.name)
            if (!source) throw new Error('RECORDS_EXCEL_LAYOUT')
            table.table.headerRow = source.headerRow
            table.table.totalsRow = source.totalsRow
            table.table.autoFilterRef = source.filterRef || table.table.tableRef.replace(/(\d+)$/,
                row => String(Number(row) - (source.totalsRow ? 1 : 0)))
        }
    }
    const output = await JSZip.loadAsync(await workbook.xlsx.writeBuffer())
    for (const entry of Object.values(output.files)) {
        if (!/^xl\/tables\/[^/]+\.xml$/.test(entry.name)) continue
        const xml = await entry.async('string')
        const table = metadata.get(tableMetadata(xml).name)
        if (!table) throw new Error('RECORDS_EXCEL_LAYOUT')
        if (!table.hasFilter || !table.headerRow) {
            output.file(entry.name, xml.replace(/<autoFilter\b[^>]*(?:\/>|>[\s\S]*?<\/autoFilter>)/, ''))
        }
    }
    return output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

module.exports = { writeRecordsWorkbook }
