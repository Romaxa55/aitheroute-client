import {errorReasons} from './strict/system.mjs'

const reasons = {
  ...errorReasons,
  LOGIN_PROFILE: 'profile',
  LOGIN_PAIR: 'pair',
  LOGIN_EXPIRED: 'expired',
  DESKTOP_BROWSER: 'desktopBrowser',
}

export function gate(create, {interval = 10000} = {}) {
  let view = {state: 'checking'}
  let generation = 0
  let session
  let heartbeat
  let pending
  let starting
  let clean = Promise.resolve()
  let verified = false
  let opening = false
  let code = 1
  const set = (state, reason) => {
    view = reason ? {state, reason} : {state}
  }

  async function end(state, reason) {
    generation++
    clearTimeout(heartbeat)
    const current = session
    session = undefined
    pending = undefined
    set(state, reason)
    if (current) clean = current.close()
    await clean
  }

  function failure(id, error) {
    if (id !== generation) return
    const state = verified ? 'disconnected' : 'blocked'
    const reason = Object.hasOwn(reasons, error?.code)
      ? reasons[error.code]
      : session
        ? 'gateway'
        : 'setup'
    return end(state, reason)
  }

  function probe() {
    const current = session
    if (!pending) {
      const promise = Promise.resolve()
        .then(() => current.check())
        .finally(() => {
          if (pending === promise) pending = undefined
        })
      pending = promise
    }
    return pending
  }

  function schedule(id) {
    clearTimeout(heartbeat)
    heartbeat = setTimeout(async () => {
      if (id !== generation || !['ready', 'active'].includes(view.state)) return
      try {
        await probe()
        if (id === generation && ['ready', 'active'].includes(view.state)) schedule(id)
      } catch (error) {
        await failure(id, error)
      }
    }, interval)
    heartbeat.unref()
  }

  async function initialize() {
    const id = ++generation
    verified = opening = false
    code = 1
    set('checking')
    try {
      await clean
      if (id !== generation) return false
      const current = await create((error) => failure(id, error))
      if (id !== generation) {
        await current.close()
        return false
      }
      session = current
      current.closed.then(
        async (status) => {
          if (id !== generation) return
          if (view.state !== 'active' && !opening) return failure(id, {code: 'STRICT_BROWSER'})
          code = Number.isInteger(status) ? status : 1
          await end('finished', code ? 'cli' : undefined)
        },
        (error) => failure(id, error),
      )
      await probe()
      if (id !== generation) return false
      verified = true
      set('ready')
      schedule(id)
      return true
    } catch (error) {
      await failure(id, error)
      return false
    }
  }

  async function proceed() {
    if (view.state !== 'ready') return false
    const id = generation
    clearTimeout(heartbeat)
    set('checking')
    try {
      if (pending) await pending
      if (id !== generation) return false
      await probe()
      if (id !== generation) return false
      opening = true
      await session.open()
      if (id !== generation) return false
      opening = false
      set('active')
      schedule(id)
      return true
    } catch (error) {
      await failure(id, error)
      return false
    }
  }

  return {
    start() {
      if (generation && !['blocked', 'disconnected'].includes(view.state))
        return Promise.resolve(false)
      starting = initialize()
      return starting
    },
    continue: proceed,
    async stop(cancel = false) {
      if (cancel && view.state !== 'finished') code = 130
      await end('finished')
      await starting
    },
    snapshot: () => ({...view}),
    exitCode: () => code,
  }
}
