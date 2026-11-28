import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {Duplex} from 'node:stream'
import {test} from 'node:test'
import {gate} from '../gate.mjs'
import {control} from '../strict/ipc.mjs'
import {probe} from '../strict/probe.mjs'
import {checkDependencies, checkNode, executable, wireCode} from '../strict/system.mjs'
import {renderScreen} from '../screen/render.mjs'

async function blocked(check) {
  const controller = gate(async () => ({
    check,
    closed: new Promise(() => {}),
    close: async () => {},
  }))
  await controller.start()
  assert.equal(controller.snapshot().state, 'blocked')
  assert.equal(await controller.continue(), false)
  return controller.snapshot().reason
}

test('missing or unusable dependencies retain their own display-only codes', async () => {
  const table = [
    ['bwrap', 'bwrap'],
    ['Xephyr', 'xephyr'],
    ['chromium', 'chromium'],
    ['node', 'node'],
  ]
  for (const [binary, reason] of table) {
    const seen = []
    const find = async (path) => {
      seen.push(path)
      if (path === '/usr/bin/' + binary) throw new Error('private path')
    }
    assert.equal(await blocked(() => checkDependencies(find, async () => {})), reason)
    assert.ok(seen.includes('/usr/bin/' + binary))
  }
  assert.equal(
    await blocked(() => executable('aitr-test-program-does-not-exist-in-usr')),
    'cliMissing',
  )
  assert.equal(await blocked(() => checkNode(async () => ({stdout: 'v24.4.9'}))), 'nodeVersion')
  await checkNode(async () => ({stdout: 'v24.5.0'}))
  assert.equal(await blocked(() => checkNode(async () => ({stdout: 'unknown'}))), 'node')
  assert.equal(
    await blocked(() =>
      checkNode(async () => {
        throw new Error('private path')
      }),
    ),
    'node',
  )
})

test('challenge, vendor CONNECT and TLS failures survive the worker IPC and reach the rendered gate', async (t) => {
  for (const [stage, code, reason] of [
    ['proof', 'STRICT_GATEWAY_PROOF', 'gatewayProof'],
    ['host', 'STRICT_PROVIDER_HOST', 'providerHost'],
    ['tls', 'STRICT_PROVIDER_TLS', 'providerTls'],
  ]) {
    const targets = []
    const server = createServer()
    server.on('connect', (req, sock) => {
      targets.push(req.url)
      sock.on('error', () => {})
      if (req.url === 'check.login.invalid:443') {
        sock.write('HTTP/1.1 200 OK\r\n\r\n')
        sock.once('data', (data) =>
          sock.end(
            stage === 'proof' ? Buffer.alloc(37) : Buffer.concat([Buffer.from('AITR1'), data]),
          ),
        )
      } else if (stage === 'host') sock.end('HTTP/1.1 502 Unavailable\r\n\r\n')
      else {
        sock.write('HTTP/1.1 200 OK\r\n\r\n')
        sock.once('data', () => sock.end('invalid TLS'))
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => server.close())
    let isolatedCode
    await assert.rejects(probe(server.address().port, '0'.repeat(32), 'fixture.invalid'), (err) => {
      isolatedCode = wireCode(err.code)
      return isolatedCode === code
    })
    assert.deepEqual(
      targets,
      stage === 'proof'
        ? ['check.login.invalid:443']
        : ['check.login.invalid:443', 'fixture.invalid:443'],
    )
    const peer = new Duplex({
      read() {},
      write(_data, _encoding, done) {
        this.push(JSON.stringify({code: isolatedCode}) + '\n')
        done()
      },
    })
    const wire = control(
      () => {},
      () => {},
    )
    wire.attach(peer)
    assert.equal(await blocked(() => wire.request({action: 'check'})), reason)
    peer.destroy()
    const html = await renderScreen({
      provider: 'chatgpt',
      mode: 'browser',
      state: 'blocked',
      reason,
    })
    assert.ok(!html.includes('action="continue"'))
    assert.match(html, new RegExp('blocked\\|chatgpt\\|browser\\|' + reason))
  }
  assert.equal(wireCode('sensitive URL'), 'STRICT_NETWORK')
})
