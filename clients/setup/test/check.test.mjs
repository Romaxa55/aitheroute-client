import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {checkRequest, claudeCommand, cmdLine, x11} from '../steps.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'aitr-check-'))

describe('x11', {skip: process.platform === 'win32'}, () => {
  it('wants a local display with its socket and an X authority file, as the helper does', async () => {
    const sockets = temp()
    const home = temp()
    const server = createServer().listen(join(sockets, 'X7'))
    await once(server, 'listening')
    try {
      assert.equal(x11({DISPLAY: ':7'}, home, sockets), false)
      writeFileSync(join(home, '.Xauthority'), '')
      assert.equal(x11({DISPLAY: ':7'}, home, sockets), true)
      assert.equal(x11({DISPLAY: ':7.0'}, home, sockets), true)
      assert.equal(x11({DISPLAY: ':8'}, home, sockets), false)
      assert.equal(x11({DISPLAY: 'localhost:10.0'}, home, sockets), false)
      assert.equal(x11({}, home, sockets), false)
    } finally {
      server.close()
    }
  })
})

describe('claudeCommand and checkRequest', () => {
  it("starts npm's program itself on Windows, not its .cmd shim", () => {
    const prefix = temp()
    const exe = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    mkdirSync(join(exe, '..'), {recursive: true})
    writeFileSync(exe, '')
    assert.equal(claudeCommand(join(prefix, 'claude.cmd'), 'win32'), exe)
    assert.equal(claudeCommand(join(temp(), 'claude.cmd'), 'win32'), null)
    assert.equal(claudeCommand('C:\\bin\\claude.exe', 'win32'), 'C:\\bin\\claude.exe')
    assert.equal(claudeCommand('/usr/bin/claude', 'linux'), '/usr/bin/claude')
  })

  it('sends one request from the setup folder and reports how it went', () => {
    let seen
    const run = (program, args, options) => (
      (seen = {program, args, cwd: options.cwd}),
      {status: 0}
    )
    assert.equal(checkRequest('/b/claude', '/h/.aitheroute', run, 'linux'), true)
    assert.deepEqual(seen, {program: '/b/claude', args: ['-p', 'Hi'], cwd: '/h/.aitheroute'})
    assert.equal(
      checkRequest('/b/claude', '/h', () => ({status: 1}), 'linux'),
      false,
    )
    assert.equal(checkRequest(null, '/h', assert.fail, 'linux'), false)
  })

  it("starts a .cmd outside npm's layout through cmd.exe, every word quoted", () => {
    let seen
    const run = (program, args, options) => ((seen = {program, args, options}), {status: 0})
    const shim = 'C:\\Users\\Ivan Petrov\\scoop\\shims\\claude.cmd'
    assert.equal(
      checkRequest(shim, '/h', run, 'win32', {ComSpec: 'C:\\Windows\\system32\\cmd.exe'}),
      true,
    )
    assert.equal(seen.program, 'C:\\Windows\\system32\\cmd.exe')
    assert.deepEqual(seen.args, ['/d', '/s', '/c', '""' + shim + '" "-p" "Hi""'])
    assert.equal(seen.options.windowsVerbatimArguments, true)
    assert.equal(checkRequest('C:\\100%\\claude.cmd', '/h', assert.fail, 'win32', {}), false)
    assert.equal(cmdLine(['a"b']), null)
  })
})
