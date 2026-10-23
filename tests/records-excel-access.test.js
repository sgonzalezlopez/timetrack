const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('Excel route requires admin authorization before invoking the update controller', () => {
    const routes = []
    const router = {}
    for (const method of ['get', 'post', 'put', 'delete']) {
        router[method] = (url, ...handlers) => routes.push({ method, url, handlers })
    }
    const isAdmin = () => {}
    const readPermission = () => {}
    const update = () => {}
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/registry.route.js'), 'utf8'), {
        module: { exports: {} }, __corePath: 'core',
        require: name => {
            if (name === 'path') return path
            if (name === 'express') return { Router: () => router }
            if (name.endsWith('authorization')) return { isAdmin, checkPermision: () => readPermission }
            if (name === '../controllers/records-excel.controller') return { update }
            return {}
        }
    })
    const route = routes.find(r => r.method === 'post' && r.url === '/records/excel')
    assert.deepEqual(route.handlers, [readPermission, isAdmin, update])
})
