import {isIP} from 'node:net'
import {spawn} from 'node:child_process'
import {controlPage} from './control-page.mjs'
import {officialPage} from './desktop.mjs'
import {gate} from './gate.mjs'
import {hearInterrupts} from './interrupts.mjs'
import {renderScreen} from './screen/render.mjs'
import {loadSession, renewable, selectProfile} from './session.mjs'
import {strictSession} from './strict.mjs'
import {desktopSession} from './desktop-session.mjs'
import {openProxy} from './tunnel.mjs'

function openLocalStatus(url) {
  // This ordinary browser only receives a loopback URL. Provider navigation is
  // a separate action executed exclusively by the confined guest.
  const [program, ...args] =
    process.platform === 'win32'
      ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', url]
  const child = spawn(program, args, {stdio: 'ignore', detached: true})
  child.once('error', () => {}) // The terminal also displays the local address.
  child.unref()
}

// Linux keeps the namespaced session; macOS and Windows get the
// desktop one - the same tunnel and route check, without the isolation.
const desktop = ['darwin', 'win32'].includes(process.platform)

export async function launch(provider, command, consoleMode = false) {
  const page = officialPage(provider, consoleMode)
  const isolation = desktop ? 'desktop' : 'strict'
  const details = {provider, mode: command ? 'cli' : 'browser', host: '', isolation}
  const controller = gate(async (onFailure) => {
    delete details.choiceId
    if (process.platform !== 'linux' && !desktop)
      throw Object.assign(new Error(), {code: 'STRICT_PLATFORM'})
    let state
    try {
      state = await loadSession(provider)
    } catch (error) {
      if (error.code === 'LOGIN_PROFILE') {
        details.choiceId = error.choiceId
        details.host = new URL(error.origin).hostname
        throw error
      }
      throw Object.assign(new Error('Pair this provider first.'), {code: 'LOGIN_PAIR'})
    }
    details.host = new URL(state.origin).hostname
    if (!details.host.includes('.') || isIP(details.host) || details.host.endsWith('.'))
      throw Object.assign(new Error('Pair the DNS name from the bot.'), {code: 'STRICT_DEPENDENCY'})
    const lease = renewable(state)
    const proxy = await openProxy(state.origin, lease)
    try {
      const guest = await (desktop ? desktopSession : strictSession)({
        origin: state.origin,
        profile: state.profile,
        provider,
        proxy,
        page,
        command,
        onFailure: (error) => onFailure(typeof error === 'string' ? {code: error} : error),
      })
      return {
        check: async () => {
          await lease()
          await guest.check()
        },
        open: () => guest.open(),
        closed: guest.closed,
        close: async () => {
          proxy.stop()
          await guest.close()
        },
      }
    } catch (error) {
      proxy.stop()
      throw error
    }
  })

  const done = Promise.withResolvers()
  let finishedAt
  let exitTimer
  const exitSoon = () => {
    exitTimer ??= setTimeout(done.resolve, 3000)
  }
  const local = await controlPage(
    async () => {
      const status = controller.snapshot()
      if (status.state === 'finished') exitSoon()
      return renderScreen({...details, ...status, preview: false})
    },
    async (action) => {
      if (action.startsWith('profile-') && controller.snapshot().reason === 'profile') {
        const [, choice, id] = action.split('-')
        if (id === details.choiceId) {
          try {
            await selectProfile(provider, choice, undefined, id)
          } catch (error) {
            if (error.code !== 'STALE_CHOICE') throw error
          }
        }
        void controller.start().catch(() => done.resolve(1))
      }
      if (action === 'continue') void controller.continue().catch(() => done.resolve(1))
      if (action === 'retry') void controller.start().catch(() => done.resolve(1))
      if (action === 'stop') {
        await controller.stop(true)
        exitSoon()
      }
    },
  )
  // Ctrl+C, a closed terminal or a logout: the same as the stop button.
  const signals = hearInterrupts(() => done.resolve(130))
  try {
    console.log('AI The Route (local): ' + local.url)
    if (process.stdout.isTTY) openLocalStatus(local.url)
    void controller.start().catch(() => done.resolve(1))
    // Return the CLI exit status even if the host status tab was closed.
    const timer = setInterval(() => {
      if (controller.snapshot().state === 'finished') {
        finishedAt ??= Date.now()
        if (Date.now() - finishedAt > 30000) exitSoon()
      }
    }, 1000)
    try {
      return (await done.promise) ?? controller.exitCode()
    } finally {
      clearInterval(timer)
    }
  } finally {
    clearTimeout(exitTimer)
    signals.cleaning()
    local.close()
    try {
      await controller.stop()
    } finally {
      signals.done()
    }
  }
}
