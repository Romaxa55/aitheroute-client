import assert from 'node:assert/strict'
import {test} from 'node:test'
import {get} from 'node:http'
import {controlPage} from '../control-page.mjs'

test('control page is private to loopback, never starts from GET, and rejects cross-origin posts', async (t) => {
  const calls = []
  const page = await controlPage(
    () => '<main>checking</main>',
    async (action) => calls.push(action),
  )
  t.after(page.close)
  const u = new URL(page.url)
  const action = new URL('continue', u)
  const initial = await fetch(u)
  assert.equal(initial.status, 200)
  assert.equal(initial.headers.get('referrer-policy'), 'same-origin')
  assert.equal((await fetch(u.origin + '/')).status, 404)
  const foreignHost = await new Promise((resolve, reject) => {
    get(u, {headers: {host: 'elsewhere.example'}}, (res) => {
      res.resume()
      resolve(res.statusCode)
    }).on('error', reject)
  })
  assert.equal(foreignHost, 403)
  assert.equal((await fetch(action)).status, 404)
  for (const origin of ['https://untrusted.example', 'null', ''])
    assert.equal((await fetch(action, {method: 'POST', headers: {origin}})).status, 403)
  assert.deepEqual(calls, [])
  const res = await fetch(action, {method: 'POST', headers: {origin: u.origin}, redirect: 'manual'})
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), u.pathname)
  assert.deepEqual(calls, ['continue'])
  assert.match((await fetch(u)).headers.get('content-security-policy'), /frame-ancestors 'none'/)
})
