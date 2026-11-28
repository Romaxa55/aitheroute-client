import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {hostsLeft, undoFile, writeHosts} from '../hosts-write.mjs'
import {guarded, withGuard} from '../hosts.mjs'

const MAC = '##\n# Host Database\n##\n127.0.0.1\tlocalhost\n::1             localhost\n'

describe('writing the leak guard into the hosts file', () => {
  it('keeps any encoding but UTF-16 byte for byte, and leaves UTF-16 alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aitr-hosts-'))
    const run = () => {}
    for (const bytes of [
      Buffer.from('# \xcf\xf0\xe8\xed\xf2\xe5\xf0\n127.0.0.1 localhost\n', 'latin1'),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('# \u0437\u0434\u0435\u0441\u044c\r\n'),
      ]),
    ]) {
      const file = join(dir, 'hosts')
      writeFileSync(file, bytes)
      writeHosts(true, file, 'linux', run)
      assert.ok(readFileSync(file).subarray(0, bytes.length).equals(bytes))
      writeHosts(false, file, 'linux', run)
      assert.ok(readFileSync(file).equals(bytes))
    }
    const file = join(dir, 'hosts16')
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('127.0.0.1 a\r\n', 'utf16le'),
    ])
    writeFileSync(file, utf16)
    assert.throws(() => writeHosts(true, file, 'win32', run), {code: 'AITR_WIDE'})
    assert.ok(readFileSync(file).equals(utf16))
  })

  it('never empties the file first: appends, cuts the end, or writes over in place', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'aitr-hosts-')), 'hosts')
    writeFileSync(file, MAC)
    const ino = statSync(file).ino
    const calls = []
    const run = (command, args) => calls.push([command, ...args].join(' '))
    writeHosts(true, file, 'darwin', run)
    assert.ok(guarded(readFileSync(file, 'utf8')))
    assert.deepEqual(calls, ['dscacheutil -flushcache', 'killall -HUP mDNSResponder'])
    writeHosts(true, file, 'darwin', run)
    assert.equal(calls.length, 2, 'nothing to change, nothing written or flushed')
    writeHosts(false, file, 'win32', run)
    assert.equal(readFileSync(file, 'utf8'), MAC)
    // The block in the middle: written over, then cut.
    writeFileSync(file, withGuard(MAC, true) + '10.0.0.5 nas\n')
    writeHosts(false, file, 'linux', run)
    assert.equal(readFileSync(file, 'utf8'), MAC + '10.0.0.5 nas\n')
    assert.ok(!existsSync(undoFile(file)), 'the copy goes once written')
    assert.deepEqual(calls.slice(2), ['ipconfig /flushdns', 'resolvectl flush-caches'])
    assert.equal(statSync(file).ino, ino)
    assert.throws(() => writeHosts(true, join(file, 'none'), 'linux', run))
  })

  it('puts the old text back first when a write in place stopped midway', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'aitr-hosts-')), 'hosts')
    const text = withGuard(MAC, true) + '10.0.0.5 nas\n'
    const next = withGuard(text, false)
    // As a stop between writing over and cutting leaves it, with the copy beside.
    writeFileSync(file, next + text.slice(next.length), 'latin1')
    writeFileSync(undoFile(file), text, 'latin1')
    writeFileSync(undoFile(file) + '.tmp', 'half a copy')
    assert.ok(hostsLeft(file), 'off is called for it')
    const calls = []
    writeHosts(false, file, 'linux', (command) => calls.push(command))
    assert.equal(readFileSync(file, 'utf8'), MAC + '10.0.0.5 nas\n')
    assert.ok(!existsSync(undoFile(file)) && !existsSync(undoFile(file) + '.tmp'))
    assert.ok(!hostsLeft(file))
    assert.deepEqual(calls, ['resolvectl'])
    // Put back with nothing more to do still flushes the lookups once.
    writeFileSync(file, 'garbage', 'latin1')
    writeFileSync(undoFile(file), MAC, 'latin1')
    // No mark of ours in the file, only the copy: still something for off to finish.
    assert.ok(hostsLeft(file))
    writeHosts(false, file, 'linux', (command) => calls.push(command))
    assert.equal(readFileSync(file, 'utf8'), MAC)
    assert.equal(calls.length, 2)
  })
})
