const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function harness({ countries = ['ESP', 'ESP', 'ESP'], profileCountries = ['FR', 'FR', 'FR'] } = {}) {
    const exports = {}, queries = [], populations = []
    const items = [
        { id: 'a', skater: 'one', time: 40000 },
        { id: 'b', skater: 'one', time: 41000 },
        { id: 'c', skater: 'two', time: 42000 }
    ]
    const model = {
        find: query => {
            queries.push(query)
            const chain = {
                populate: spec => { populations.push(spec); return chain },
                then: callback => Promise.resolve(callback(items.map((item, index) => {
                    const raw = {
                        _id: item.id, race: '500', distance: 500, times: [item.time], date: '2026-10-23',
                        country: countries[index],
                        skater: { id: item.skater, name: item.skater, gender: 'M', country: profileCountries[index] },
                        competition: { name: 'Race', season: '2026-2027', track: { name: 'Track' } }
                    }
                    const prototype = {}
                    for (const key of Object.keys(raw)) Object.defineProperty(prototype, key, {
                        get() { return this._doc[key] }
                    })
                    return Object.assign(Object.create(prototype), { _doc: raw })
                }).filter(item => !query.country || query.country.$in.includes(item.country))))
            }
            return chain
        }
    }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/registry.controller.js'), 'utf8'), {
        exports, __corePath: 'core', console,
        require: name => {
            if (name === '../models/registry.model') return model
            if (name === '../middlewares/data.filter') return { getFilter: (_entity, query) => ({ ...query, club: 'allowed' }) }
            if (name.endsWith('i18n.config')) return { getLocale: () => 'es' }
            return require(name)
        }
    })
    return { exports, queries, populations }
}

test('shared records query preserves Top and best-per-skater behavior for screen and workbook', async () => {
    const h = harness()
    for (const [bestForSkater, expected] of [['false', ['a', 'b']], ['true', ['a', 'c']]]) {
        const request = () => ({ user: { id: 'u' }, body: { top: '2', bestForSkater, groupBy: 'none' } })
        const results = await h.exports.getRecords(request())
        let screen
        await h.exports.findRecords(request(), { send: value => { screen = value } }, err => { throw err })
        assert.deepEqual(Array.from(results, r => r._id), expected)
        assert.deepEqual(JSON.parse(JSON.stringify(screen)), JSON.parse(JSON.stringify(results)))
    }
})

test('shared records query applies access filter and current gender, country, track and season filters', async () => {
    const h = harness()
    await h.exports.getRecords({ user: { id: 'u' }, body: {
        top: '*', groupBy: 'none', bestForSkater: 'false', gender: 'M', country: 'ESP',
        track: 'track-id', season: '2026-2027', training: 'false', category: ['MA2'], race: '500'
    } })
    assert.equal(h.queries[0].club, 'allowed')
    assert.equal(h.queries[0].race, '500')
    assert.equal(h.queries[0].category.$in[0], 'MA2')
    const skater = h.populations.find(p => p.path === 'skater')
    const competition = h.populations.find(p => p.path === 'competition')
    assert.equal(skater.match.gender.$eq, 'M')
    assert.equal(skater.match.country, undefined)
    assert.deepEqual(Array.from(h.queries[0].country.$in), ['ES', 'ESP'])
    assert.equal(competition.match.track.$eq, 'track-id')
    assert.equal(competition.match.season.$eq, '2026-2027')
    assert.equal(competition.match.training.$eq, 'false')
})

test('historical query includes both ES from the country selector and legacy ESP, not foreign skaters', async () => {
    const h = harness({ countries: ['ES', 'FRA', 'ESP'] })
    const results = await h.exports.getRecords({ user: { id: 'u' }, body: {
        top: '*', groupBy: 'none', bestForSkater: 'false', country: ['ES', 'ESP'], training: 'false'
    } })
    assert.deepEqual(Array.from(results, record => record._id), ['a', 'c'])
    assert.deepEqual(Array.from(h.queries[0].country.$in), ['ES', 'ESP'])
    assert.equal(results[0].country, 'ES')
    assert.equal(results[0].skater.country, 'FR')
})

test('ranking preserves stored nationality when grouping copies documents without their schema getters', async () => {
    for (const bestForSkater of ['false', 'true']) {
        const h = harness({ countries: ['ES', 'ES', 'ESP'] })
        const results = await h.exports.getRecords({ user: {}, body: {
            top: '*', groupBy: 'none', bestForSkater, country: ['ES', 'ESP'], training: 'false'
        } })
        assert.equal(results.length, bestForSkater === 'true' ? 2 : 3)
        assert.ok(results.every(record => ['ES', 'ESP'].includes(record.country)))
    }
})

test('Allround accepts Spanish marks returned by the shared query with schema-backed fields', async () => {
    const ExcelJS = require('exceljs')
    const { updateAllroundExcel } = require('../utils/records-allround-excel')
    const h = harness({ countries: ['ES', 'ES', 'ES'] })
    const records = await h.exports.getRecords({ user: {}, body: {
        top: '*', groupBy: 'none', bestForSkater: 'false', country: ['ES', 'ESP'], training: 'false'
    } })
    const workbook = new ExcelJS.Workbook()
    const index = workbook.addWorksheet('Índice')
    index.getCell('C2').value = 'Fecha de actualización:'
    index.getCell('D2').value = new Date('2020-01-01')
    const sheet = workbook.addWorksheet('Allround Histórico')
    for (const [row, gender] of [[1, 'M'], [5, 'F']]) {
        sheet.getRow(row).values = [gender, gender === 'M' ? 'Patinador' : 'Patinadora',
            '500m', '1000m', '1500m', '3000m', 'Total AR']
        sheet.getCell(`B${row + 1}`).value = 'Old skater'
        sheet.getCell(`G${row + 1}`).value = { formula: `C${row + 1}+D${row + 1}/2+E${row + 1}/3+F${row + 1}/6` }
    }
    const output = await updateAllroundExcel(await workbook.xlsx.writeBuffer(), records)
    assert.equal(output.count, 2)
    const updated = new ExcelJS.Workbook()
    await updated.xlsx.load(output.buffer)
    assert.equal(updated.getWorksheet('Allround Histórico').getCell('C2').value, '40,00')
    assert.equal(updated.getWorksheet('Allround Histórico').getCell('C3').value, '42,00')
})

test('old unknown countries stay unknown and are excluded from country filters despite a Spanish profile', async () => {
    const h = harness({ countries: [undefined, 'FR', 'ES'], profileCountries: ['ES', 'ES', 'FR'] })
    const all = await h.exports.getRecords({ user: {}, body: { top: '*', groupBy: 'none' } })
    assert.equal(all.find(r => r._id === 'a').country, undefined)
    const spanish = await h.exports.getRecords({ user: {}, body: { top: '*', groupBy: 'none', country: 'ES' } })
    assert.deepEqual(Array.from(spanish, r => r._id), ['c'])
    assert.equal(spanish[0].country, 'ES')
    assert.equal(spanish[0].skater.country, 'FR')
})

test('ordinary registry searches also apply country filters to the mark, not the current skater', async () => {
    const h = harness({ countries: ['ES', 'FR', undefined], profileCountries: ['FR', 'ES', 'ES'] })
    let response
    await h.exports.find({ user: {}, body: { country: 'ES' } }, { send: items => { response = items } })
    assert.deepEqual(Array.from(response, r => r._doc._id), ['a'])
    assert.deepEqual(Array.from(h.queries[0].country.$in), ['ES', 'ESP'])
    assert.equal(h.populations.find(p => p.path === 'skater').match.country, undefined)
})
