import assert from 'node:assert/strict'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {main} from '../protect.mjs'
import {NONE} from './fake-core.mjs'

function deps(over = {}) {
  const base = mkdtempSync(join(tmpdir(), 'aitr-protect-'))
  const said = []
  const d = {
    base,
    env: {},
    settingsFile: join(base, 'settings.json'),
    hostsFile: '/etc/hosts',
    protectCommand: 'sh start.sh protect',
    words: new Proxy({}, {get: (_, key) => String(key)}),
    say: (key) => said.push(key),
    stop: (key) => (said.push('stop ' + key), 1),
    askLine: async () => '',
    conflicts: () => NONE,
    hostsOn: () => false,
    hostsLeft: () => false,
    hostsShadowed: () => [],
    hostsGuard: () => null,
    writeHosts: (on) => said.push('hosts ' + on),
    ...over,
  }
  return {d, said}
}

describe('start protect', () => {
  it('as the elevated child, only writes the hosts file', async () => {
    const ok = deps()
    assert.equal(await main(['hosts', 'on'], ok.d), 0)
    assert.equal(await main(['hosts', 'off'], ok.d), 0)
    assert.deepEqual(ok.said, ['hosts true', 'hosts false'])
    const denied = deps({
      writeHosts: () => {
        throw new Error('EACCES')
      },
    })
    assert.equal(await main(['hosts', 'on'], denied.d), 1)
  })

  it('shows how to use it, and needs a setup before it turns on', async () => {
    const {d, said} = deps()
    assert.equal(await main([], d), 2)
    assert.equal(await main(['hosts', 'maybe'], d), 2)
    assert.equal(await main(['on'], d), 1)
    assert.deepEqual(said, ['guardUsage', 'guardUsage', 'stop guardNoSetup'])
  })

  it('turns on over the saved gateway, never over a value of someone else', async () => {
    const {d, said} = deps()
    writeFileSync(join(d.base, 'env.sh'), "export ANTHROPIC_BASE_URL='https://gw.example'\n")
    assert.equal(await main(['on'], d), 0)
    assert.deepEqual(said, ['guardSettingsOnly'])
    const foreign = deps({conflicts: () => ({...NONE, settings: ['ANTHROPIC_API_KEY']})})
    writeFileSync(
      join(foreign.d.base, 'env.sh'),
      "export ANTHROPIC_BASE_URL='https://gw.example'\n",
    )
    assert.equal(await main(['on'], foreign.d), 1)
    assert.deepEqual(foreign.said, ['stop foreignSettings'])
  })

  it('turns off and tells the state', async () => {
    const {d, said} = deps()
    assert.equal(await main(['status'], d), 0)
    assert.equal(await main(['off'], d), 0)
    assert.deepEqual(said, ['guardIsOff', 'guardOff'])
  })
})
