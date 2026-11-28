import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {pathToFileURL} from 'node:url'
import {promisify} from 'node:util'
import {renderScreen} from '../screen/render.mjs'
test('profile decisions require a live pending choice and never offer registration', async () => {
  const model = {
    state: 'blocked',
    provider: 'chatgpt',
    host: 'route.example',
    mode: 'browser',
    reason: 'profile',
  }
  const id = 'a'.repeat(32)
  const page = await renderScreen({...model, choiceId: id})
  for (const action of ['clean', 'reuse'])
    assert.ok(page.includes('action="profile-' + action + '-' + id + '"'))
  assert.ok(!page.includes('action="continue"'))
  for (const choiceId of [undefined, '<bad>', 'A'.repeat(32)]) {
    assert.doesNotMatch(await renderScreen({...model, choiceId}), /action="profile-/)
  }
  assert.doesNotMatch(
    await renderScreen({...model, state: 'ready', choiceId: id}),
    /action="profile-/,
  )
  const demo = await renderScreen({...model, preview: true, choiceId: id})
  assert.ok(demo.includes('scene-profile'))
  assert.ok(!demo.includes(id) && !demo.includes('<form'))
})

test(
  'profile choices use the blocked preview state even after a disconnection',
  {
    skip: !process.env.AITR_SCREEN_TEST_CHROMIUM,
    timeout: 18000,
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'aitr-profile-preview-'))
    t.after(() => rm(root, {force: true, recursive: true, maxRetries: 4, retryDelay: 100}))
    const model = {state: 'ready', provider: 'chatgpt', host: '', mode: 'browser', preview: true}
    // The child runs the actual preview with its own production CSP and assets.
    const frame = JSON.stringify(await renderScreen(model)).replaceAll('<', '\\u003c')
    const html = `<iframe></iframe><script>
    const frame = document.querySelector('iframe')
    frame.addEventListener('load', () => {
      const child = frame.contentDocument
      const field = id => child.querySelector('#demo-' + id)
      function select(id, value) {
        field(id).value = value
        field(id).dispatchEvent(new Event('change'))
      }
      select('state', 'disconnected')
      select('reason', 'profile')
      document.body.dataset.choice = field('state').value + '/' + child.querySelector('main').dataset.state
      const button = child.querySelector('main [data-action="profile-clean"]')
      button.focus()
      button.click()
      document.body.dataset.applied = child.querySelector('main').dataset.state
    }, {once:true})
    frame.srcdoc = ${frame}
  </script>`
    const harness = join(root, 'test.html')
    await writeFile(harness, html)
    const result = await promisify(execFile)(
      process.env.AITR_SCREEN_TEST_CHROMIUM,
      [
        '--headless',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--disable-gpu',
        '--no-first-run',
        '--host-resolver-rules=MAP * ~NOTFOUND',
        '--user-data-dir=' + join(root, 'chromium'),
        '--virtual-time-budget=1500',
        '--dump-dom',
        pathToFileURL(harness).href,
      ],
      {timeout: 12000},
    )
    assert.match(result.stdout, /data-choice="blocked\/blocked"/)
    assert.match(result.stdout, /data-applied="checking"/)
  },
)
