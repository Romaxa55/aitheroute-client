import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import test from 'node:test'

const script = readFileSync(new URL('../screen/live.js', import.meta.url), 'utf8')

test('monitor preserves unchanged controls, removes a stale continue and recovers from the server', async () => {
  let current
  let next
  let scheduled
  let removed = false
  const node = (state) => ({
    dataset: {state, key: state},
    contains: (el) => Boolean(el && el.owner === state),
    querySelectorAll(selector) {
      assert.equal(selector, '.summary form')
      return [
        {
          remove() {
            removed = true
          },
        },
      ]
    },
    querySelector(selector) {
      if (selector === '.status') return {lastChild: {textContent: ''}}
      if (selector === 'h2')
        return {
          textContent: 'heading ' + state,
          focus: () => {
            document.activeElement = {owner: state}
          },
        }
      return nullField
    },
    replaceWith(other) {
      current = other
    },
  })
  const nullField = {textContent: '', remove() {}}
  current = node('ready')
  next = node('ready')
  const initial = current
  const listeners = new Map()
  const listen = (name, cb) => listeners.set(name, cb)
  const offline = {dataset: {status: 'offline', title: 'offline'}, textContent: 'unavailable'}
  const announcement = {textContent: ''}
  const document = {
    activeElement: {owner: 'ready'},
    addEventListener: listen,
    getElementById: (id) => ({offline, announcement, session: current})[id],
  }
  let fails = false
  const run = async () => {
    const callback = scheduled
    scheduled = undefined
    assert.ok(callback)
    await callback()
  }
  const location = {pathname: '/random/'}
  runInNewContext(script, {
    document,
    window: {addEventListener: listen},
    location,
    AbortSignal,
    async fetch(url, options) {
      assert.equal(url, location.pathname)
      assert.equal(options.redirect, 'error')
      if (fails) throw new Error('local controller unavailable')
      return {ok: true, text: async () => ''}
    },
    DOMParser: class {
      parseFromString() {
        return {querySelector: () => next}
      }
    },
    setTimeout(cb) {
      scheduled = cb
      return 1
    },
    clearTimeout() {},
  })
  await run()
  assert.equal(current, initial)
  fails = true
  await run()
  assert.equal(current.dataset.state, 'disconnected')
  assert.equal(removed, true)
  assert.match(announcement.textContent, /heading/)
  fails = false
  next = node('active')
  await run()
  assert.equal(current, next)
  next = node('finished')
  await run()
  assert.equal(current, next)
  assert.equal(scheduled, undefined)
})
