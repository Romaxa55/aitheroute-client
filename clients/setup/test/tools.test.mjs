import assert from 'node:assert/strict'
import {existsSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {ensureClaude, fromCommand, fromSaved, npmCli, which} from '../tools.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'aitr-tools-'))
const touch = (path) => (
  mkdirSync(join(path, '..'), {recursive: true}),
  writeFileSync(path, ''),
  path
)

describe('which and npmCli', () => {
  it('finds a file on PATH, with PATHEXT on Windows, and skips folders', () => {
    const dir = temp()
    touch(join(dir, 'tool'))
    mkdirSync(join(dir, 'folder'))
    touch(join(dir, 'claude.cmd'))
    assert.equal(which('tool', {PATH: dir}, 'linux'), join(dir, 'tool'))
    assert.equal(which('folder', {PATH: dir}, 'linux'), null)
    assert.equal(
      which('claude', {PATH: dir, PATHEXT: '.EXE;.CMD'}, 'win32'),
      join(dir, 'claude.cmd'),
    )
    assert.equal(which('missing', {}, 'linux'), null)
  })

  it('finds npm beside Node.js in the portable and the Unix layouts', () => {
    const portable = temp()
    const cli = touch(join(portable, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    assert.equal(npmCli(join(portable, 'node.exe')), cli)
    const unix = temp()
    const lib = touch(join(unix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    assert.equal(
      npmCli(join(unix, 'bin', 'node')),
      join(unix, 'bin', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    )
    assert.ok(lib)
    // Debian's package, where this machine has it, is the last place to look.
    const debian = '/usr/share/nodejs/npm/bin/npm-cli.js'
    assert.equal(npmCli(join(temp(), 'node')), existsSync(debian) ? debian : null)
  })
})

describe('ensureClaude', () => {
  const withPath = (path, fn) => {
    const saved = process.env.PATH
    process.env.PATH = path
    try {
      return fn()
    } finally {
      process.env.PATH = saved
    }
  }
  const bin = (base) => join(base, 'claude', 'bin')
  /** A fake npm and binary: npm drops the shim, --version works once `works` is set. */
  const fake = (base, {npm = 0, works = true} = {}) => {
    const calls = []
    const run = (program, args) => {
      calls.push([program, ...args])
      if (args[0] === '/npm-cli.js')
        return (npm === 0 && touch(join(bin(base), 'claude')), {status: npm})
      if (String(args[0]).endsWith('install.cjs')) return ((works = true), {status: 0})
      return {status: works ? 0 : 1}
    }
    return {run, calls}
  }
  const ensure = (base, run, cli = '/npm-cli.js', said = []) =>
    withPath(temp(), () => ensureClaude(base, (key) => said.push(key), run, cli, 'linux'))

  it('leaves the person their own Claude Code', () => {
    const own = temp()
    touch(join(own, 'claude'))
    const result = withPath(own, () =>
      ensureClaude(temp(), assert.fail, assert.fail, '/npm-cli.js', 'linux'),
    )
    assert.deepEqual(result, {bin: null})
  })

  it('installs it with npm into the setup folder', () => {
    const base = temp()
    const {run, calls} = fake(base)
    const said = []
    assert.deepEqual(ensure(base, run, '/npm-cli.js', said), {bin: bin(base)})
    assert.deepEqual(said, ['claude'])
    assert.deepEqual(calls[0].slice(1, 5), ['/npm-cli.js', 'install', '-g', '--prefix'])
    assert.equal(calls[0].at(-1), '@anthropic-ai/claude-code')
  })

  it('runs the package installer itself where npm skipped it', () => {
    const base = temp()
    const {run, calls} = fake(base, {works: false})
    assert.deepEqual(ensure(base, run), {bin: bin(base)})
    const installer = calls.find((call) => String(call[1]).endsWith('install.cjs'))
    assert.ok(installer[1].includes(join('lib', 'node_modules', '@anthropic-ai', 'claude-code')))
  })

  it('updates its own copy on a new run, and keeps it when the update fails', () => {
    const base = temp()
    touch(join(bin(base), 'claude'))
    const said = []
    assert.deepEqual(ensure(base, fake(base).run, '/npm-cli.js', said), {bin: bin(base)})
    assert.deepEqual(said, ['claudeUpdate'])
    assert.deepEqual(ensure(base, fake(base, {npm: 1}).run), {bin: bin(base)})
    assert.deepEqual(ensure(base, assert.fail, null), {bin: bin(base)})
  })

  it('says why when it cannot install', () => {
    assert.deepEqual(ensure(temp(), fake(temp(), {npm: 1}).run), {stop: 'claudeFailed'})
    assert.deepEqual(ensure(temp(), assert.fail, null), {stop: 'noNpm'})
    const base = temp()
    const broken = fake(base, {works: false})
    const never = (program, args) =>
      String(args[0]).endsWith('install.cjs') ? {status: 1} : broken.run(program, args)
    assert.deepEqual(ensure(base, never), {stop: 'claudeFailed'})
  })
})

describe('fromCommand and fromSaved', () => {
  it('reads the gateway and token from the command or the link', () => {
    const want = {origin: 'https://gw.example', token: 'atr_A-b_1'}
    assert.deepEqual(fromCommand('curl -fsSL https://gw.example/i/atr_A-b_1 | sh'), want)
    assert.deepEqual(fromCommand('irm https://gw.example/i/atr_A-b_1/win | iex'), want)
    // As the bot sends them: the person's language after the token.
    assert.deepEqual(fromCommand('curl -fsSL https://gw.example/i/atr_A-b_1/en | sh'), want)
    assert.deepEqual(fromCommand('irm https://gw.example/i/atr_A-b_1/win/ru | iex'), want)
    assert.deepEqual(fromCommand('https://gw.example:8443/i/atr_1'), {
      origin: 'https://gw.example:8443',
      token: 'atr_1',
    })
    assert.equal(fromCommand('http://gw.example/i/atr_1'), null)
    assert.equal(fromCommand(''), null)
    assert.equal(fromCommand(undefined), null)
  })

  it('reads what an earlier run saved, https only', () => {
    const env = {
      ANTHROPIC_BASE_URL: 'https://gw.example',
      ANTHROPIC_CUSTOM_HEADERS: 'x-aitheroute-token: atr_9',
    }
    assert.deepEqual(fromSaved(env), {origin: 'https://gw.example', token: 'atr_9'})
    assert.equal(fromSaved({...env, ANTHROPIC_BASE_URL: 'http://gw.example'}), null)
    assert.equal(fromSaved({ANTHROPIC_BASE_URL: 'https://gw.example'}), null)
    assert.equal(fromSaved({}), null)
  })
})
