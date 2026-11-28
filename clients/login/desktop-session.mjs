import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {browserArgs, findBrowser} from './desktop.mjs'
import {cliEnvironment, openers, resolveCommand, spawnCli, vendorArgs} from './desktop-cli.mjs'
import {relay} from './desktop-relay.mjs'
import {privateHome} from './pair-store.mjs'
import {probe} from './strict/probe.mjs'
import {error} from './strict/system.mjs'

/**
 * Provider sign-in on macOS and Windows, which have no Linux
 * namespaces for strict.mjs. The same paired tunnel and route check; the
 * provider page opens in a separate Chrome or Edge profile that sends every
 * connection to the gateway, and the CLI runs with the proxy and the private
 * home. Other programs, and a link opened in the ordinary browser, keep their
 * own connection - the status screen says so. Same shape as strictSession.
 */
export async function desktopSession(options, deps = {}) {
  const {origin, provider, page, proxy, command} = options
  let exe
  try {
    exe = (deps.findBrowser ?? findBrowser)()
  } catch {
    throw error('DESKTOP_BROWSER')
  }
  const program = command ? await resolveCommand(command[0]) : null
  const route = deps.probe ?? probe
  const platform = deps.platform ?? process.platform
  const tasks = []
  const ended = Promise.withResolvers()
  let closing
  let started = false
  const close = (status = 0) => {
    closing ??= (async () => {
      for (const task of tasks.reverse())
        try {
          await task()
        } catch {}
      ended.resolve(status)
    })()
    return closing
  }
  // Wait for a child to end once it is told to; on Windows the whole tree.
  const supervise = (child, ms) => {
    const exited = new Promise((resolve) => {
      child.once('error', () => resolve(1))
      child.once('exit', (code) => resolve(code ?? 1))
    })
    const live = () => child.exitCode === null && child.signalCode === null && child.pid
    const stop = async () => {
      if (!live()) return
      if (platform === 'win32')
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'}).once(
          'error',
          () => child.kill(),
        )
      else child.kill()
      await Promise.race([exited, delay(ms, undefined, {ref: false})])
      if (live()) child.kill('SIGKILL')
    }
    tasks.push(stop)
    // Started while the session closes: its cleanup has already run.
    if (closing) void stop()
    return exited
  }
  try {
    const home = await privateHome(provider, options.profile)
    const dir = await mkdtemp(join(tmpdir(), 'aitr-desktop-'))
    tasks.push(() => rm(dir, {recursive: true, force: true, maxRetries: 5}))
    const local = await relay(proxy.port, proxy.password)
    tasks.push(() => local.stop())
    const profileDir = join(dir, 'browser')
    // The flag alone may not hold in a windowed Chrome: the profile's own
    // policy sends WebRTC through the proxy only, from the first page. Its
    // secure DNS would go to a built-in DNS-over-HTTPS server directly: off.
    await mkdir(join(profileDir, 'Default'), {recursive: true})
    const policy = {webrtc: {ip_handling_policy: 'disable_non_proxied_udp'}}
    await writeFile(join(profileDir, 'Default', 'Preferences'), JSON.stringify(policy))
    const dns = {dns_over_https: {mode: 'off'}}
    await writeFile(join(profileDir, 'Local State'), JSON.stringify(dns))
    const window = async (url) => {
      const child = spawn(exe, browserArgs(profileDir, local, origin, url), {stdio: 'ignore'})
      const exited = supervise(child, 5000)
      await once(child, 'spawn')
      // Wrapped: an async function would otherwise wait for the window to close.
      return {exited}
    }
    // While a CLI runs its window must stay: a link it prints goes there, and
    // one it opens after Chrome ended would start a Chrome nobody stops.
    // macOS keeps Chrome running with no window.
    const keep = async (n = 0) => {
      const {exited} = await window('about:blank')
      if (platform !== 'darwin' && n < 3)
        void exited.then(() => closing || keep(n + 1).catch(() => {}))
    }
    const start = async () => {
      if (!program) {
        const {exited} = await window(page)
        void exited.then((code) => close(code))
        return
      }
      await keep().catch(() => {
        throw error('STRICT_BROWSER')
      })
      const shims = await openers(dir, platform)
      if (closing) return
      const env = cliEnvironment(
        {port: local.port, origin, provider, home, profileDir, exe, ...shims},
        process.env,
        platform,
      )
      // In the private home, as the strict mode starts it.
      const cli = spawnCli(program, vendorArgs(program, command.slice(1)), env, platform, home)
      void supervise(cli, 3000).then((code) => close(code))
      await once(cli, 'spawn')
    }
    return {
      // Through the relay: the path the browser takes.
      check: () => route(local.port, proxy.password, new URL(page).hostname),
      async open() {
        if (started || closing) throw error('STRICT_PROXY')
        started = true
        try {
          await start()
        } catch (e) {
          await close(1)
          throw e?.code === 'STRICT_BROWSER'
            ? e
            : error(program ? 'STRICT_COMMAND' : 'STRICT_BROWSER')
        }
      },
      closed: ended.promise,
      close: () => close(),
    }
  } catch (e) {
    await close(1)
    throw error('STRICT_DEPENDENCY')
  }
}
