import assert from 'node:assert/strict'
import {test} from 'node:test'
import {setTimeout as delay} from 'node:timers/promises'
import {strictSession} from '../strict.mjs'
import {gate} from '../gate.mjs'
import {guest, cancelBrowser} from './strict-linux-guest.mjs'
import {fixtureProxy} from './strict-linux-proxy.mjs'

// The release job always creates the disposable fixture and explicitly checks
// that this suite ran. A normal developer 'node --test' has no private desktop.
const fixture = process.env.AITR_STRICT_TEST_FIXTURE
const options = {skip: !fixture, timeout: 45000}

async function setup(t) {
  const peer = await fixtureProxy(fixture)
  t.after(() => peer.close())
  const failures = []
  const create = async (command, onFailure = () => {}) => {
    const session = await strictSession({
      origin: 'https://route.example',
      provider: 'chatgpt',
      page: 'https://chatgpt.com/auth/login',
      proxy: peer.proxy,
      command,
      onFailure: (code) => {
        failures.push(code)
        onFailure({code})
      },
    })
    t.after(() => session.close())
    return session
  }
  return {peer, create, failures}
}
const node = (source, ...args) => ['/usr/bin/node', '--input-type=module', '-e', source, ...args]

test(
  'isolated Chromium and CLI use the tunnel; a real browser completes a local OAuth callback',
  options,
  async (t) => {
    const {create, peer, failures} = await setup(t)
    const session = await create(node(guest, String(peer.proxy.port)))
    assert.deepEqual(peer.targets, [])
    await session.check()
    assert.deepEqual(peer.targets, ['check.login.invalid:443', 'chatgpt.com:443'])
    await session.open()
    assert.equal(await session.closed, 9)
    assert.deepEqual(failures, [])
    assert.equal(peer.transfers, 1)
    assert.equal(peer.requests, 0, 'TLS preflight sent application data')
    await session.close()
  },
)

test('browser exit cancels its isolated CLI', options, async (t) => {
  const {create} = await setup(t)
  const cancel = await create(node(cancelBrowser))
  await cancel.check()
  await cancel.open()
  assert.equal(await cancel.closed, 1)
})

test('a trusted certificate for a different hostname blocks navigation', options, async (t) => {
  const {create, peer} = await setup(t)
  peer.fault('certificate')
  const session = await create(null)
  await assert.rejects(session.check())
  assert.equal(await session.closed, 1)
  assert.deepEqual(peer.targets, ['check.login.invalid:443', 'chatgpt.com:443'])
  assert.equal(peer.requests, 0)
})

for (const failure of ['drop', 'revoked', 'offline']) {
  test('an active session closes when the gateway returns ' + failure, options, async (t) => {
    const {create, peer} = await setup(t)
    const monitor = gate((onFailure) => create(node('setInterval(()=>{},1000)'), onFailure), {
      interval: 75,
    })
    t.after(() => monitor.stop())
    assert.equal(await monitor.start(), true)
    assert.equal(await monitor.continue(), true)
    assert.equal(monitor.snapshot().state, 'active')
    peer.fault(failure)
    for (let i = 0; i < 200 && monitor.snapshot().state === 'active'; i++) await delay(40)
    assert.equal(monitor.snapshot().state, 'disconnected')
    assert.equal(await monitor.continue(), false)
  })
}
