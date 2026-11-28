import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {describe, it} from 'node:test'

/**
 * start.sh as the archive holds it: setup/ beside it. Run detached, so with no
 * controlling terminal: it copies itself to ~/.aitheroute, finds this Node.js
 * and stops where the questions would need a terminal - the same everywhere.
 */

import {SETUP, start, unpacked, words} from './unpacked.mjs'

describe('start.sh', {skip: process.platform === 'win32'}, () => {
  it('copies itself to ~/.aitheroute and asks for a terminal in the chosen language', async () => {
    const {status, stderr, home} = await start(unpacked(), {AITR_LANG: 'ru'})
    assert.equal(status, 1)
    assert.equal(stderr.trim(), 'AI The Route: ' + words('ru').tty)
    for (const part of [
      'start.sh',
      'start.cmd',
      'start.ps1',
      'README.md',
      'setup/core.mjs',
      'setup/en.json',
    ])
      assert.ok(existsSync(join(home, '.aitheroute', part)), part)
  })

  it('takes English from LANG and reads messages with quotes in them', async () => {
    const {stderr} = await start(unpacked(), {LANG: 'en_US.UTF-8'})
    assert.equal(stderr.trim(), 'AI The Route: ' + words('en').tty)
  })

  it('runs again from ~/.aitheroute itself', async () => {
    const first = await start(unpacked(), {AITR_LANG: 'en'})
    const again = spawnSync('sh', [join(first.home, '.aitheroute', 'start.sh')], {
      env: {HOME: first.home, PATH: dirname(process.execPath) + ':/usr/bin:/bin', AITR_LANG: 'en'},
      encoding: 'utf8',
      detached: true,
    })
    assert.equal(again.stderr.trim(), 'AI The Route: ' + words('en').tty)
  })

  it('leaves ~/.aitheroute private, so the real helper can pair in it (review B1)', async () => {
    const dir = unpacked()
    const home = mkdtempSync(join(tmpdir(), 'aitr-home-'))
    mkdirSync(join(home, '.aitheroute'), {mode: 0o755})
    chmodSync(join(home, '.aitheroute'), 0o755)
    const pair = () =>
      spawnSync(
        process.execPath,
        [
          join(home, '.aitheroute', 'helper', 'clients', 'login', 'cli.mjs'),
          'pair',
          'https://localhost:9',
        ],
        {
          env: {HOME: home, PATH: process.env.PATH},
          input: 'pair_' + 'x'.repeat(40) + '\n',
          encoding: 'utf8',
        },
      ).stderr
    cpSync(join(dir, 'helper'), join(home, '.aitheroute', 'helper'), {recursive: true})
    assert.match(pair(), /Invalid private profile directory/)
    spawnSync('sh', [join(dir, 'start.sh')], {
      env: {HOME: home, PATH: dirname(process.execPath) + ':/usr/bin:/bin', AITR_LANG: 'en'},
      detached: true,
    })
    assert.equal(statSync(join(home, '.aitheroute')).mode & 0o777, 0o700)
    const after = pair()
    assert.doesNotMatch(after, /Invalid private profile directory/)
    // Past the folder check, on to the network: the address above answers nothing.
    assert.match(after, /AI The Route: fetch failed/)
  })

  it('says so when the archive was not unpacked whole', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aitr-start-'))
    cpSync(join(SETUP, 'bundle', 'start.sh'), join(dir, 'start.sh'))
    const {status, stderr} = await start(dir, {AITR_LANG: 'en'})
    assert.equal(status, 1)
    assert.match(stderr, /setup\/core\.mjs is missing/)
  })
})
