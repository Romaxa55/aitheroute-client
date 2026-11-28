import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {withPairLock} from '../pair-store.mjs'

test(
  'another process cannot consume a pairing; a killed client leaves no stale lock',
  {timeout: 5000},
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'aitr-pair-lock-'))
    t.after(() => rm(root, {force: true, recursive: true}))
    const entry = new URL('../pair-store.mjs', import.meta.url)
    const holder = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          'const {withPairLock} = await import(process.argv[1])',
          "await withPairLock(process.argv[2], () => {process.stdout.write('ready'); return new Promise(() => setInterval(() => {},1000))})",
        ].join('\n'),
        entry.href,
        root,
      ],
      {stdio: ['ignore', 'pipe', 'pipe']},
    )
    t.after(() => holder.kill())
    const exit = once(holder, 'exit')
    await once(holder.stdout, 'data')
    await assert.rejects(
      withPairLock(root, () => assert.fail('lock not exclusive')),
      {code: 'PAIR_BUSY'},
    )
    holder.kill('SIGKILL')
    await exit
    assert.equal(await withPairLock(root, () => 'recovered'), 'recovered')
  },
)
