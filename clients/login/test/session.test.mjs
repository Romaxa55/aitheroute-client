import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {normalizeOrigin, pair, loadSession, renewable} from '../session.mjs'
import {browserArgs, childEnvironment, officialPage} from '../desktop.mjs'

test('pairs, saves privately, and renews an old session once for concurrent tunnels', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aitr-login-test-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const requests = []
  const call = async (url, options) => {
    requests.push([url, JSON.parse(options.body), options.redirect])
    return Response.json({
      provider: 'chatgpt',
      credential: 'private',
      expiresAt: requests.length === 1 ? 100 : Date.now() + 3600000,
    })
  }
  await pair('https://route.example', 'c'.repeat(32), root, call)
  const state = await loadSession('chatgpt', root)
  if (process.platform !== 'win32')
    assert.equal((await stat(join(root, 'chatgpt.json'))).mode & 0o777, 0o600)
  assert.ok(!(await readFile(join(root, 'chatgpt.json'), 'utf8')).includes('c'.repeat(32)))
  const lease = renewable(state, call)
  assert.deepEqual(await Promise.all([lease(), lease()]), ['private', 'private'])
  assert.deepEqual(requests, [
    ['https://route.example/login/pair', {code: 'c'.repeat(32)}, 'error'],
    ['https://route.example/login/renew', {credential: 'private'}, 'error'],
  ])
})

test('requires a TLS service origin and provider-native, loopback-only browser setup', () => {
  assert.throws(() => normalizeOrigin('http://example.com'))
  assert.throws(() => normalizeOrigin('https://trusted.example?token=leak'))
  assert.throws(() => normalizeOrigin('https://user@trusted.example'))
  assert.equal(officialPage('gemini'), 'https://aistudio.google.com/apikey')
  assert.notEqual(officialPage('gemini'), officialPage('gemini-cli'))
  const proxy = {port: 34567, password: 'private'}
  const args = browserArgs(
    '/private/profile',
    proxy,
    'https://route.example',
    officialPage('openai'),
  )
  assert.ok(args.includes('--proxy-server=http://127.0.0.1:34567'))
  assert.ok(args.includes('--user-data-dir=/private/profile'))
  assert.ok(args.every((s) => !s.includes('private@')))
  const env = childEnvironment(
    {NO_PROXY: '*', HTTPS_PROXY: 'http://old'},
    proxy,
    'https://route.example',
  )
  assert.ok(env.HTTPS_PROXY.includes('127.0.0.1:34567'))
  assert.ok(env.NO_PROXY.split(',').includes('localhost'))
  assert.ok(env.NO_PROXY.split(',').includes('route.example'))
  assert.ok(!env.NO_PROXY.includes('*'))
})
