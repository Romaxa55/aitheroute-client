import {officialPage} from '../desktop.mjs'
import {normalizeOrigin, providers} from '../session.mjs'
import {error} from './system.mjs'
import {existsSync, realpathSync} from 'node:fs'
import {writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const worker = fileURLToPath(new URL('.', import.meta.url))
const standard = ['/bin', '/sbin', '/lib', '/lib64']
const caFiles = [
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/ssl/cert.pem',
]

export async function localFiles(dir) {
  await writeFile(dir + '/hosts', '127.0.0.1 localhost\n::1 localhost\n', {mode: 0o600})
  await writeFile(
    dir + '/passwd',
    'route:x:' + process.getuid() + ':' + process.getgid() + ':Route:/home/route:/bin/sh\n',
    {mode: 0o600},
  )
}

export function baseMounts() {
  const args = [
    '--unshare-all',
    '--unshare-user',
    '--die-with-parent',
    '--new-session',
    '--cap-drop',
    'ALL',
    '--clearenv',
    '--ro-bind',
    '/usr',
    '/usr',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
  ]
  for (const path of standard.filter(existsSync)) args.push('--ro-bind', realpathSync(path), path)
  if (existsSync('/etc/fonts')) args.push('--ro-bind', '/etc/fonts', '/etc/fonts')
  return args
}

export function sandboxArgs({dir, display, home}) {
  const args = [
    ...baseMounts(),
    '--tmpfs',
    '/tmp',
    '--dir',
    '/run/route',
    '--dir',
    '/home',
    '--dir',
    '/tmp/.X11-unix',
    '--tmpfs',
    '/dev/shm',
    '--bind',
    home,
    '/home/route',
    '--chdir',
    '/home/route',
    '--ro-bind',
    dir + '/hosts',
    '/etc/hosts',
    '--ro-bind',
    dir + '/passwd',
    '/etc/passwd',
    '--ro-bind',
    worker,
    '/route',
    '--ro-bind',
    dir + '/auth',
    '/run/route/auth',
    '--ro-bind',
    dir + '/control',
    '/run/route/control',
    '--ro-bind',
    dir + '/bridge',
    '/run/route/bridge',
    '--ro-bind',
    dir + '/sockets/X' + display,
    '/tmp/.X11-unix/X' + display,
  ]
  for (const path of caFiles.filter(existsSync)) args.push('--ro-bind', realpathSync(path), path)
  for (const [key, value] of Object.entries({
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/home/route',
    LANG: 'C.UTF-8',
    NODE_USE_SYSTEM_CA: '1',
    DISPLAY: ':' + display,
    XAUTHORITY: '/run/route/auth',
    TMPDIR: '/tmp',
    XDG_RUNTIME_DIR: '/tmp/route-runtime',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/no-session-bus',
  }))
    args.push('--setenv', key, value)
  return [...args, '--', '/usr/bin/node', '/route/worker.mjs']
}

export function validate({origin, provider, page, proxy, command}) {
  try {
    if (
      !providers.includes(provider) ||
      typeof page !== 'string' ||
      normalizeOrigin(origin) !== origin ||
      ![
        officialPage(provider),
        ...(provider === 'anthropic' ? [officialPage(provider, true)] : []),
      ].includes(page)
    )
      throw Error()
    if (
      !Number.isInteger(proxy?.port) ||
      proxy.port < 1 ||
      proxy.port > 65535 ||
      typeof proxy.password !== 'string' ||
      !/^[0-9a-f]{32}$/.test(proxy.password)
    )
      throw Error()
    if (
      command != null &&
      (!Array.isArray(command) ||
        !command.length ||
        command.length > 256 ||
        command.some((x) => typeof x !== 'string' || x.includes('\0') || x.length > 32768))
    )
      throw Error()
  } catch {
    throw error('STRICT_COMMAND')
  }
}
