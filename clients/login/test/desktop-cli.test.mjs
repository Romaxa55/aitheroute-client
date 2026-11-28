import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {delimiter, join} from 'node:path'
import test from 'node:test'
import {cliEnvironment, openers, providerEnvironment, resolveCommand} from '../desktop-cli.mjs'
import {renderScreen} from '../screen/render.mjs'
import {words} from '../screen/view.mjs'

const temp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aitr-desktop-cli-'))
  t.after(() => rmSync(dir, {recursive: true, force: true}))
  return dir
}

test('a CLI is found on PATH; on Windows by PATHEXT, never an extensionless npm shim', async (t) => {
  const dir = temp(t)
  const [a, b] = ['a', 'b'].map((d) => join(dir, d))
  mkdirSync(a)
  mkdirSync(b)
  writeFileSync(join(a, 'tool'), '')
  writeFileSync(join(b, 'tool.CMD'), '')
  const env = {PATH: a + delimiter + b, PATHEXT: '.EXE;.CMD'}
  assert.equal(await resolveCommand('tool', env, 'win32'), join(b, 'tool.CMD'))
  chmodSync(join(a, 'tool'), 0o755)
  if (process.platform !== 'win32')
    assert.equal(await resolveCommand('tool', env, 'darwin'), join(a, 'tool'))
  await assert.rejects(resolveCommand('missing', env, 'darwin'), {code: 'STRICT_CLI_MISSING'})
  for (const bad of ['../tool', 'a b', '', 7])
    await assert.rejects(resolveCommand(bad, env), {code: 'STRICT_COMMAND'})
})

test('the Windows environment holds one spelling of each name, ours', () => {
  const base = {Path: 'C:\\bin', https_proxy: 'http://old:1', Home: 'C:\\Users\\me', Other: 'x'}
  const settings = {
    port: 5,
    origin: 'https://route.example.com',
    provider: 'gemini-cli',
    home: 'H',
    bin: 'B',
    browser: 'B\\browser.cmd',
    profileDir: 'P',
    exe: 'E',
  }
  const env = cliEnvironment(settings, base, 'win32')
  const upper = Object.keys(env).map((k) => k.toUpperCase())
  assert.equal(upper.length, new Set(upper).size)
  assert.equal(env.PATH, 'B' + delimiter + 'C:\\bin')
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:5')
  assert.equal(env.Home, 'C:\\Users\\me')
  assert.equal(env.Other, 'x')
  assert.equal(env.NO_BROWSER, 'true')
  assert.equal(env.GEMINI_CLI_HOME, 'H')
})

test('each provider keeps its sign-in under the private home by its own variable', () => {
  assert.deepEqual(Object.keys(providerEnvironment('anthropic', 'H')).sort(), [
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_CODE_FULL_SIGN_IN_LINK',
    'CLAUDE_CONFIG_DIR',
  ])
  assert.equal(providerEnvironment('chatgpt', 'H').CODEX_HOME, join('H', '.codex'))
  assert.equal(providerEnvironment('openai', 'H').CODEX_HOME, join('H', '.codex'))
  assert.deepEqual(providerEnvironment('gemini', 'H'), {GEMINI_CLI_HOME: 'H'})
  assert.deepEqual(providerEnvironment('nobody', 'H'), {})
})

test(
  'an opener sends an https link to the helper window and refuses an outside http one',
  {skip: process.platform === 'win32'},
  async (t) => {
    const dir = temp(t)
    const out = join(dir, 'args')
    const browser = join(dir, 'fake-browser')
    writeFileSync(browser, `#!/bin/sh\nprintf '%s\\n' "$@" > '${out}'\n`)
    chmodSync(browser, 0o755)
    const {bin, browser: shim} = await openers(dir, process.platform)
    const profile = join(dir, 'profile')
    const env = {
      ...process.env,
      AITR_LOGIN_PROFILE: profile,
      AITR_LOGIN_PORT: '4242',
      AITR_LOGIN_ORIGIN: 'https://route.example.com',
      AITR_LOGIN_BROWSER: browser,
    }
    // No browser of the helper's running (no profile lock): no new one.
    assert.equal(spawnSync(shim, ['https://claude.ai/'], {env}).status, 1)
    mkdirSync(profile)
    writeFileSync(join(profile, 'SingletonLock'), '')
    for (const opener of [shim, join(bin, 'open'), join(bin, 'xdg-open')]) {
      rmSync(out, {force: true})
      assert.equal(
        spawnSync(opener, ['--wait', 'https://claude.ai/oauth/authorize?x=1'], {env}).status,
        0,
      )
      for (let i = 0; i < 100 && !existsSync(out); i++) spawnSync('sleep', ['0.05'])
      const args = readFileSync(out, 'utf8').trim().split('\n')
      assert.equal(args.at(-1), 'https://claude.ai/oauth/authorize?x=1')
      assert.ok(args.includes('--proxy-server=http://127.0.0.1:4242'))
      rmSync(out, {force: true})
      spawnSync(opener, ['HTTPS://claude.ai/x'], {env})
      for (let i = 0; i < 100 && !existsSync(out); i++) spawnSync('sleep', ['0.05'])
      assert.equal(readFileSync(out, 'utf8').trim().split('\n').at(-1), 'HTTPS://claude.ai/x')
      rmSync(out, {force: true})
      assert.equal(spawnSync(opener, ['http://claude.ai/login'], {env}).status, 1)
      assert.ok(!existsSync(out))
    }
  },
)

test('the desktop screen says it has no isolation; the strict one is unchanged', async () => {
  const base = {state: 'ready', provider: 'anthropic', mode: 'browser', host: 'route.example.com'}
  const desktop = await renderScreen({...base, isolation: 'desktop'})
  const strict = await renderScreen(base)
  const [notice, isolated] = [words.desktop.notice, words.states.ready[2]]
  assert.ok(desktop.includes(notice) && !desktop.includes(isolated))
  assert.ok(strict.includes(isolated) && !strict.includes(notice))
  const preview = await renderScreen({...base, isolation: 'desktop', preview: true})
  assert.ok(!preview.includes(notice))
})
