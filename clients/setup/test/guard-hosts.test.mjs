import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {hostsGuard} from '../elevate.mjs'
import * as g from '../guard.mjs'
import {guardDeps} from './guard-deps.mjs'

describe('the leak guard, its answers, rights and gateway', () => {
  it('reads yes in English and Russian, and nothing else', () => {
    for (const a of ['y', 'Yes', ' YES ', '\u0434', '\u0414\u0430']) assert.ok(g.yes(a), a)
    for (const a of ['', 'n', 'no', 'yep', null]) assert.ok(!g.yes(a), String(a))
  })

  it('writes the hosts file itself where it may, else through sudo or the elevation prompt', () => {
    const calls = []
    const sigint = process.listenerCount('SIGINT')
    const run = (command, args, opts) => {
      calls.push({command, args, env: opts.env, sigint: process.listenerCount('SIGINT')})
      return {status: 0}
    }
    const denied = (code) => () => {
      throw Object.assign(new Error(code), {code})
    }
    let on = false
    const base = {run, hostsOn: () => on, hostsLeft: () => on, platform: 'linux'}
    assert.equal(hostsGuard(false, 'protect.mjs', {...base, writeHosts: () => {}}), null)
    // The child ran, yet the file does not read back as asked.
    const refused = hostsGuard(true, 'protect.mjs', {...base, writeHosts: denied('EACCES')})
    assert.equal(refused, 'guardHostsRights')
    assert.deepEqual(calls[0].args, [process.execPath, 'protect.mjs', 'hosts', 'on'])
    assert.match(calls[0].command, /^(\/usr\/bin\/)?sudo$/)
    // Ctrl-C at the password prompt stops sudo, not this process; the listener goes after.
    assert.equal(calls[0].sigint, sigint + 1)
    assert.equal(process.listenerCount('SIGINT'), sigint)
    on = true
    const win = {...base, platform: 'win32', writeHosts: denied('EPERM')}
    assert.equal(hostsGuard(true, 'C:\\a b\\protect.mjs', win), null)
    assert.equal(calls[1].command, 'powershell.exe')
    assert.match(calls[1].args.at(-1), /-ArgumentList \$env:AITR_ARGLINE -Verb RunAs/)
    // One argument string (Windows PowerShell 5.1 would join an array's items into one).
    assert.equal(calls[1].env.AITR_ARGLINE, '"C:\\a b\\protect.mjs" hosts on')
    assert.equal(calls[1].env.AITR_NODE, process.execPath)
    // Not about rights: no elevation, and the reason.
    assert.equal(hostsGuard(false, 'x', {...base, writeHosts: denied('EIO')}), 'guardHostsRights')
    const utf16 = hostsGuard(true, 'x', {...base, writeHosts: denied('AITR_WIDE')})
    assert.equal(utf16, 'guardHostsEncoding')
    assert.equal(calls.length, 2)
  })

  it("finds the gateway: its own record, env.sh, then the shell's settings, https only", () => {
    const {d} = guardDeps()
    assert.equal(g.savedOrigin(d), null)
    d.env = {
      ANTHROPIC_BASE_URL: 'https://env.example',
      ANTHROPIC_CUSTOM_HEADERS: 'x-aitheroute-token: atr_1',
    }
    assert.equal(g.savedOrigin(d), 'https://env.example')
    // env.sh is the setup's latest, even for a terminal opened before it ran again.
    const sh = (url) =>
      writeFileSync(join(d.base, 'env.sh'), `export ANTHROPIC_BASE_URL='${url}'\n`)
    sh('https://sh.example/')
    assert.equal(g.savedOrigin(d), 'https://sh.example')
    sh('http://plain.example')
    assert.equal(g.savedOrigin(d), 'https://env.example')
    writeFileSync(
      join(d.base, 'guard.json'),
      JSON.stringify({origin: 'https://g.example', added: []}),
    )
    assert.equal(g.savedOrigin(d), 'https://g.example')
  })
})
