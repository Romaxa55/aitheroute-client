import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdtempSync, rmSync} from 'node:fs'
import {createServer, request} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {cliEnvironment, vendorArgs, windowsLine} from '../desktop-cli.mjs'
import {relay} from '../desktop-relay.mjs'
import {desktopSession} from '../desktop-session.mjs'
import {gate} from '../gate.mjs'

const origin = 'https://route.example.com'
const page = 'https://claude.ai/login'
const options = {
  origin,
  provider: 'anthropic',
  page,
  command: null,
  proxy: {port: 1, password: 'pw'},
}

test('no Chrome or Edge stops before anything starts, with its own reason', async () => {
  const none = () => {
    throw new Error('none')
  }
  const create = () => desktopSession(options, {findBrowser: none})
  await assert.rejects(create(), {code: 'DESKTOP_BROWSER'})
  const control = gate(create)
  await control.start()
  assert.deepEqual(control.snapshot(), {state: 'blocked', reason: 'desktopBrowser'})
})

test('a closed session starts nothing more', async (t) => {
  const home = process.env.HOME
  process.env.HOME = mkdtempSync(join(tmpdir(), 'aitr-guard-'))
  t.after(() => {
    rmSync(process.env.HOME, {recursive: true, force: true})
    process.env.HOME = home
  })
  const session = await desktopSession(options, {findBrowser: () => '/nonexistent/browser'})
  await session.close()
  await assert.rejects(session.open(), {code: 'STRICT_PROXY'})
  assert.equal(await session.closed, 0)
})

test('the relay passes a name on 443 only, from no web page, and ends its tunnels', async (t) => {
  const seen = []
  const tunnel = createServer()
  tunnel.on('connect', (req, socket) => {
    seen.push(req.url)
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  })
  tunnel.listen(0, '127.0.0.1')
  await once(tunnel, 'listening')
  const local = await relay(tunnel.address().port, 'pw')
  t.after(() => {
    local.stop()
    tunnel.closeAllConnections()
    tunnel.close()
  })
  const ask = (path, headers = {}) =>
    new Promise((resolve) => {
      const req = request({host: '127.0.0.1', port: local.port, method: 'CONNECT', path, headers})
      req.once('connect', (res, socket) => resolve([res.statusCode, socket]))
      req.once('error', () => resolve([0]))
      req.end()
    })
  for (const bad of ['claude.ai:80', '1.2.3.4:443', '[::1]:443', 'localhost:443', 'a.b:4430'])
    assert.equal((await ask(bad))[0], 403, bad)
  assert.equal((await ask('claude.ai:443', {origin: 'https://evil.example'}))[0], 403)
  assert.deepEqual(seen, [])
  const [status, socket] = await ask('claude.ai:443')
  assert.equal(status, 200)
  assert.deepEqual(seen, ['claude.ai:443'])
  const closed = once(socket, 'close')
  local.stop()
  await closed
})

test('Windows: a .cmd line is quoted word by word; what cmd would expand is refused', () => {
  const [file, argv] = windowsLine('C:\\npm\\codex.cmd', ['login', 'a b'], 'C:\\cmd.exe')
  assert.equal(file, 'C:\\cmd.exe')
  assert.deepEqual(argv, ['/d', '/s', '/c', '""C:\\npm\\codex.cmd" "login" "a b""'])
  for (const bad of ['a&b', '%PATH%', 'x"y', 'a|b', 'a^b', 'a\nb', '!x!', 'a>b', 'C:\\dir\\'])
    assert.throws(() => windowsLine('c.cmd', [bad]), {code: 'STRICT_COMMAND'})
})

test('Codex never retries its sign-in outside the proxy; other CLIs keep their words', () => {
  const off = [
    '-c',
    'features.system_proxy_fallback=false',
    '-c',
    'features.respect_system_proxy=false',
  ]
  for (const program of ['/usr/local/bin/codex', 'C:\\npm\\codex.cmd', 'CODEX.EXE'])
    assert.deepEqual(vendorArgs(program, ['login']), [...off, 'login'], program)
  assert.deepEqual(vendorArgs('/usr/bin/claude', ['auth', 'login']), ['auth', 'login'])
  assert.deepEqual(vendorArgs('/usr/bin/codexx', []), [])
})

test('inherited variables cannot move the stored sign-in off the private home', () => {
  const settings = {port: 5, origin, provider: 'anthropic', home: 'H', bin: 'B', browser: 'B/b'}
  const base = {
    PATH: '/bin',
    CLAUDE_SECURESTORAGE_CONFIG_DIR: '/x',
    Gemini_Force_Encrypted_File_Storage: '1',
  }
  const env = cliEnvironment({...settings, profileDir: 'P', exe: 'E'}, base, 'darwin')
  assert.deepEqual(
    Object.keys(env).filter((k) => /SECURESTORAGE|ENCRYPTED_FILE/i.test(k)),
    [],
  )
  assert.equal(env.CLAUDE_CONFIG_DIR, join('H', '.claude'))
})
