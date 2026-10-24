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
                    return { ...raw, _doc: raw }
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
