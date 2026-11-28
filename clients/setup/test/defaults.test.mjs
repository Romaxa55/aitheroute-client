import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {checkEnv, defaults, language, protectCommand, signInEnv} from '../defaults.mjs'
import {fakeCore} from './fake-core.mjs'

describe('the setup core, its pieces', () => {
  it('picks the language', () => {
    assert.equal(language({AITR_LANG: 'en'}, 'ru-RU'), 'en')
    assert.equal(language({}, 'ru-RU'), 'ru')
    assert.equal(language({AITR_LANG: 'de'}, 'en-US'), 'en')
  })

  it('signs in without the gateway, a key or an older sign-in in the environment', () => {
    const env = {
      PATH: '/bin',
      ANTHROPIC_BASE_URL: 'x',
      anthropic_api_key: 'k',
      CLAUDE_CODE_OAUTH_TOKEN: 'o',
      KEEP: '1',
    }
    assert.deepEqual(signInEnv(env), {PATH: '/bin', KEEP: '1'})
  })

  it('checks the sign-in without an API key that would win over it', () => {
    const env = {PATH: '/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://gw.example'}
    assert.deepEqual(checkEnv(env), {PATH: '/bin', ANTHROPIC_BASE_URL: 'https://gw.example'})
  })

  it('wires the real steps, the words and the helper', () => {
    const d = defaults({AITR_LANG: 'en'})
    assert.equal(typeof d.words.done, 'string')
    assert.ok(d.helper.endsWith('cli.mjs'))
    assert.deepEqual(Object.keys(fakeCore().d).sort(), Object.keys(d).sort())
  })

  it('gives the leak guard command in a form the person can paste into their shell', () => {
    assert.equal(
      protectCommand('darwin', '/Users/a/.aitheroute'),
      'sh ~/.aitheroute/start.sh protect',
    )
    // cmd and PowerShell both run a full path; with a space only cmd /c "..." works in both.
    const mine = protectCommand('win32', 'C:\\Users\\user\\.aitheroute')
    assert.equal(mine, 'C:\\Users\\user\\.aitheroute\\start.cmd protect')
    const spaced = protectCommand('win32', 'C:\\Users\\A B\\.aitheroute')
    assert.equal(spaced, 'cmd /c "C:\\Users\\A B\\.aitheroute\\start.cmd" protect')
    // Any other sign breaks cmd, and PowerShell runs a .cmd through cmd: Node itself, in PowerShell.
    const node = 'C:\\Program Files\\nodejs\\node.exe'
    const odd = protectCommand('win32', "C:\\Users\\O'Brien (R&D)\\.aitheroute", node)
    const want = "& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\Users\\O''Brien (R&D)\\.aitheroute"
    assert.equal(odd, want + "\\setup\\protect.mjs'")
    assert.match(protectCommand('win32', 'C:\\Users\\R%D\\.aitheroute'), /^& '/)
  })
})
