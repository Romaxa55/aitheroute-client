import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {pairHelper, pairingCode, signInBlocker} from '../steps.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'aitr-steps-'))
const answer = (status, body) => async () => new Response(body, {status})

describe('pairingCode', () => {
  it('takes the code, sending the token in its header', async () => {
    let seen
    const request = async (url, init) => (
      (seen = {url, init}),
      new Response('{"code":"pair_1"}', {status: 201})
    )
    assert.deepEqual(await pairingCode('https://gw.example', 'atr_1', request), {code: 'pair_1'})
    assert.equal(seen.url, 'https://gw.example/login/install')
    assert.equal(seen.init.method, 'POST')
    assert.equal(seen.init.headers['x-aitheroute-token'], 'atr_1')
  })

  it('says why there is none', async () => {
    const cases = [
      [410, 'gone'],
      [403, 'invalid'],
      [400, 'invalid'],
      [429, 'tooMany'],
      [502, 'unreachable'],
    ]
    for (const [status, stop] of cases)
      assert.deepEqual(await pairingCode('https://x', 't', answer(status, '{}')), {stop})
    assert.deepEqual(await pairingCode('https://x', 't', answer(201, 'not json')), {
      stop: 'unreachable',
    })
    const codex = answer(201, '{"code":"pair_1","provider":"openai"}')
    assert.deepEqual(await pairingCode('https://x', 't', codex), {stop: 'notClaude'})
    const down = async () => {
      throw new TypeError('fetch failed')
    }
    assert.deepEqual(await pairingCode('https://x', 't', down), {stop: 'unreachable'})
  })
})

describe('pairHelper', () => {
  it('gives the code on stdin, and picks a fresh profile where it must choose', () => {
    const calls = []
    const run = (_node, args, options) => (
      calls.push([args.slice(1), options.input]),
      {status: args[1] === 'pair' ? 2 : 0}
    )
    assert.equal(pairHelper('/h/cli.mjs', 'https://gw.example', 'pair_1', run), true)
    assert.deepEqual(calls, [
      [['pair', 'https://gw.example'], 'pair_1\n'],
      [['select', 'anthropic', 'clean'], undefined],
    ])
    assert.equal(
      pairHelper('/h/cli.mjs', 'https://x', 'c', () => ({status: 1})),
      false,
    )
  })
})

describe('signInBlocker', () => {
  const helper = ({browser, strict}) => {
    const dir = temp()
    mkdirSync(join(dir, 'strict'))
    writeFileSync(
      join(dir, 'desktop.mjs'),
      `export const findBrowser = () => { if (!${browser}) throw new Error('none') }`,
    )
    const fail = strict ? '' : "throw new Error('STRICT_BWRAP')"
    writeFileSync(
      join(dir, 'strict', 'system.mjs'),
      `export const checkDependencies = async () => { ${fail} }\nexport const executable = async () => '/usr/bin/claude'`,
    )
    return dir
  }

  it('needs Chrome or Edge on macOS and Windows', async () => {
    assert.equal(await signInBlocker(helper({browser: true}), 'darwin'), null)
    assert.equal(await signInBlocker(helper({browser: false}), 'darwin'), 'noBrowser')
    assert.equal(await signInBlocker(helper({browser: false}), 'win32'), 'noBrowser')
  })

  it('needs the sandbox packages and a desktop on Linux', async () => {
    const yes = () => true
    assert.equal(await signInBlocker(helper({strict: true}), 'linux', {}, yes), null)
    assert.equal(
      await signInBlocker(helper({strict: true}), 'linux', {}, () => false),
      'linuxSignIn',
    )
    assert.equal(await signInBlocker(helper({strict: false}), 'linux', {}, yes), 'linuxSignIn')
  })
})
