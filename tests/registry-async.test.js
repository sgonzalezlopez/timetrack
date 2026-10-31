const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('registry reads, deletes and searches forward asynchronous failures to Express', async () => {
  const failure = new Error('database unavailable')
  const chain = {
    populate() { return chain },
    then(resolve, reject) { return Promise.reject(failure).then(resolve, reject) }
  }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/registry.controller.js'), 'utf8'), {
    exports, __corePath: 'core', console: { error() {} },
    require: name => {
      if (name.endsWith('registry.model')) return { find: () => chain, deleteOne: () => chain }
      if (name === '../middlewares/data.filter') return { getFilter: () => ({}) }
      if (name.endsWith('i18n.config')) return {}
      return require(name)
    }
  })
  for (const method of ['getAll', 'get', 'delete', 'find']) {
    let forwarded
    await exports[method]({ body: {}, params: { id: 'id' }, user: {} }, {
      send() { assert.fail('must not send after failed database request') }
    }, error => { forwarded = error })
    assert.equal(forwarded, failure, method)
  }
})
