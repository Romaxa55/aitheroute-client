import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {main} from '../core.mjs'
import {fakeCore, NONE} from './fake-core.mjs'

/** Every stop of the setup core, and what it has not done by then. */

const stopsWith = async (over, key) => {
  const run = fakeCore(over)
  assert.equal(await main(run.d), 1)
  assert.equal(run.stops.at(-1).key, key)
  return run
}

describe('the setup core stops before it installs or saves anything', () => {
  it('for a command it cannot read, or a half-unpacked archive', async () => {
    const garbage = fakeCore({askLine: async () => 'hello'})
    garbage.d.env = {PATH: '/usr/bin'}
    assert.equal(await main(garbage.d), 1)
    assert.equal(garbage.stops[0].key, 'invalid')
    await stopsWith({helper: undefined, pairingCode: assert.fail}, 'incomplete')
  })

  it('for credentials that would override the gateway', async () => {
    const shell = await stopsWith(
      {conflicts: () => ({...NONE, shell: ['ANTHROPIC_AUTH_TOKEN']}), pairingCode: assert.fail},
      'foreignEnv',
    )
    assert.deepEqual(shell.stops[0].vars, {names: 'ANTHROPIC_AUTH_TOKEN'})
    const settings = await stopsWith(
      {
        conflicts: () => ({...NONE, settings: ['ANTHROPIC_BASE_URL', 'apiKeyHelper']}),
        pairingCode: assert.fail,
      },
      'foreignSettings',
    )
    assert.deepEqual(settings.stops[0].vars, {
      names: 'ANTHROPIC_BASE_URL, apiKeyHelper',
      file: '/h/.claude/settings.json',
    })
  })

  it('for a token the gateway refuses', async () => {
    for (const key of ['gone', 'invalid', 'tooMany', 'unreachable'])
      await stopsWith({pairingCode: async () => ({stop: key}), ensureClaude: assert.fail}, key)
  })

  it('when Claude Code cannot be installed or its files written', async () => {
    await stopsWith({ensureClaude: () => ({stop: 'noNpm'}), save: assert.fail}, 'noNpm')
    const flags = await stopsWith(
      {claudeFlags: () => '/h/.claude.json', save: assert.fail},
      'flagsFailed',
    )
    assert.deepEqual(flags.stops[0].vars, {file: '/h/.claude.json'})
  })
})

describe('the setup core saves nothing when the sign-in fails', () => {
  it('for a helper that would not pair, or no token at all', async () => {
    await stopsWith({pairHelper: () => false, save: assert.fail}, 'pairFailed')
    await stopsWith({setupToken: () => '', save: assert.fail}, 'noToken')
    await stopsWith({signInBlocker: async () => 'noBrowser', save: assert.fail}, 'noToken')
    let calls = 0
    await stopsWith(
      {
        now: () => (calls++ ? Number.MAX_SAFE_INTEGER : 0),
        pairingCode: async () => (calls > 1 ? {stop: 'gone'} : {code: 'pair_1'}),
        save: assert.fail,
      },
      'gone',
    )
  })
})

describe('the setup core after the sign-in', () => {
  it('warns of an API key that wins over the sign-in, and goes on', async () => {
    const {d, said} = fakeCore({conflicts: () => ({...NONE, apiKey: true})})
    assert.equal(await main(d), 0)
    assert.ok(said.includes('apiKey'))
  })

  it('drops what an earlier setup of ours left in settings.json', async () => {
    let dropped
    const {d} = fakeCore({
      conflicts: () => ({...NONE, ours: ['ANTHROPIC_BASE_URL']}),
      dropOurs: (keys) => ((dropped = keys), true),
    })
    assert.equal(await main(d), 0)
    assert.deepEqual(dropped, ['ANTHROPIC_BASE_URL'])
    await stopsWith({dropOurs: () => false}, 'flagsFailed')
  })

  it('says what to add by hand when the shell file is read-only', async () => {
    const {d, said} = fakeCore({save: () => 'rcFailed'})
    assert.equal(await main(d), 0)
    assert.ok(said.includes('rcFailed'))
  })

  it('stops when nothing could be saved, or the check fails', async () => {
    await stopsWith({save: () => 'envFailed'}, 'envFailed')
    const after = await stopsWith({check: () => false}, 'checkFailed')
    assert.equal(after.saved.length, 1)
  })
})
