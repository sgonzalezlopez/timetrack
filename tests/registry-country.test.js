const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { normalizeCountry, countryFilter } = require('../utils/registry-country')

test('country codes normalize to ISO alpha2 without assigning a country to unknown results', () => {
    for (const [input, expected] of [['esp', 'ES'], [' fr ', 'FR'], ['FRA', 'FR'], ['USA', 'US'], ['', null], [null, null], [undefined, null]]) {
        assert.equal(normalizeCountry(input), expected)
    }
    for (const input of ['not a country', 'ZZ', {}, ['ES']]) assert.throws(() => normalizeCountry(input), /IMPORT_INVALID_COUNTRY/)
    assert.deepEqual(countryFilter(['ES', 'ESP', 'FRA']), { $in: ['ES', 'ESP', 'FR', 'FRA'] })
    assert.throws(() => countryFilter(''), /IMPORT_INVALID_COUNTRY/)
})

test('registry model snapshots a new skater country once, never refills old or explicitly unknown records', async () => {
    let schema, profileCountry = 'ESP', reads = 0
    function Schema(fields) {
        if (!(this instanceof Schema)) return new Schema(fields)
        schema = this
        this.fields = fields
        this.hooks = {}
        this.virtual = () => ({ get() {} })
        this.index = () => {}
        this.pre = (event, callback) => { this.hooks[event] = callback }
    }
    Schema.Types = { ObjectId: String }
    const mongoose = {
        Schema,
        model: name => name === 'Skater' ? { findById: () => ({ select: async () => {
            reads++
            return { country: profileCountry }
        } }) } : schema
    }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'models', 'registry.model.js'), 'utf8'), {
        module: { exports: {} }, require: name => name === 'mongoose' ? mongoose : require(path.join(__dirname, '..', 'models', name))
    })
    assert.equal(schema.fields.country.set, normalizeCountry)
    const mark = { isNew: true, skater: 'one' }
    await schema.hooks.validate.call(mark)
    assert.equal(mark.country, 'ES')
    profileCountry = 'FRA'
    mark.isNew = false
    await schema.hooks.validate.call(mark)
    assert.equal(mark.country, 'ES')
    for (const record of [
        { isNew: false, skater: 'one' },
        { isNew: true, skater: 'one', $errors: { country: new Error('invalid country') } },
        { isNew: true, skater: 'one', country: null },
        { isNew: true, skater: 'one', country: 'US' }
    ]) {
        const before = record.country
        await schema.hooks.validate.call(record)
        assert.equal(record.country, before)
    }
    assert.equal(reads, 1)
})

function externalHarness() {
    const queries = [], populations = [], selections = []
    const raw = [
        { _id: 'spanish-result', country: 'ES' },
        { _id: 'french-result', country: 'FR' },
        { _id: 'unknown-result' }
    ].map((item, index) => ({
        ...item, date: '2026-01-01', race: '500', times: [40000 + index * 1000],
        skater: { _id: 'one', gender: 'M', country: 'FR' }, competition: { season: '2026', track: { name: 'Track' } }
    }))
    const model = { find: filter => {
        queries.push(filter)
        const chain = {
            select: fields => { selections.push(fields); return chain },
            populate: spec => { populations.push(spec); return chain },
            sort: () => chain,
            then: callback => Promise.resolve(callback(raw.filter(item => !filter.country || filter.country.$in.includes(item.country))
                .map(item => ({ ...item, toObject: () => ({ ...item }) }))))
        }
        return chain
    } }
    const exports = {}
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'controllers', 'external-api.controller.js'), 'utf8'), {
        exports, require: name => name === 'mongoose' ? { isValidObjectId: () => true } :
            name.endsWith('registry.model') ? model : name.endsWith('skater.model') ? {} : require(name)
    })
    const invoke = async (method, body) => {
        let response
        await exports[method]({ body }, { send: result => { response = result } }, err => { throw err })
        return response
    }
    return { invoke, queries, populations, selections }
}

test('external registry and records APIs filter and group by historical country, never current profile country', async () => {
    const h = externalHarness()
    const spanish = await h.invoke('searchRegistries', { country: 'ESP' })
    assert.equal(spanish.total, 1)
    assert.equal(spanish.items[0].country, 'ES')
    assert.equal(spanish.items[0].skater.country, 'FR')
    assert.deepEqual(Array.from(h.queries[0].country.$in), ['ES', 'ESP'])
    assert.equal(h.populations.find(p => p.path === 'skater').match.country, undefined)
    assert.ok(h.selections[0].split(' ').includes('country'))
    const records = await h.invoke('searchRecords', { groupBy: 'country', top: '*' })
    assert.equal(records.length, 3)
    assert.equal(records.find(r => r._id === 'spanish-result').country, 'ES')
    assert.equal(records.find(r => r._id === 'unknown-result').country, undefined)
    const french = await h.invoke('searchRecords', { country: 'FR', top: '*' })
    assert.deepEqual(Array.from(french, r => r._id), ['french-result'])
})
