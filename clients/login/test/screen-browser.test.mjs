import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {test} from 'node:test'
import {controlPage} from '../control-page.mjs'
import {gate} from '../gate.mjs'
import {renderScreen} from '../screen/render.mjs'
import {words} from '../screen/view.mjs'

async function eventually(check) {
  const until = Date.now() + 8000
  while (Date.now() < until) {
    const result = await check()
    if (result) return result
    await delay(50)
  }
  throw new Error('Timed out waiting for test browser')
}

// Opt in with AITR_SCREEN_TEST_CHROMIUM=/usr/bin/chromium. This fixture uses
// a disposable headless profile, a loopback controller and no vendor account.
test(
  'keyboard and live status survive route loss, retry and controller loss',
  {
    skip: !process.env.AITR_SCREEN_TEST_CHROMIUM,
    timeout: 30000,
  },
  async (t) => {
    let failure,
      opens = 0
    const controller = gate(
      async () => ({
        closed: new Promise(() => {}),
        async check() {
          if (failure) throw Object.assign(new Error(), {code: failure})
        },
        async open() {
          opens++
        },
        async close() {},
      }),
      {interval: 50},
    )
    await controller.start()
    const model = {provider: 'chatgpt', host: 'example.org', mode: 'cli'}
    const state = () => renderScreen({...model, ...controller.snapshot()})
    const page = await controlPage(state, (action) => {
      if (action === 'retry') return controller.start()
      if (action === 'continue') return controller.continue()
      return controller.stop()
    })
    const profile = await mkdtemp(join(tmpdir(), 'aitr-screen-'))
    const browser = spawn(
      process.env.AITR_SCREEN_TEST_CHROMIUM,
      [
        '--headless',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--no-first-run',
        '--no-proxy-server',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1',
        '--user-data-dir=' + profile,
        page.url,
      ],
      {stdio: 'ignore'},
    )
    const ended = once(browser, 'exit')
    ended.catch(() => {})
    let ws
    t.after(async () => {
      ws?.close()
      if (browser.exitCode === null && browser.signalCode === null) browser.kill()
      await ended.catch(() => {})
      page.close()
      await controller.stop()
      await rm(profile, {recursive: true, force: true, maxRetries: 4, retryDelay: 100})
    })
    const port = await eventually(async () => {
      try {
        return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
    })
    const url = await eventually(async () => {
      const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
      return tabs.find((tab) => tab.url === page.url)?.webSocketDebuggerUrl
    })
    ws = new WebSocket(url)
    await once(ws, 'open')
    let id = 0
    const waiting = new Map()
    ws.addEventListener('message', ({data}) => {
      const frame = JSON.parse(data)
      if (waiting.has(frame.id)) {
        waiting.get(frame.id)(frame)
        waiting.delete(frame.id)
      }
    })
    async function evaluate(expression) {
      const key = ++id
      const response = new Promise((resolve) => waiting.set(key, resolve))
      ws.send(
        JSON.stringify({
          id: key,
          method: 'Runtime.evaluate',
          params: {expression, returnByValue: true},
        }),
      )
      const frame = await response
      assert.ok(!frame.error && !frame.result.exceptionDetails, expression)
      return frame.result.result.value
    }
    const find = (action) => 'document.querySelector("[data-action=' + action + ']")'
    const announcement = () => evaluate('document.getElementById("announcement").textContent')
    await eventually(() => evaluate('Boolean(' + find('continue') + ')'))
    await evaluate(find('continue') + '.focus()')
    failure = 'STRICT_PROVIDER_TLS'
    await eventually(() => evaluate('Boolean(' + find('retry') + ')'))
    assert.equal(await evaluate('document.activeElement.tagName'), 'H2')
    assert.ok((await announcement()).includes(words.reasons.providerTls))
    assert.equal(await evaluate('Boolean(' + find('continue') + ')'), false)
    assert.equal(opens, 0)

    failure = undefined
    await evaluate(find('retry') + '.click()')
    await eventually(() => evaluate('Boolean(' + find('continue') + ')'))
    await evaluate(find('stop') + '.focus()')
    failure = 'STRICT_GATEWAY_PROOF'
    await eventually(() => evaluate('Boolean(' + find('retry') + ')'))
    assert.equal(await evaluate('document.activeElement.dataset.action'), 'stop')
    assert.ok((await announcement()).includes(words.reasons.gatewayProof))

    await evaluate(find('retry') + '.focus()')
    page.close()
    await eventually(async () => (await announcement()).includes(words.offlineTitle))
    assert.equal(await evaluate('document.activeElement.tagName'), 'H2')
    assert.equal(await evaluate('Boolean(' + find('retry') + ')'), false)
  },
)
