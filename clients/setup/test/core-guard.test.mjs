import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {main} from '../core.mjs'
import {fakeCore, NONE} from './fake-core.mjs'

describe('the setup core and the leak guard', () => {
  it('offers the guard once the check has passed, and turns it on only on yes', async () => {
    const asked = []
    const yes = fakeCore({askLine: async (q) => (asked.push(q), 'y')})
    assert.equal(await main(yes.d), 0)
    assert.deepEqual(asked, ['guardAsk'])
    assert.deepEqual(yes.said.slice(-3), ['check', '(guardOn)', 'done'])
    const no = fakeCore()
    assert.equal(await main(no.d), 0)
    assert.ok(!no.said.includes('(guardOn)'))
    const failed = fakeCore({check: () => false, askLine: async (q) => (asked.push(q), 'y')})
    assert.equal(await main(failed.d), 1)
    assert.equal(asked.length, 1)
  })

  it('keeps a guard that is on: its address moved before the check, never dropped', async () => {
    const asked = []
    const dropped = []
    const on = fakeCore({
      guard: () => ({origin: 'https://old.example', added: []}),
      conflicts: () => ({...NONE, ours: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']}),
      dropOurs: (keys) => dropped.push(...keys) || true,
      askLine: async (q) => (asked.push(q), ''),
    })
    assert.equal(await main(on.d), 0)
    assert.deepEqual(asked, [])
    assert.deepEqual(dropped, ['ANTHROPIC_CUSTOM_HEADERS'])
    assert.deepEqual(on.said.slice(-4), ['(guardKeep)', 'check', 'guardKept', 'done'])
    // A check that fails leaves the guard as it was moved, not off.
    const failed = fakeCore({guard: () => ({origin: 'x', added: []}), check: () => false})
    assert.equal(await main(failed.d), 1)
    assert.ok(failed.said.includes('(guardKeep)'))
    const broken = fakeCore({guard: () => ({origin: 'x', added: []}), guardKeep: () => false})
    assert.equal(await main(broken.d), 1)
    assert.deepEqual(broken.stops, [{key: 'flagsFailed', vars: {file: '/h/.claude/settings.json'}}])
  })

  it('stops with the guard when turning it on failed', async () => {
    const failing = fakeCore({askLine: async () => 'y', guardOn: async () => 1})
    assert.equal(await main(failing.d), 1)
    assert.ok(!failing.said.includes('done'))
  })
})
