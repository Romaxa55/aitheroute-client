import assert from 'node:assert/strict'
import {test} from 'node:test'
import {gate} from '../gate.mjs'

function fixture() {
  let probes = 0
  let opens = 0
  let stops = 0
  const done = Promise.withResolvers()
  const session = {
    closed: done.promise,
    async check() {
      probes++
    },
    async open() {
      opens++
    },
    async close() {
      stops++
      done.resolve(1)
    },
  }
  const control = gate(async () => session, {interval: 1e7})
  return {control, session, done, counts: () => [probes, opens, stops]}
}

test('no vendor launch until isolation and a fresh check succeed; duplicate submits open once', async (t) => {
  const {control, counts} = fixture()
  t.after(control.stop)
  assert.equal(await control.continue(), false)
  await control.start()
  assert.equal(control.snapshot().state, 'ready')
  assert.deepEqual(counts(), [1, 0, 0])
  assert.deepEqual(await Promise.all([control.continue(), control.continue()]), [true, false])
  assert.deepEqual(counts(), [2, 1, 0])
  assert.equal(control.snapshot().state, 'active')
})

test('a stale green status cannot start a browser after the gateway goes down', async (t) => {
  const {control, session, counts} = fixture()
  t.after(control.stop)
  await control.start()
  session.check = async () => {
    throw new Error('private URL must never appear')
  }
  assert.equal(await control.continue(), false)
  assert.deepEqual(control.snapshot(), {state: 'disconnected', reason: 'gateway'})
  assert.deepEqual(counts(), [1, 0, 1])
})

test('unsupported system stays blocked; closing during startup disposes a late session', async () => {
  const control = gate(async () => {
    throw Object.assign(new Error(), {code: 'STRICT_PLATFORM'})
  })
  await control.start()
  assert.deepEqual(control.snapshot(), {state: 'blocked', reason: 'unsupported'})
  assert.equal(await control.continue(), false)
  await control.stop()
  const pending = Promise.withResolvers()
  const {session, counts} = fixture()
  const late = gate(() => pending.promise)
  const starting = late.start()
  await Promise.resolve() // let the pending constructor acquire its session
  let stopped = false
  const stopping = late.stop().then(() => {
    stopped = true
  })
  await Promise.resolve()
  assert.equal(stopped, false)
  pending.resolve(session)
  await Promise.all([stopping, starting])
  assert.equal(late.snapshot().state, 'finished')
  assert.deepEqual(counts(), [0, 0, 1])
})

test('losing an active tunnel closes the isolated session; retry checks again', async (t) => {
  const {session} = fixture()
  const next = fixture()
  let calls = 0
  const control = gate(async () => (++calls === 1 ? session : next.session), {interval: 10})
  t.after(control.stop)
  await control.start()
  await control.continue()
  session.check = async () => {
    throw new Error('expired')
  }
  const deadline = Date.now() + 1500
  while (control.snapshot().state === 'active' && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(control.snapshot().state, 'disconnected')
  await control.start()
  assert.equal(control.snapshot().state, 'ready')
})
