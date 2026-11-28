import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {CODE_FRESH_MS, main} from '../core.mjs'
import {fakeCore, OAUTH} from './fake-core.mjs'

describe('the setup core, a first run', () => {
  it('signs in through the helper and saves everything once, at the end', async () => {
    const {d, said, saved, stops} = fakeCore()
    assert.equal(await main(d), 0)
    assert.deepEqual(stops, [])
    assert.deepEqual(said, ['(prepare)', 'pair', 'signIn', 'env', 'check', 'done'])
    assert.deepEqual(saved, [
      {
        vars: {
          ANTHROPIC_BASE_URL: 'https://gw.example',
          ANTHROPIC_CUSTOM_HEADERS: 'x-aitheroute-token: atr_1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
          CLAUDE_CODE_OAUTH_TOKEN: OAUTH,
        },
        paths: ['/h/.aitheroute/claude/bin'],
      },
    ])
    assert.equal(d.env.AITR_TOKEN, undefined)
    assert.ok(d.env.PATH.startsWith('/h/.aitheroute/claude/bin'))
  })

  it("leaves PATH alone for the person's own Claude Code", async () => {
    const {d, saved} = fakeCore({ensureClaude: () => ({bin: null})})
    assert.equal(await main(d), 0)
    assert.deepEqual(saved[0].paths, [])
    assert.equal(d.env.PATH, '/usr/bin')
  })

  it('asks again for a pairing code that a slow download outlasted', async () => {
    let time = 0
    const codes = []
    const {d} = fakeCore({
      now: () => time,
      ensureClaude: () => ((time = CODE_FRESH_MS + 1), {bin: null}),
      pairingCode: async () => ({code: 'pair_' + codes.push(1)}),
      pairHelper: (_origin, code) => (codes.push(code), true),
    })
    assert.equal(await main(d), 0)
    assert.deepEqual(codes.slice(-1), ['pair_2'])
    const quick = []
    const fast = fakeCore({pairingCode: async () => ({code: 'pair_' + quick.push(1)})})
    assert.equal(await main(fast.d), 0)
    assert.equal(quick.length, 1)
  })

  it('asks for the token from elsewhere when the helper never got to print one', async () => {
    let question
    const {d} = fakeCore({
      setupToken: () => 'AI The Route: STRICT_DISPLAY\n',
      askToken: async (q) => ((question = q), OAUTH),
    })
    assert.equal(await main(d), 0)
    assert.equal(question, 'pasteOther')
  })

  it('asks for the token to be pasted when the helper prints none', async () => {
    let question
    const {d, saved} = fakeCore({
      setupToken: () => '',
      askToken: async (q) => ((question = q), OAUTH),
    })
    assert.equal(await main(d), 0)
    assert.equal(question, 'paste')
    assert.equal(saved[0].vars.CLAUDE_CODE_OAUTH_TOKEN, OAUTH)
  })

  it('takes a pasted token where the helper cannot open the sign-in', async () => {
    let question
    const {d, said, saved} = fakeCore({
      signInBlocker: async () => 'linuxSignIn',
      pairHelper: assert.fail,
      askToken: async (q) => ((question = q), OAUTH),
    })
    assert.equal(await main(d), 0)
    assert.ok(said.includes('linuxSignIn'))
    assert.equal(question, 'pasteOther')
    assert.equal(saved.length, 1)
  })
})

describe('the setup core, a run again', () => {
  it('keeps a sign-in that still works', async () => {
    const {d, said, saved} = fakeCore({setupToken: assert.fail})
    d.env.CLAUDE_CODE_OAUTH_TOKEN = OAUTH
    assert.equal(await main(d), 0)
    assert.ok(said.includes('keptSignIn'))
    assert.equal(saved[0].vars.CLAUDE_CODE_OAUTH_TOKEN, OAUTH)
  })

  it('signs in again when the saved sign-in no longer works', async () => {
    const results = [false, true]
    const {d, said} = fakeCore({check: () => results.shift()})
    d.env.CLAUDE_CODE_OAUTH_TOKEN = OAUTH
    assert.equal(await main(d), 0)
    assert.ok(said.includes('signIn') && !said.includes('keptSignIn'))
  })

  it('reads a new command typed in, or keeps the saved token on Enter', async () => {
    let question
    const typed = fakeCore({
      // The first question: the leak guard's comes last.
      askLine: async (q) => ((question ??= q), 'curl -fsSL https://gw.example/i/atr_9 | sh'),
    })
    typed.d.env = {PATH: '/usr/bin'}
    assert.equal(await main(typed.d), 0)
    assert.equal(question, 'command')
    assert.equal(typed.saved[0].vars.ANTHROPIC_CUSTOM_HEADERS, 'x-aitheroute-token: atr_9')
    question = undefined
    const kept = fakeCore({askLine: async (q) => ((question ??= q), '')})
    kept.d.env = {
      PATH: '/usr/bin',
      ANTHROPIC_BASE_URL: 'https://gw.example',
      ANTHROPIC_CUSTOM_HEADERS: 'x-aitheroute-token: atr_old',
    }
    assert.equal(await main(kept.d), 0)
    assert.equal(question, 'commandOrKeep')
    assert.equal(kept.saved[0].vars.ANTHROPIC_CUSTOM_HEADERS, 'x-aitheroute-token: atr_old')
  })
})
