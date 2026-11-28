import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {Readable, Writable} from 'node:stream'
import {describe, it} from 'node:test'
import {askLine, askToken, findToken, runCaptured} from '../token.mjs'

const TOKEN = 'sk-ant-oat01-' + 'Ab3_-'.repeat(20)
const silent = new Writable({write: (_c, _e, done) => done()})
const lines = (text) => Readable.from([text])

describe('findToken', () => {
  it('finds a token on its own line', () => {
    assert.equal(findToken('Your token:\n\n' + TOKEN + '\n\nStore it safely.\n'), TOKEN)
  })

  it('joins the pieces Claude Code wrapped to the terminal width, past colours', () => {
    const wrapped =
      '\x1b[1m' +
      TOKEN.slice(0, 40) +
      '\x1b[0m\r\n' +
      TOKEN.slice(40, 80) +
      '\r\n' +
      TOKEN.slice(80)
    assert.equal(findToken('Token:\r\n' + wrapped + '\r\n\r\nStore it safely.'), TOKEN)
  })

  it('joins a token drawn inside a frame', () => {
    const framed = [
      '\u256d' + '\u2500'.repeat(10),
      '\u2502 ' + TOKEN.slice(0, 60) + ' \u2502',
      '\u2502 ' + TOKEN.slice(60) + ' \u2502',
      '\u2570',
    ]
    assert.equal(findToken(framed.join('\n')), TOKEN)
  })

  it('does not glue the next line onto a token that ends before its line does', () => {
    assert.equal(findToken(TOKEN + ' (keep it)\nnextword\n'), TOKEN)
  })

  it('takes the last token and refuses one too short or none', () => {
    const older = 'sk-ant-oat01-' + 'z'.repeat(30)
    assert.equal(findToken(older + '\n\n' + TOKEN + '\n'), TOKEN)
    assert.equal(findToken('sk-ant-oat01-short\n'), null)
    assert.equal(findToken('nothing here'), null)
  })
})

describe('runCaptured', () => {
  it('runs the command plainly on Windows, with nothing to read', () => {
    const calls = []
    const out = runCaptured(
      'claude',
      ['setup-token'],
      'win32',
      (...a) => (calls.push(a), {status: 0}),
    )
    assert.equal(out, '')
    assert.deepEqual(calls[0].slice(0, 2), ['claude', ['setup-token']])
  })

  it('records the session with script on macOS and Linux and returns it', () => {
    for (const [platform, logAt] of [
      ['darwin', 1],
      ['linux', 4],
    ]) {
      const calls = []
      const run = (command, argv) => {
        calls.push([command, argv])
        writeFileSync(argv[logAt], 'printed ' + platform)
        return {status: 0}
      }
      assert.equal(runCaptured('node', ["it's", 'run'], platform, run), 'printed ' + platform)
      assert.equal(calls[0][0], 'script')
    }
  })

  it('quotes the command for Linux script -c', () => {
    let argv
    runCaptured(
      'node',
      ["it's"],
      'linux',
      (_c, a) => ((argv = a), writeFileSync(a[4], ''), {status: 0}),
    )
    assert.equal(argv[3], `'node' 'it'\\''s'`)
  })

  it('runs the command itself when script is missing', () => {
    const calls = []
    const run = (command, argv) => (
      calls.push(command),
      command === 'script' ? {error: new Error('ENOENT')} : {status: 0}
    )
    assert.equal(runCaptured('node', [], 'darwin', run), '')
    assert.deepEqual(calls, ['script', 'node'])
  })
})

describe('runCaptured, its environment', () => {
  it('hands script the environment, with sh to read its line', () => {
    let options
    const run = (_c, argv, o) => ((options = o), writeFileSync(argv[4], 'x'), {status: 0})
    runCaptured('node', [], 'linux', run, {KEEP: '1', SHELL: '/usr/bin/fish'})
    assert.deepEqual(options.env, {KEEP: '1', SHELL: '/bin/sh'})
  })

  it('runs the command plainly when script refused it and recorded nothing', () => {
    const calls = []
    const run = (command, _argv, o) => (
      calls.push([command, o.env]),
      {status: command === 'script' ? 1 : 0}
    )
    assert.equal(runCaptured('node', [], 'linux', run, {KEEP: '1'}), '')
    assert.deepEqual(calls[1], ['node', {KEEP: '1'}])
  })
})

describe('askToken and askLine', () => {
  it('joins pasted pieces until an empty line after them', async () => {
    const pasted = '\n' + TOKEN.slice(0, 50) + '\n' + TOKEN.slice(50) + '\n\nlater\n'
    assert.equal(await askToken('Paste:', lines(pasted), silent), TOKEN)
  })

  it('takes what came when the input ends, and refuses what is not a token', async () => {
    assert.equal(await askToken('Paste:', lines(TOKEN), silent), TOKEN)
    assert.equal(await askToken('Paste:', lines('not a token\n\n'), silent), null)
  })

  it('reads one trimmed line, or nothing', async () => {
    assert.equal(
      await askLine('Command:', lines('  curl https://x/i/atr_1 | sh  \nmore\n'), silent),
      'curl https://x/i/atr_1 | sh',
    )
    assert.equal(await askLine('Command:', lines(''), silent), '')
  })
})
