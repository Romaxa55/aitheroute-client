import assert from 'node:assert/strict'
import {once} from 'node:events'
import {chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync} from 'node:fs'
import {rmSync, writeFileSync} from 'node:fs'
import {createServer, request} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import test from 'node:test'
import {desktopSession} from '../desktop-session.mjs'

const origin = 'https://route.example.com'
const page = 'https://claude.ai/login'
const posix = process.platform !== 'win32'
const names = 'HTTPS_PROXY https_proxy NO_PROXY CLAUDE_CONFIG_DIR HOME BROWSER PATH'.split(' ')

async function stand(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aitr-desktop-'))
  const home = process.env.HOME
  process.env.HOME = dir
  const out = join(dir, 'browser.args')
  const browser = join(dir, 'fake-browser')
  writeFileSync(browser, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${out}'\nexec sleep 30\n`)
  chmodSync(browser, 0o755)
  // The helper's authenticated tunnel listener: records the credential, echoes.
  const seen = []
  const tunnel = createServer()
  tunnel.on('connect', (req, socket) => {
    seen.push([req.url, req.headers['proxy-authorization']])
    socket.end('HTTP/1.1 200 Connection Established\r\n\r\n')
  })
  tunnel.listen(0, '127.0.0.1')
  await once(tunnel, 'listening')
  t.after(() => {
    tunnel.close()
    process.env.HOME = home
    rmSync(dir, {recursive: true, force: true})
  })
  const probes = []
  const sessions = []
  t.after(() => Promise.all(sessions.map((s) => s.close())))
  const start = (command = null) =>
    desktopSession(
      {
        origin,
        provider: 'anthropic',
        page,
        command,
        proxy: {port: tunnel.address().port, password: 'pw'},
      },
      {findBrowser: () => browser, probe: async (...a) => probes.push(a)},
    ).then((s) => sessions.push(s) && s)
  return {dir, out, seen, probes, start, port: tunnel.address().port}
}

const until = async (ok) => {
  for (let i = 0; i < 200 && !ok(); i++) await delay(25)
  assert.ok(ok())
}
const argsOf = (out) => readFileSync(out, 'utf8').trim().split('\n')
const flag = (args, name) => args.find((a) => a.startsWith(name + '='))?.slice(name.length + 1)

test(
  'the browser opens the page in its own profile through the relay, and is cleaned up',
  {skip: !posix},
  async (t) => {
    const {out, seen, probes, start, port} = await stand(t)
    const session = await start()
    await session.check()
    await session.open()
    await until(() => existsSync(out))
    const args = argsOf(out)
    assert.equal(args.at(-1), page)
    const profile = flag(args, '--user-data-dir')
    const prefs = JSON.parse(readFileSync(join(profile, 'Default', 'Preferences'), 'utf8'))
    assert.equal(prefs.webrtc.ip_handling_policy, 'disable_non_proxied_udp')
    const local = JSON.parse(readFileSync(join(profile, 'Local State'), 'utf8'))
    assert.equal(local.dns_over_https.mode, 'off')
    assert.match(
      flag(args, '--host-resolver-rules'),
      /^MAP \* \^NOTFOUND, EXCLUDE localhost, EXCLUDE 127\.0\.0\.1, EXCLUDE route\.example\.com$/,
    )
    assert.ok(args.includes('--webrtc-ip-handling-policy=disable_non_proxied_udp'))
    const relayPort = Number(new URL(flag(args, '--proxy-server')).port)
    assert.notEqual(relayPort, port)
    assert.deepEqual(
      probes,
      [[relayPort, 'pw', 'claude.ai']],
      'the route is checked as the browser goes',
    )
    const req = request({
      host: '127.0.0.1',
      port: relayPort,
      method: 'CONNECT',
      path: 'claude.ai:443',
    })
    req.end()
    const [res, socket] = await once(req, 'connect')
    socket.destroy()
    assert.equal(res.statusCode, 200)
    assert.deepEqual(seen, [
      ['claude.ai:443', 'Basic ' + Buffer.from('route:pw').toString('base64')],
    ])
    await assert.rejects(session.open(), {code: 'STRICT_PROXY'})
    await session.close()
    assert.equal(await session.closed, 0)
    assert.ok(!existsSync(profile), 'the temporary browser profile is removed')
  },
)

test(
  'a CLI runs with the relay as its proxy, its own config home, and its exit status',
  {skip: !posix},
  async (t) => {
    const {dir, out, start} = await stand(t)
    const report = join(dir, 'cli.json')
    const cli = join(dir, 'cli.mjs')
    writeFileSync(
      cli,
      `import {writeFileSync} from 'node:fs'\nconst e = process.env\n` +
        `writeFileSync(${JSON.stringify(report)}, JSON.stringify({cwd: process.cwd(), ...Object.fromEntries(${JSON.stringify(names)}.map((n) => [n, e[n]]))}))\n` +
        'process.exit(7)\n',
    )
    const session = await start([process.execPath, cli])
    await session.open()
    assert.equal(await session.closed, 7)
    const env = JSON.parse(readFileSync(report, 'utf8'))
    const relay = 'http://127.0.0.1:' + new URL(flag(argsOf(out), '--proxy-server')).port
    assert.equal(argsOf(out).at(-1), 'about:blank')
    assert.equal(env.HTTPS_PROXY, relay)
    assert.equal(env.https_proxy, relay)
    assert.match(env.NO_PROXY, /(^|,)route\.example\.com(,|$)/)
    assert.equal(env.HOME, dir, "HOME stays the person's own")
    const home = join(realpathSync(dir), '.aitheroute', 'strict', 'anthropic')
    assert.equal(env.CLAUDE_CONFIG_DIR, join(home, '.claude'))
    assert.equal(realpathSync(env.cwd), realpathSync(home), 'the CLI starts in the private home')
    assert.ok(env.PATH.startsWith(join(env.BROWSER, '..')))
  },
)
