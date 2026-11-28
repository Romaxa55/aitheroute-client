import {mkdtemp, readlink, rm} from 'node:fs/promises'
import {nestedDisplay} from './strict/display.mjs'
import {bridge, control, listen} from './strict/ipc.mjs'
import {localFiles, sandboxArgs, validate} from './strict/sandbox.mjs'
import {privateHome} from './pair-store.mjs'
import {checkDependencies, deadline, error, executable, supervised, wireCode} from './strict/system.mjs'

export async function strictSession(options) {
  validate(options)
  if (process.platform !== 'linux') throw error('STRICT_PLATFORM')
  const {provider, page, proxy, onFailure} = options
  const command = options.command
    ? [await executable(options.command[0]), ...options.command.slice(1)]
    : null
  await checkDependencies()
  const tasks = []
  const ended = Promise.withResolvers()
  let closing,
    constructing = true,
    reported = false
  function close(status = 0) {
    if (!closing)
      closing = Promise.resolve().then(async () => {
        for (const task of tasks.reverse())
          try {
            await task()
          } catch {}
        ended.resolve(status)
      })
    return closing
  }
  function failure(code) {
    if (!reported && !closing && !constructing) {
      reported = true
      try {
        onFailure?.(code)
      } catch {}
    }
  }
  const unexpected = (code) => {
    if (closing) return
    if (code !== 0) failure('STRICT_NETWORK')
    void close(code)
  }
  try {
    const home = await privateHome(provider, options.profile)
    const dir = await mkdtemp('/tmp/aitr-strict-')
    tasks.push(() => rm(dir, {recursive: true, force: true}))
    await localFiles(dir)
    const display = await nestedDisplay(dir)
    tasks.push(() => display.stop())
    // Bind only the socket files; the isolated CLI cannot open a host bus,
    // a desktop opener, another host loopback port or the ordinary home.
    const wire = control(close, () => unexpected(1))
    tasks.push(await listen(dir + '/bridge', bridge(proxy.port)))
    tasks.push(await listen(dir + '/control', wire.attach))
    const instance = supervised(
      '/usr/bin/bwrap',
      sandboxArgs({dir, display: display.number, home}),
      {
        env: {PATH: '/usr/bin:/bin'},
        stdio: ['inherit', 'inherit', 'inherit'],
      },
    )
    tasks.push(() => instance.stop())
    const crashed = Promise.race([display.exited, instance.exited]).then(() => {
      throw error('STRICT_BROWSER')
    })
    crashed.catch(() => {
      if (!constructing) unexpected(1)
    })
    const guard = (p, ms, code) => deadline(Promise.race([p, crashed]), ms, code)
    await guard(wire.ready, 10000, 'STRICT_NETWORK')
    await guard(
      wire.request({
        action: 'init',
        page,
        password: proxy.password,
        command,
        browser: '/usr/bin/chromium',
        hostNS: await readlink('/proc/self/ns/net'),
      }),
      15000,
      'STRICT_BROWSER',
    )
    constructing = false
    const run = async (action, ms, code) => {
      try {
        await guard(wire.request({action}), ms, code)
      } catch (e) {
        const reason = wireCode(e.code, code)
        failure(reason)
        await close(1)
        throw error(reason)
      }
    }
    return {
      check: () => run('check', 18000, 'STRICT_PROXY'),
      open: () => run('open', 8000, 'STRICT_BROWSER'),
      closed: ended.promise,
      close: () => close(),
    }
  } catch (e) {
    await close(1)
    throw error(
      /^STRICT_(COMMAND|DEPENDENCY|DISPLAY|NETWORK|BROWSER|PROXY)$/.test(e.code)
        ? e.code
        : 'STRICT_NETWORK',
    )
  }
}
