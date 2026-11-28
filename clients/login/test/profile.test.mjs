import assert from 'node:assert/strict'
import {mkdtemp, readFile, readdir, rm, stat, symlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {test} from 'node:test'
import {selectProfile, loadSession, pairDevice, renewable} from '../session.mjs'
import {choiceId, privateHome} from '../pair-store.mjs'

const one = 'https://first.example'
const two = 'https://second.example'
const tokenA = 'tok_a123'
const tokenB = 'tok_b456'
const code = 's'.repeat(32)
const provider = 'chatgpt'
const response = (credential, tokenId, id = provider) => ({
  provider: id,
  credential,
  tokenId,
  expiresAt: Date.now() + 3600000,
})
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'aitr-profiles-'))
  t.after(() => rm(base, {force: true, recursive: true}))
  const root = join(base, 'login')
  const save = (origin, credential, tokenId, id) =>
    pairDevice(origin, code, root, async () => Response.json(response(credential, tokenId, id)))
  return {root, base, save, file: join(root, provider + '.json')}
}
test('same parent survives rotation or renewal; another provider is isolated', async (t) => {
  const {root, base, save} = await fixture(t)
  const a = await save(one, 'credential-a', tokenA)
  assert.match(a.profile, /^[a-f0-9]{32}$/)
  const same = await save(one, 'credential-b', tokenA)
  assert.equal(same.profile, a.profile)
  const auth = await loadSession(provider, root)
  auth.expiresAt = Date.now()
  const lease = renewable(auth, async () => Response.json(response(auth.credential, tokenA)))
  await lease()
  assert.equal(auth.profile, a.profile)
  const other = await save(one, 'credential-c', tokenA, 'gemini')
  assert.notEqual(
    await privateHome(provider, a.profile, base),
    await privateHome('gemini', other.profile, base),
  )
})
test('changed provider token or origin with the same token id stays locked until selected', async (t) => {
  const {root, base, save, file} = await fixture(t)
  const first = await save(one, 'first', tokenA)
  const oldHome = await privateHome(provider, first.profile, base)
  await writeFile(join(oldHome, 'marker'), 'fixture')
  await save(one, 'second', tokenB)
  await assert.rejects(loadSession(provider, root), {code: 'LOGIN_PROFILE'})
  const pending = await save(one, 'second-again', tokenB)
  assert.ok(pending.pendingProfileChoice)
  await assert.rejects(selectProfile(provider, 'reuse', root, 'second'))
  await selectProfile(provider, 'reuse', root, choiceId(pending.credential))
  assert.equal((await loadSession(provider, root)).profile, first.profile)
  await save(two, 'third', tokenB)
  await assert.rejects(loadSession(provider, root), {code: 'LOGIN_PROFILE'})
  await assert.rejects(selectProfile(provider, 'other', root))
  await selectProfile(provider, 'clean', root)
  const fresh = await loadSession(provider, root)
  assert.notEqual(fresh.profile, first.profile)
  assert.deepEqual(await readdir(await privateHome(provider, fresh.profile, base)), [])
  assert.equal(await readFile(join(oldHome, 'marker'), 'utf8'), 'fixture')
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  await assert.rejects(selectProfile(provider, 'reuse', root))
})
test('legacy JSON and gateways without token IDs preserve existing data and ask before reuse', async (t) => {
  const {root, base, save, file} = await fixture(t)
  await save(one, 'fixture', tokenA)
  await writeFile(file, JSON.stringify({origin: one, ...response('old', undefined)}))
  assert.equal((await loadSession(provider, root)).profile, 'legacy')
  assert.equal(
    await privateHome(provider, 'legacy', base),
    join(base, '.aitheroute', 'strict', provider),
  )
  await save(one, 'new-credential', undefined)
  await assert.rejects(loadSession(provider, root), {code: 'LOGIN_PROFILE'})
  await selectProfile(provider, 'reuse', root)
  assert.equal((await loadSession(provider, root)).profile, 'legacy')
  await save(one, 'another-credential', undefined)
  await assert.rejects(loadSession(provider, root), {code: 'LOGIN_PROFILE'})
})
test('malformed local state or server identifiers cannot choose or resolve an arbitrary home', async (t) => {
  const {root, base, save, file} = await fixture(t)
  await save(one, 'fixture', tokenA)
  const original = await readFile(file, 'utf8')
  for (const profile of ['../outside', null, '', true]) {
    await writeFile(file, JSON.stringify({...JSON.parse(original), profile}))
    await assert.rejects(loadSession(provider, root))
    await assert.rejects(privateHome(provider, profile, base))
  }
  await writeFile(file, original)
  await assert.rejects(save(one, 'fixture', '../../wrong'))
  assert.equal(await readFile(file, 'utf8'), original)
  const path = await privateHome(provider, 'a'.repeat(32), base)
  await symlink(path, join(path, '..', 'b'.repeat(32)))
  await assert.rejects(privateHome(provider, 'b'.repeat(32), base))
})
test('concurrent pairing is refused before consuming a second code and recovers after failure', async (t) => {
  const {root, save} = await fixture(t)
  const running = Promise.withResolvers(),
    release = Promise.withResolvers()
  const ongoing = pairDevice(one, code, root, async () => {
    running.resolve()
    await release.promise
    throw new Error('offline')
  })
  await running.promise
  let called = false
  await assert.rejects(
    pairDevice(two, code, root, async () => {
      called = true
    }),
    {code: 'PAIR_BUSY'},
  )
  assert.equal(called, false)
  release.resolve()
  await assert.rejects(ongoing, /offline/)
  assert.equal((await save(one, 'recovery', tokenA)).provider, provider)
})
test('a damaged record never exposes its contents; re-pairing selects a new empty home', async (t) => {
  const {root, save, file} = await fixture(t)
  const first = await save(one, 'first-credential', tokenA)
  for (const damaged of ['local-secret-invalid-json', '{"profile":"../../wrong"}']) {
    await writeFile(file, damaged)
    await assert.rejects(
      loadSession(provider, root),
      (error) => error.code === 'INVALID_RECORD' && !error.message.includes(damaged),
    )
    const repaired = await save(one, 'recovered', tokenA)
    assert.notEqual(repaired.profile, first.profile)
    assert.equal((await loadSession(provider, root)).pendingProfileChoice, false)
  }
})

test('a renewal for another parent is rejected without extending the lease', async (t) => {
  const {save} = await fixture(t)
  const state = await save(one, 'saved-credential', tokenA)
  state.expiresAt = 1
  const lease = renewable(state, async () => Response.json(response(state.credential, tokenB)))
  await assert.rejects(lease(), /session changed/)
  assert.equal(state.expiresAt, 1)
})
