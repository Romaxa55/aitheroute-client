import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {describe, it} from 'node:test'
import {guarded, readHosts} from '../hosts.mjs'
import {start, unpacked, words} from './unpacked.mjs'

describe('start.sh protect', {skip: process.platform === 'win32'}, () => {
  it('runs the leak guard instead of the setup, without a terminal', async () => {
    const en = words('en')
    const cmd = 'sh ~/.aitheroute/start.sh protect'
    const status = await start(unpacked(), {AITR_LANG: 'en'}, ['protect', 'status'])
    assert.equal(status.status, 0)
    // Read from this machine's own hosts file, which the test never changes.
    const closed = existsSync('/etc/hosts') && guarded(readHosts('/etc/hosts'))
    const want = (closed ? en.guardIsHostsOnly : en.guardIsOff).replaceAll('{cmd}', cmd)
    assert.equal(status.stdout.trim(), want.replaceAll('{file}', '/etc/hosts'))
    const usage = await start(unpacked(), {AITR_LANG: 'en'}, ['protect'])
    assert.equal(usage.status, 2)
    assert.equal(usage.stdout.trim(), en.guardUsage.replaceAll('{cmd}', cmd))
    const early = await start(unpacked(), {AITR_LANG: 'en'}, ['protect', 'on'])
    assert.equal(early.status, 1)
    assert.equal(early.stderr.trim(), 'AI The Route: ' + en.guardNoSetup)
  })
})
