import {createHash, randomBytes} from 'node:crypto'
import {lstat, mkdir, open, readFile, realpath, rename, rm} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {homedir} from 'node:os'

export const providers = ['anthropic', 'openai', 'chatgpt', 'gemini', 'gemini-cli']
export const checkProvider = (id) => {
  if (!providers.includes(id)) throw new Error('Select a provider: ' + providers.join(', '))
  return id
}

// A stale tab may only decide the specific pending pairing it displayed.
export const choiceId = (credential) =>
  createHash('sha256').update(credential).digest('hex').slice(0, 32)
export const newProfile = () => randomBytes(16).toString('hex')
export const validProfile = (profile) =>
  profile === 'legacy' || (typeof profile === 'string' && /^[a-f0-9]{32}$/.test(profile))

// A process-owned SQLite lock disappears on process death. Serialize from
// before the one-time code exchange to atomic publication of the JSON file.
// Readers keep using the existing private per-provider JSON format.
export async function withPairLock(root, action) {
  await pairingDirectory(root, true)
  const {DatabaseSync} = await import('node:sqlite')
  const db = new DatabaseSync(join(root, '.pair-lock.sqlite'))
  try {
    try {
      db.exec('BEGIN EXCLUSIVE')
    } catch (e) {
      if (e.errcode !== 5) throw e
      throw Object.assign(new Error('Another pairing is in progress. Try again.'), {
        code: 'PAIR_BUSY',
      })
    }
    return await action()
  } finally {
    db.close()
  }
}

export async function readRecord(root, provider, decode, repairing) {
  let text
  try {
    await pairingDirectory(root, false)
    text = await readFile(join(root, provider + '.json'), 'utf8')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    return undefined
  }
  try {
    return decode(JSON.parse(text))
  } catch {
    // Malformed records cannot authorize reuse. Never print fragments of their JSON.
    if (repairing) return undefined
    throw Object.assign(new Error('Invalid saved pairing. Pair this provider again.'), {
      code: 'INVALID_RECORD',
    })
  }
}

export function applyChoice(state, choice, expected) {
  if (
    !state.pendingProfileChoice ||
    (expected !== undefined && expected !== choiceId(state.credential))
  )
    throw Object.assign(
      new Error('The pending pairing changed. Check the current profile before selecting.'),
      {code: 'STALE_CHOICE'},
    )
  if (choice === 'clean') state.profile = newProfile()
  state.pendingProfileChoice = false
}

export async function writeRecord(root, state) {
  const dest = join(root, state.provider + '.json')
  const temp = dest + '.' + randomBytes(12).toString('hex')
  const file = await open(temp, 'wx', 0o600)
  try {
    try {
      await file.writeFile(JSON.stringify(state) + '\n')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temp, dest)
  } finally {
    await rm(temp, {force: true})
  }
}

export function profileState(record) {
  // Old records already have an established provider-wide home.
  const profile = record.profile === undefined ? 'legacy' : record.profile
  if (
    !validProfile(profile) ||
    (record.pendingProfileChoice !== undefined && typeof record.pendingProfileChoice !== 'boolean')
  )
    throw new Error('Invalid local profile. Check your saved pairing.')
  return {profile, pendingProfileChoice: record.pendingProfileChoice === true}
}

export function bindProfile(previous, next) {
  if (!previous) return {...next, profile: newProfile(), pendingProfileChoice: false}
  const same =
    next.tokenId !== undefined &&
    previous.tokenId === next.tokenId &&
    previous.origin === next.origin
  return {
    ...next,
    profile: previous.profile,
    pendingProfileChoice: !same || previous.pendingProfileChoice,
  }
}

export async function privateHome(provider, profile = 'legacy', base = homedir()) {
  checkProvider(provider)
  if (!validProfile(profile))
    throw Object.assign(new Error('Invalid profile location.'), {code: 'STRICT_COMMAND'})
  const parts = profile === 'legacy' ? ['strict', provider] : ['profiles', provider, profile]
  let dir = await realpath(base)
  for (const part of ['.aitheroute', ...parts]) {
    dir = join(dir, part)
    await privateDirectory(dir, true)
  }
  return dir
}

async function privateDirectory(dir, create) {
  if (create) await mkdir(dir, {recursive: true, mode: 0o700})
  const info = await lstat(dir)
  if (
    !info.isDirectory() ||
    (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))
  )
    throw Object.assign(new Error('Invalid private profile directory.'), {code: 'STRICT_COMMAND'})
}

async function pairingDirectory(root, create) {
  if (root === join(homedir(), '.aitheroute', 'login'))
    await privateDirectory(dirname(root), create)
  await privateDirectory(root, create)
}
