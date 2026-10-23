const JSZip = require('jszip')
const { SaxesParser } = require('saxes')

function preserveTableStyles(originalXml, outputXml) {
    const tableStyles = originalXml.match(/<tableStyles\b[^>]*>[\s\S]*?<\/tableStyles>/)
    if (!tableStyles || !/<tableStyle\b/.test(tableStyles[0])) return outputXml
    const originalDxfs = originalXml.match(/<dxfs\b[^>]*>[\s\S]*?<\/dxfs>/)
    const dxfs = originalDxfs ? originalDxfs[0].match(/<dxf(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/dxf>)/g) || [] : []
    const outputDxfs = outputXml.match(/<dxfs\b[^>]*(?:\/>|>[\s\S]*?<\/dxfs>)/)
    if (!outputDxfs) throw new Error('RECORDS_EXCEL_LAYOUT')
    const existing = outputDxfs[0].match(/<dxf(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/dxf>)/g) || []
    const mapped = new Map()
    const styles = tableStyles[0].replace(/\s[\w]+:uid="[^"]*"/g, '').replace(/dxfId="(\d+)"/g, (_match, id) => {
        if (!dxfs[Number(id)]) throw new Error('RECORDS_EXCEL_LAYOUT')
        if (!mapped.has(id)) {
            mapped.set(id, existing.length)
            existing.push(dxfs[Number(id)])
        }
        return `dxfId="${mapped.get(id)}"`
    })
    return outputXml.replace(outputDxfs[0], `<dxfs count="${existing.length}">${existing.join('')}</dxfs>`)
        .replace(/<tableStyles\b[^>]*(?:\/>|>[\s\S]*?<\/tableStyles>)/, styles)
}

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
            table.table.autoFilterRef = table.table.autoFilterRef || source.filterRef || table.table.tableRef.replace(/(\d+)$/,
                row => String(Number(row) - (source.totalsRow ? 1 : 0)))
        }
    }
    const output = await JSZip.loadAsync(await workbook.xlsx.writeBuffer())
    const originalStyles = original.file('xl/styles.xml')
    const outputStyles = output.file('xl/styles.xml')
    if (originalStyles && outputStyles) {
        output.file('xl/styles.xml', preserveTableStyles(
            await originalStyles.async('string'), await outputStyles.async('string')))
    }
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
