import assert from 'node:assert/strict'
import {spawn, spawnSync} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createInterface} from 'node:readline'
import {setTimeout as delay} from 'node:timers/promises'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url))
const origin = 'https://127.0.0.1'
const code = 'test-only-pair-code'.repeat(2)

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'aitr-cli-profile-'))
  t.after(() => rm(base, {force: true, recursive: true}))
  // Exercise the real command parser and disk state without touching a desktop,
  // a user pairing or a live provider. The loopback origin also blocks launch.
  const hook = join(base, 'fixture.mjs')
  await writeFile(
    hook,
    [
      "import os from 'node:os'",
      "import {syncBuiltinESMExports} from 'node:module'",
      'os.homedir = () => process.env.AITR_FIXTURE_DIR',
      'syncBuiltinESMExports()',
      'globalThis.fetch = async (url, init) => {',
      "  if (url !== 'https://127.0.0.1/login/pair' || !JSON.parse(init.body).code) throw Error('unexpected request')",
      "  return Response.json({provider:'chatgpt',credential:'fixture-secret-'+process.env.AITR_FIXTURE_TOKEN,",
      '    tokenId:process.env.AITR_FIXTURE_TOKEN,expiresAt:Date.now()+3600000})',
      '}',
    ].join('\n'),
  )
  const cmd = ['--import', hook, cli]
  const env = {...process.env, AITR_FIXTURE_DIR: base}
  function run(args, token = 'tok_a') {
    const result = spawnSync(process.execPath, [...cmd, ...args], {
      env: {...env, AITR_FIXTURE_TOKEN: token},
      input: code,
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.ifError(result.error)
    assert.ok(!(result.stdout + result.stderr).includes(code))
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret-/)
    return result
  }
  return {base, cmd, env, run, record: join(base, '.aitheroute', 'login', 'chatgpt.json')}
}

test('CLI persists noninteractive decisions, retains a stable home and never prints secrets', async (t) => {
  const {run} = await fixture(t)
  const pair = (id) => run(['pair', origin], id)
  const profile = () => run(['profile', 'chatgpt'])
  assert.equal(pair('tok_a').status, 0)
  const first = profile()
  assert.equal(first.status, 0)
  assert.match(first.stdout.trim(), /[a-f0-9]{32}$/)
  assert.equal(pair('tok_a').status, 0)
  assert.equal(profile().stdout, first.stdout)
  const changed = pair('tok_b')
  assert.equal(changed.status, 2)
  for (const choice of ['reuse', 'clean'])
    assert.ok(changed.stderr.includes('select chatgpt ' + choice))
  assert.equal(profile().status, 1)
  assert.equal(run(['select', 'chatgpt', 'invalid']).status, 1)
  assert.equal(run(['select', 'chatgpt', 'reuse']).status, 0)
  assert.equal(profile().stdout, first.stdout)
  assert.equal(run(['select', 'chatgpt', 'clean']).status, 1)
  assert.equal(pair('tok_c').status, 2)
  assert.equal(run(['select', 'chatgpt', 'clean']).status, 0)
  assert.notEqual(profile().stdout, first.stdout)
})

test(
  'local profile screen checks origin and current pairing before accepting a decision',
  {
    skip: process.platform !== 'linux',
    timeout: 18000,
  },
  async (t) => {
    const {cmd, env, run, record} = await fixture(t)
    assert.equal(run(['pair', origin]).status, 0)
    assert.equal(run(['pair', origin], 'tok_b').status, 2)
    const child = spawn(process.execPath, [...cmd, 'open', 'chatgpt'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exit = once(child, 'exit')
    t.after(() => child.kill())
    const lines = createInterface({input: child.stdout})
    const [line] = await once(lines, 'line')
    const url = new URL(line.match(/http:\/\/127\.0\.0\.1:\d+\/\w+\//)[0])
    const post = (action, origin = url.origin) =>
      fetch(new URL(action, url), {
        method: 'POST',
        headers: {origin},
        redirect: 'manual',
      })
    const state = async () => JSON.parse(await readFile(record, 'utf8'))
    async function choice(except) {
      for (let i = 0; i < 75; i++) {
        const html = await (await fetch(url)).text()
        assert.doesNotMatch(html, /fixture-secret-|action="continue"/)
        const action = /action="(profile-clean-[a-f0-9]{32})"/.exec(html)?.[1]
        if (action && action !== except) return action
        await delay(40)
      }
      assert.fail('pending choice did not appear')
    }
    const stale = await choice()
    assert.equal((await post(stale, 'https://elsewhere.example')).status, 403)
    assert.equal((await fetch(new URL(stale, url))).status, 404)
    assert.equal((await post('profile-reuse-invalid')).status, 404)
    assert.equal((await post('continue')).status, 303)
    assert.equal((await state()).pendingProfileChoice, true)
    assert.equal(run(['pair', origin], 'tok_c').status, 2)
    assert.equal((await post(stale)).status, 303)
    const fresh = await choice(stale)
    const oldProfile = (await state()).profile
    assert.equal((await state()).pendingProfileChoice, true)
    assert.equal((await post(fresh)).status, 303)
    const selected = await state()
    assert.equal(selected.pendingProfileChoice, false)
    assert.notEqual(selected.profile, oldProfile)
    await post(fresh)
    assert.deepEqual(await state(), selected)
    await post('stop')
    assert.equal((await exit)[0], 130)
  },
)

test(
  'pair refuses a redirected private directory before storing a credential',
  {
    skip: process.platform === 'win32',
  },
  async (t) => {
    const {base, run} = await fixture(t)
    const outside = join(base, 'other')
    await mkdir(outside, {mode: 0o700})
    await symlink(outside, join(base, '.aitheroute'))
    assert.equal(run(['pair', origin]).status, 1)
    await assert.rejects(readFile(join(outside, 'login', 'chatgpt.json')), {code: 'ENOENT'})
  },
)
