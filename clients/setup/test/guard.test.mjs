import assert from 'node:assert/strict'
import {existsSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import * as g from '../guard.mjs'
import {GW, guardDeps, read} from './guard-deps.mjs'

describe('the leak guard', () => {
  it("adds the gateway and the flags to settings.json's env, and takes out only what it added", () => {
    const {d} = guardDeps()
    writeFileSync(
      d.settingsFile,
      JSON.stringify({model: 'x', env: {FOO: '1', DISABLE_TELEMETRY: '1'}}),
    )
    const added = g.guardSettings(true, GW, d.settingsFile)
    assert.deepEqual(read(d.settingsFile).env, {
      FOO: '1',
      DISABLE_TELEMETRY: '1',
      ANTHROPIC_BASE_URL: GW,
      ...g.FLAGS,
    })
    assert.deepEqual(added.sort(), ['ANTHROPIC_BASE_URL', ...Object.keys(g.FLAGS)].sort())
    assert.deepEqual(g.guardSettings(false, GW, d.settingsFile, added), [])
    assert.deepEqual(read(d.settingsFile), {model: 'x', env: {FOO: '1', DISABLE_TELEMETRY: '1'}})
    // A flag the person set, to any value, is theirs; a value they changed since is theirs too.
    writeFileSync(
      d.settingsFile,
      JSON.stringify({env: {CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true'}}),
    )
    const mine = g.guardSettings(true, GW, d.settingsFile)
    assert.ok(!mine.includes('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'))
    assert.equal(read(d.settingsFile).env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, 'true')
    const s = read(d.settingsFile)
    writeFileSync(
      d.settingsFile,
      JSON.stringify({...s, env: {...s.env, ANTHROPIC_BASE_URL: 'https://other'}}),
    )
    g.guardSettings(false, GW, d.settingsFile, mine)
    assert.deepEqual(read(d.settingsFile).env, {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
      ANTHROPIC_BASE_URL: 'https://other',
    })
    writeFileSync(d.settingsFile, '{not json')
    assert.equal(g.guardSettings(true, GW, d.settingsFile), null)
  })

  it('turns on: the settings, then the hosts file if the person says yes', async () => {
    const yesDeps = guardDeps()
    assert.equal(await g.guardOn(yesDeps.d, GW), 0)
    assert.deepEqual(yesDeps.said, ['? guardHostsAsk', 'guardOn sh start.sh protect off'])
    assert.equal(g.readGuard(yesDeps.d.base).origin, GW)
    const noDeps = guardDeps({askLine: async () => ''})
    await g.guardOn(noDeps.d, GW)
    assert.deepEqual(noDeps.said, ['guardSettingsOnly sh start.sh protect off'])
    const already = guardDeps()
    already.setHosts(true)
    await g.guardOn(already.d, GW)
    assert.deepEqual(already.said, ['guardOn sh start.sh protect off'])
    // A line of the person's above the block still sends a host elsewhere: said after on.
    const shadow = guardDeps({hostsShadowed: () => ['claude.ai']})
    shadow.setHosts(true)
    await g.guardOn(shadow.d, GW)
    assert.deepEqual(shadow.said, ['guardOn sh start.sh protect off', 'guardHostsShadowed'])
    g.guardStatus(shadow.d)
    assert.deepEqual(shadow.said.slice(2), ['guardIsOn', 'guardHostsShadowed'])
    // A block cut short (an append stopped midway) is finished without asking again.
    const part = guardDeps()
    part.setPart(true)
    await g.guardOn(part.d, GW)
    assert.deepEqual(part.said, ['guardOn sh start.sh protect off'])
    assert.ok(part.d.hostsOn())
    const failed = guardDeps({hostsGuard: () => 'guardHostsRights'})
    await g.guardOn(failed.d, GW)
    assert.deepEqual(failed.said, ['? guardHostsAsk', 'guardHostsRights sh start.sh protect off'])
    const broken = guardDeps()
    writeFileSync(broken.d.settingsFile, '[]')
    assert.equal(await g.guardOn(broken.d, GW), 1)
    assert.deepEqual(broken.said, ['stop flagsFailed'])
  })

  it('turns off both layers, and says so when the hosts file could not be changed', async () => {
    const {d, said} = guardDeps()
    await g.guardOn(d, GW)
    said.length = 0
    assert.equal(g.guardOff(d), 0)
    assert.deepEqual(said, ['guardOff'])
    assert.ok(!existsSync(join(d.base, 'guard.json')))
    // It made settings.json, so it takes it away; it never makes one to take things out of.
    assert.ok(!existsSync(d.settingsFile))
    assert.equal(g.guardOff(d), 0)
    assert.ok(!existsSync(d.settingsFile))
    const kept = guardDeps()
    writeFileSync(kept.d.settingsFile, '{"model": "x"}')
    await g.guardOn(kept.d, GW)
    g.guardOff(kept.d)
    assert.deepEqual(read(kept.d.settingsFile), {model: 'x'})
    const refused = guardDeps({hostsGuard: () => 'guardHostsRights'})
    refused.setHosts(true)
    assert.equal(g.guardOff(refused.d), 1)
    assert.deepEqual(refused.said, ['stop guardHostsLeft'])
    const part = guardDeps()
    part.setPart(true)
    assert.equal(g.guardOff(part.d), 0)
    assert.ok(!part.d.hostsLeft())
  })

  it("takes our gateway's address out even when the guard's record is gone", () => {
    const {d, said} = guardDeps()
    writeFileSync(join(d.base, 'env.sh'), "export ANTHROPIC_BASE_URL='https://gw.example'\n")
    writeFileSync(d.settingsFile, JSON.stringify({env: {ANTHROPIC_BASE_URL: GW, FOO: '1'}}))
    assert.equal(g.guardOff(d), 0)
    assert.deepEqual(read(d.settingsFile), {env: {FOO: '1'}})
    assert.deepEqual(said, ['guardOff'])
  })

  it('tells its four states, and keeps itself through a new setup run', async () => {
    const {d, said, setHosts} = guardDeps()
    const state = () => (said.length = 0) || (g.guardStatus(d), said[0])
    assert.equal(state(), 'guardIsOff')
    setHosts(true)
    assert.equal(state(), 'guardIsHostsOnly')
    await g.guardOn(d, GW)
    assert.equal(state(), 'guardIsOn')
    setHosts(false)
    assert.equal(state(), 'guardIsSettingsOnly')
    // The setup dropped our address, the gateway has a new one: both come back right.
    writeFileSync(d.settingsFile, '{}')
    assert.ok(g.guardKeep(d, 'https://new.example'))
    assert.equal(read(d.settingsFile).env.ANTHROPIC_BASE_URL, 'https://new.example')
    assert.equal(g.readGuard(d.base).origin, 'https://new.example')
  })
})
