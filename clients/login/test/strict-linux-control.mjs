import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'

// This second browser operates the actual local status form. Only its
// loopback debugging port is exposed, inside the offline fixture desktop.
export async function controlBrowser() {
  const profile = await mkdtemp('/tmp/aitr-controls-')
  const browser = spawn(
    process.env.AITR_SCREEN_TEST_CHROMIUM,
    [
      '--headless',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-gpu',
      '--no-first-run',
      '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      'about:blank',
    ],
    {stdio: 'ignore'},
  )
  const exited = once(browser, 'exit')
  async function close() {
    if (browser.exitCode === null && browser.signalCode === null) browser.kill()
    await exited
    await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100})
  }
  try {
    let port
    const until = Date.now() + 30000
    while (!port && Date.now() < until) {
      try {
        port = Number((await readFile(profile + '/DevToolsActivePort', 'utf8')).split('\n')[0])
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (!port) await delay(100)
    }
    assert.ok(port, 'local status browser did not start')
    const base = 'http://127.0.0.1:' + port
    return {
      close,
      async pressContinue(url) {
        const tab = await (
          await fetch(base + '/json/new?' + encodeURIComponent(url), {method: 'PUT'})
        ).json()
        const ws = new WebSocket(tab.webSocketDebuggerUrl)
        try {
          await once(ws, 'open')
          const expression = `new Promise((resolve) => {
            const timer = setInterval(() => {
              const button = document.querySelector('button[data-action="continue"]')
              if (button) {clearInterval(timer); resolve(true); button.click()}
            }, 50)
          })`
          const result = once(ws, 'message')
          ws.send(
            JSON.stringify({
              id: 1,
              method: 'Runtime.evaluate',
              params: {expression, awaitPromise: true, returnByValue: true},
            }),
          )
          const [event] = await result
          const frame = JSON.parse(event.data)
          assert.equal(frame.result?.result?.value, true, JSON.stringify(frame))
        } finally {
          ws.close()
        }
        // Keep the tab alive until the real form POST has reached the controller.
        return () => fetch(base + '/json/close/' + tab.id)
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
