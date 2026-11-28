import assert from 'node:assert/strict'
import test from 'node:test'
import {renderScreen} from '../screen/render.mjs'
import {words} from '../screen/view.mjs'

const render = (changes = {}) => renderScreen({
  state: 'ready', provider: 'anthropic', mode: 'browser', host: 'route.example.com', ...changes,
})
const control = (html, action) => new RegExp('<form method="post" action="' + action + '">').test(html)

test('the live route shows only actions possible in the reported state', async () => {
  for (const state of ['checking', 'ready', 'blocked', 'unsupported', 'disconnected', 'active', 'finished']) {
    const html = await render({state, reason: state === 'unsupported' ? 'unsupported' : undefined})
    assert.equal(control(html, 'continue'), state === 'ready', state)
    assert.equal(control(html, 'retry'), state === 'blocked' || state === 'disconnected', state)
    assert.ok(control(html, 'stop'), state)
    assert.doesNotMatch(html, /<select|https?:\/\//)
    assert.match(html, /name="viewport"/)
  }
})

test('invalid runtime values fail closed and arbitrary text does not enter the page', async () => {
  const attack = '</script><img src=x onerror=alert(1)>'
  for (const changes of [{state: attack}, {provider: attack}, {mode: attack}]) {
    const html = await render(changes)
    assert.equal(control(html, 'continue'), false)
    assert.ok(!html.includes(attack))
  }
  const html = await render({host: attack, reason: attack})
  assert.ok(!html.includes(attack))
  assert.ok(!(await render({host: 'password@host.example'})).includes('password@'))
})

test('only known providers, known reasons and selected mode affect live content', async () => {
  assert.notEqual(await render({mode: 'cli'}), await render())
  for (const provider of ['anthropic', 'openai', 'chatgpt', 'gemini', 'gemini-cli']) {
    assert.match(await render({provider}), new RegExp('data-provider="' + provider + '"'))
  }
  const reasons = ['unsupported', 'pair', 'setup', 'isolation', 'gateway', 'expired', 'display', 'closed', 'cli']
  const screens = await Promise.all(reasons.map((reason) => render({state: 'blocked', reason})))
  assert.equal(new Set(screens).size, reasons.length)
})

test('preview keeps every action offline and ignores the actual configured gateway', async () => {
  const html = await render({preview: true})
  assert.match(html, /<select id="demo-state"/)
  assert.match(html, /<select id="demo-provider"/)
  assert.match(html, /<select id="demo-reason"/)
  assert.match(html, /<details open>/)
  assert.match(html, /example\.com/)
  assert.doesNotMatch(html, /route\.example\.com|<form|https?:\/\/|fetch\(/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /form-action 'none'/)
  for (const state of ['ready', 'checking', 'blocked', 'unsupported', 'active', 'disconnected', 'finished']) {
    assert.match(html, new RegExp('<template id="scene-' + state + '"'))
  }
})

test('loss of the local controller has a distinct title and label from a gateway disconnect', async () => {
  const html = await render({state: 'disconnected'})
  const [, status, title] = /id="offline" hidden data-status="([^"]+)" data-title="([^"]+)"/.exec(html)
  const [, upstreamStatus] = /<span class="status"><i aria-hidden="true"><\/i>([^<]+)/.exec(html)
  const [, upstreamTitle] = /<h2[^>]*>([^<]+)<\/h2>/.exec(html)
  assert.notEqual(status, upstreamStatus)
  assert.notEqual(title, upstreamTitle)
})

test('live forms retain the same-origin POST origin while offline previews withhold referrers', async () => {
  for (const [preview, expected] of [[false, 'same-origin'], [true, 'no-referrer']]) {
    const html = await render({preview})
    assert.equal(/<meta name="referrer" content="([^"]+)">/.exec(html)[1], expected)
  }
})

test('live changes can be announced outside the replaced view and focus the new heading', async () => {
  const html = await render()
  assert.match(html, /<h2 tabindex="-1">/)
  const mainEnd = html.indexOf('</main>')
  assert.ok(html.indexOf('id="announcement"', mainEnd) > mainEnd)
  assert.match(html, /id="announcement"[^>]*role="status"[^>]*aria-atomic="true"/)
})

test('Claude: a setup-token sign-in needs no helper later; other CLIs refresh through it', async () => {
  for (const [isolation, w] of [[undefined, words], ['desktop', {...words, ...words.desktop}]]) {
    const claude = await render({isolation})
    assert.ok(claude.includes(w.refreshClaude) && claude.includes('setup-token'), String(isolation))
    assert.ok(!claude.includes(w.refresh), String(isolation))
    assert.ok((await render({isolation, provider: 'chatgpt'})).includes(w.refresh), String(isolation))
  }
})
