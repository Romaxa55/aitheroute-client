import assert from 'node:assert/strict'
import {test} from 'node:test'
import {hearInterrupts, LASTING} from '../interrupts.mjs'

const count = () => ['SIGINT', ...LASTING].map((s) => process.listenerCount(s))
const hit = (signal) => process.emit(signal, signal)

test('a closed terminal and a logout stay heard until the cleanup is done', () => {
  const before = count()
  let heard = 0
  const signals = hearInterrupts(() => heard++)
  assert.deepEqual(count(), [before[0] + 1, before[1] + 1, before[2] + 1])
  // zsh hands SIGHUP on, the kernel sends it again; a logout adds SIGTERM.
  for (const signal of ['SIGHUP', 'SIGHUP', 'SIGTERM']) hit(signal)
  signals.cleaning()
  // While the browser and its profile go, a late one must still find a listener.
  assert.deepEqual(count(), [before[0], before[1] + 1, before[2] + 1])
  hit('SIGHUP')
  signals.done()
  assert.deepEqual(count(), before)
  assert.equal(heard, 4)
})

test('Ctrl+C is heard once, so a second one still ends the helper at once', () => {
  const before = process.listenerCount('SIGINT')
  let heard = 0
  const signals = hearInterrupts(() => heard++)
  hit('SIGINT')
  assert.equal(process.listenerCount('SIGINT'), before)
  signals.cleaning()
  signals.done()
  assert.equal(heard, 1)
})
