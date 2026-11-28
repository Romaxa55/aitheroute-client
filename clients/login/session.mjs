import {homedir} from 'node:os'
import {join} from 'node:path'

import {
  bindProfile,
  checkProvider,
  choiceId,
  applyChoice,
  profileState,
  readRecord,
  withPairLock,
  writeRecord,
} from './pair-store.mjs'

export {providers, checkProvider} from './pair-store.mjs'
export const defaultRoot = () => join(homedir(), '.aitheroute', 'login')

export const normalizeOrigin = (value) => {
  const u = new URL(value)
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw new Error('Enter the HTTPS origin of your AI The Route service.')
  return u.origin
}

function checked(value) {
  if (
    !value ||
    (value.tokenId !== undefined &&
      (typeof value.tokenId !== 'string' || !/^tok_[a-zA-Z0-9_-]{1,100}$/.test(value.tokenId))) ||
    typeof value.credential !== 'string' ||
    !value.credential ||
    !Number.isSafeInteger(value.expiresAt)
  )
    throw new Error('Invalid response from the login service.')
  return {
    provider: checkProvider(value.provider),
    ...(value.tokenId === undefined ? {} : {tokenId: value.tokenId}),
    credential: value.credential,
    expiresAt: value.expiresAt,
  }
}

async function post(origin, path, body, call) {
  const res = await call(origin + '/login/' + path, {
    method: 'POST',
    redirect: 'error',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403 || res.status === 410)
      throw Object.assign(
        new Error('Login access expired or was refused. Get a new pairing code from the bot.'),
        {code: 'LOGIN_EXPIRED'},
      )
    throw new Error('Login service returned HTTP ' + res.status)
  }
  return checked(await res.json())
}

export async function pairDevice(address, code, root = defaultRoot(), call = fetch) {
  const origin = normalizeOrigin(address)
  if (!code || code.length < 32 || code.length > 2048 || /\s/.test(code))
    throw new Error('Invalid pairing code.')
  return withPairLock(root, async () => {
    const next = {origin, ...(await post(origin, 'pair', {code}, call))}
    const state = bindProfile(await stored(root, next.provider, true), next)
    await writeRecord(root, state)
    return state
  })
}

export async function pair(...args) {
  return (await pairDevice(...args)).provider
}

async function stored(root, provider, repairing = false) {
  const state = await readRecord(
    root,
    provider,
    (data) => {
      if (data?.provider !== provider) throw new Error()
      return {origin: normalizeOrigin(data.origin), ...checked(data), ...profileState(data)}
    },
    repairing,
  )
  if (!state && !repairing) throw new Error('First pair this provider using the code from the bot.')
  return state
}

export async function loadSession(provider, root = defaultRoot()) {
  const state = await stored(root, checkProvider(provider))
  if (state.pendingProfileChoice)
    throw Object.assign(
      new Error(
        'Choose the provider profile using: node clients/login/cli.mjs select ' +
          provider +
          ' clean|reuse',
      ),
      {code: 'LOGIN_PROFILE', choiceId: choiceId(state.credential), origin: state.origin},
    )
  return state
}

export async function selectProfile(provider, choice, root = defaultRoot(), expected) {
  checkProvider(provider)
  if (!['clean', 'reuse'].includes(choice)) throw new Error('Choose clean or reuse.')
  return withPairLock(root, async () => {
    const state = await stored(root, provider)
    applyChoice(state, choice, expected)
    await writeRecord(root, state)
    return state
  })
}

// The service keeps the same credential across renewals. A stopped helper can
// renew its saved lease again, while the parent access and pairing remain valid.
export function renewable(state, call = fetch) {
  let pending
  return async () => {
    if (state.expiresAt - Date.now() < 120000) {
      pending ??= post(state.origin, 'renew', {credential: state.credential}, call)
        .then((next) => {
          if (
            next.provider !== state.provider ||
            (next.tokenId !== undefined &&
              state.tokenId !== undefined &&
              next.tokenId !== state.tokenId) ||
            next.credential !== state.credential ||
            next.expiresAt <= Date.now()
          )
            throw new Error('Login session changed. Pair this provider again.')
          state.expiresAt = next.expiresAt
        })
        .finally(() => {
          pending = undefined
        })
      await pending
    }
    return state.credential
  }
}
