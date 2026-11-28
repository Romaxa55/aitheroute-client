import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {strictSession} from '../strict.mjs'
import {probe} from '../strict/probe.mjs'
import {sandboxArgs} from '../strict/sandbox.mjs'

test('strict mode rejects configuration before starting desktop processes', async () => {
  const request = {
    origin: 'https://route.example',
    provider: 'chatgpt',
    page: 'https://chatgpt.com/auth/login',
    proxy: {port: 1234, password: '0'.repeat(32)},
  }
  for (const patch of [
    {page: 'file:///tmp/test'},
    {origin: 'http://route.example'},
    {command: ['/tmp/evil']},
  ]) {
    await assert.rejects(strictSession({...request, ...patch}), {code: 'STRICT_COMMAND'})
  }
})

test('requires gateway nonce proof before performing vendor TLS', async (t) => {
  const endpoints = []
  const server = createServer()
  server.on('connect', (req, sock) => {
    endpoints.push(req.url)
    sock.on('error', () => {})
    if (req.url === 'check.login.invalid:443') {
      sock.write('HTTP/1.1 200 OK\r\n\r\n')
      sock.once('data', () => sock.end(Buffer.alloc(37)))
    } else sock.destroy()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  await assert.rejects(probe(server.address().port, '0'.repeat(32), 'chatgpt.com'))
  assert.deepEqual(endpoints, ['check.login.invalid:443'])
})

test('sandbox exposes only the nested display, tunnel and control sockets', () => {
  const args = sandboxArgs({dir: '/private/test', display: 42, home: '/private/home'})
  assert.ok(args.includes('--unshare-all'))
  assert.ok(args.includes('--new-session'))
  assert.ok(!args.includes('--share-net'))
  for (const path of ['/', '/etc', '/tmp', '/run', '/home', '/tmp/.X11-unix']) {
    assert.ok(
      !args.some(
        (arg, i) => ['--ro-bind', '--bind', '--dev-bind'].includes(arg) && args[i + 1] === path,
      ),
    )
  }
  assert.ok(args.includes('/private/test/sockets/X42'))
  assert.equal(args.filter((s) => s === '/tmp/.X11-unix/X42').length, 1)
})
