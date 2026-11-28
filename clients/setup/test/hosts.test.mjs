import assert from 'node:assert/strict'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {guarded, HOSTS, hostsFile, marked, shadowed, withGuard} from '../hosts.mjs'

const MAC = '##\n# Host Database\n##\n127.0.0.1\tlocalhost\n::1             localhost\n'

describe('the leak guard in the hosts file', () => {
  it('closes every host for IPv4 and IPv6 after a blank line, and opens them again exactly', () => {
    const on = withGuard(MAC, true)
    assert.ok(on.startsWith(MAC + '\n# >>> AI The Route leak guard >>>\n'))
    for (const host of HOSTS) {
      assert.ok(on.includes(`\n0.0.0.0 ${host}\n`), host)
      assert.ok(on.includes(`\n:: ${host}\n`), host)
    }
    assert.ok(on.endsWith('# <<< AI The Route leak guard <<<\n'))
    assert.ok(guarded(on) && !guarded(MAC))
    assert.equal(withGuard(on, true), on)
    assert.equal(withGuard(on, false), MAC)
    assert.equal(withGuard(MAC, false), MAC)
  })

  it("keeps Windows' line ends, and an empty file stays empty", () => {
    const win = MAC.replaceAll('\n', '\r\n')
    const on = withGuard(win, true)
    assert.ok(!on.replaceAll('\r\n', '').includes('\n'))
    assert.equal(withGuard(on, false), win)
    assert.equal(withGuard('', false), '')
    assert.equal(withGuard(withGuard('', true), false), '')
  })

  it("takes out only its own lines: the person's, and a block cut short by hand, stay", () => {
    const own = MAC + '0.0.0.0 claude.ai\n'
    assert.equal(withGuard(withGuard(own, true), false), own)
    const cut = withGuard(MAC, true).replace(/# <<< AI The Route leak guard <<<\n$/, '')
    const after = cut + '10.0.0.5 nas.local\n0.0.0.0 claude.ai\n'
    assert.equal(withGuard(after, false), MAC + '10.0.0.5 nas.local\n0.0.0.0 claude.ai\n')
    // A line of the person's written inside a whole block: ours all go, theirs stays.
    const inside = withGuard(MAC, true).replace('>>>\n', '>>>\n0.0.0.0 example.org\n')
    const opened = withGuard(inside, false)
    assert.equal(opened, MAC + '0.0.0.0 example.org\n')
    assert.ok(!guarded(opened) && !opened.includes('anthropic'))
  })

  it('counts only a whole block as on, and takes out any trace of one', () => {
    const on = withGuard(MAC, true)
    const cut = on.slice(0, on.indexOf(':: claude.ai'))
    assert.ok(!guarded(cut) && marked(cut) && marked(on) && !marked(MAC))
    assert.ok(guarded(withGuard(cut, true)))
    // A whole block with the person's lines after it stays where it is.
    assert.equal(withGuard(on + '10.0.0.5 nas\n', true), on + '10.0.0.5 nas\n')
    // An end mark on its own goes; a blank first line is the person's, not ours.
    assert.equal(withGuard('# <<< AI The Route leak guard <<<\n' + MAC, false), MAC)
    assert.equal(withGuard('\n' + withGuard('', true), false), '\n')
  })

  it("leaves the person's line ends and trailing blank lines as they were", () => {
    for (const text of ['a\r\nb\n', 'a\nb\r\n', 'a\n\n\n', 'printer'])
      assert.equal(withGuard(withGuard(text, true), false), text.endsWith('r') ? text + '\n' : text)
    assert.ok(withGuard('a\r\nb\n', true).startsWith('a\r\nb\n\r\n# >>>'))
    assert.equal(withGuard('printer', false), 'printer')
  })

  it('finds the file on each system', () => {
    assert.equal(hostsFile('darwin'), '/etc/hosts')
    assert.equal(hostsFile('linux'), '/etc/hosts')
    assert.equal(
      hostsFile('win32', {SystemRoot: 'D:\\Win'}),
      join('D:\\Win', 'System32', 'drivers', 'etc', 'hosts'),
    )
  })

  it('takes out what is left when the start mark is gone, and sees lines above it', () => {
    const on = withGuard(MAC, true)
    const START = '# >>> AI The Route leak guard >>>\n'
    assert.equal(withGuard(on.replace(START, ''), false), MAC)
    // Stopped between writing over in place and cutting: the start mark is overwritten.
    const text = on + '10.0.0.5 nas.local\n'
    const next = withGuard(text, false)
    const left = withGuard(next + text.slice(next.length), false)
    for (const host of HOSTS) assert.ok(!left.includes(`0.0.0.0 ${host}\n`), host)
    const mine = '1.2.3.4 Claude.ai www.claude.ai # mine\n# 5.6.7.8 api.anthropic.com\n'
    assert.deepEqual(shadowed(mine + on + '9.9.9.9 platform.claude.com\n'), [
      'claude.ai',
      'www.claude.ai',
    ])
    assert.deepEqual(shadowed(mine), [])
  })
})
