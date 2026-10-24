const countries = require('i18n-iso-countries')

function normalizeCountry(value) {
    if (value == null || value === '') return null
    if (typeof value !== 'string') throw new Error('IMPORT_INVALID_COUNTRY')
    const code = value.trim().toUpperCase()
    const country = code.length === 2 && countries.isValid(code) ? code : countries.alpha3ToAlpha2(code)
    if (!country) throw new Error('IMPORT_INVALID_COUNTRY')
    return country
}

function countryFilter(value) {
    const codes = (Array.isArray(value) ? value : [value]).map(normalizeCountry)
    if (codes.some(code => !code)) throw new Error('IMPORT_INVALID_COUNTRY')
    return { $in: [...new Set(codes.flatMap(code => [code, countries.alpha2ToAlpha3(code)]))] }
}

module.exports = { normalizeCountry, countryFilter }
