import assert from 'node:assert/strict'
import {after, before, test} from 'node:test'
import {setTimeout as delay} from 'node:timers/promises'
import {strictSession} from '../strict.mjs'
import {gate} from '../gate.mjs'
import {controlPage} from '../control-page.mjs'
import {renderScreen} from '../screen/render.mjs'
import {controlBrowser} from './strict-linux-control.mjs'
import {officialPage} from '../desktop.mjs'
import {fixtureProxy} from './strict-linux-proxy.mjs'

const fixture = process.env.AITR_STRICT_TEST_FIXTURE
let chrome
before(async () => {
  if (fixture) chrome = await controlBrowser()
})
after(async () => {
  await chrome?.close()
})
const pages = [
  ['anthropic', 'https://claude.ai/login', false],
  ['anthropic', 'https://platform.claude.com/', true],
  ['openai', 'https://platform.openai.com/api-keys', false],
  ['chatgpt', 'https://chatgpt.com/auth/login', false],
  ['gemini', 'https://aistudio.google.com/apikey', false],
  ['gemini-cli', 'https://accounts.google.com/', false],
]
for (const [provider, page, consoleMode] of pages) {
  test(
    'Continue opens ' + page + ' through the isolated browser',
    {skip: !fixture, timeout: 60000},
    async (t) => {
      assert.equal(officialPage(provider, consoleMode), page)
      const url = new URL(page),
        peer = await fixtureProxy(fixture, url.hostname)
      t.after(() => peer.close())
      const monitor = gate(
        (onFailure) =>
          strictSession({
            origin: 'https://route.example',
            provider,
            page,
            proxy: peer.proxy,
            onFailure: (code) => onFailure({code}),
          }),
        {interval: 60000},
      )
      t.after(() => monitor.stop())
      assert.equal(await monitor.start(), true, JSON.stringify(monitor.snapshot()))
      assert.equal(monitor.snapshot().state, 'ready')
      assert.deepEqual(peer.targets, ['check.login.invalid:443', url.hostname + ':443'])
      assert.deepEqual(peer.pages, [])
      const activated = Promise.withResolvers()
      const local = await controlPage(
        () =>
          renderScreen({provider, host: 'route.example', mode: 'browser', ...monitor.snapshot()}),
        async (action) => {
          if (action === 'continue') activated.resolve(await monitor.continue())
        },
      )
      t.after(local.close)
      const closeTab = await chrome.pressContinue(local.url)
      t.after(closeTab)
      assert.equal(await activated.promise, true, JSON.stringify(monitor.snapshot()))
      const document = () =>
        peer.pages.find((p) => p.dest === 'document' && p.path === url.pathname)
      for (let i = 0; i < 200 && !document(); i++) await delay(50)
      assert.equal(document()?.host, url.hostname)
      assert.match(document()?.agent ?? '', /Chrom(e|ium)\//)
      await monitor.stop()
    },
  )
}
