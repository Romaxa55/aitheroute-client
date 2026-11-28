import {spawnSync} from 'node:child_process'
import {existsSync, lstatSync, realpathSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join} from 'node:path'
import {pathToFileURL} from 'node:url'

/** The setup's steps that talk to the gateway or start programs. */

const REASON = {410: 'gone', 429: 'tooMany'}

/**
 * A pairing code for this token. It also proves the token before anything is
 * installed: no answer or a 5xx is the network, any other refusal the token.
 */
export async function pairingCode(origin, token, request = fetch) {
  const res = await request(origin + '/login/install', {
    method: 'POST',
    headers: {'x-aitheroute-token': token},
    signal: AbortSignal.timeout(30000),
  }).catch(() => null)
  if (!res || res.status >= 500) return {stop: 'unreachable'}
  if (!res.ok) return {stop: REASON[res.status] ?? 'invalid'}
  const body = await res.json().catch(() => null)
  if (typeof body?.code !== 'string') return {stop: 'unreachable'}
  // A token for another provider pairs too; this setup is Claude Code's only.
  return body.provider && body.provider !== 'anthropic' ? {stop: 'notClaude'} : {code: body.code}
}

/** Pairs the login helper, the code on its stdin; a pairing seen before gets a fresh profile. */
export function pairHelper(helper, origin, code, run = spawnSync) {
  const stdio = ['pipe', 'inherit', 'inherit']
  let done = run(process.execPath, [helper, 'pair', origin], {input: code + '\n', stdio})
  if (done.status === 2)
    done = run(process.execPath, [helper, 'select', 'anthropic', 'clean'], {stdio})
  return done.status === 0
}

/**
 * Why the helper cannot open the sign-in here, or null. macOS and Windows need
 * Chrome or Edge; Linux runs it isolated, which needs its packages and a
 * Claude Code installed under /usr (docs/login-client.md).
 */
export async function signInBlocker(
  helperDir,
  platform = process.platform,
  env = process.env,
  display = x11,
) {
  const load = (name) => import(pathToFileURL(join(helperDir, name)).href)
  if (platform === 'linux') {
    const {checkDependencies, executable} = await load('strict/system.mjs')
    try {
      await checkDependencies()
      await executable('claude')
    } catch {
      return 'linuxSignIn'
    }
    return display(env) ? null : 'linuxSignIn'
  }
  try {
    ;(await load('desktop.mjs')).findBrowser(env)
    return null
  } catch {
    return 'noBrowser'
  }
}

/** The desktop the helper nests its session in, checked as it checks it (strict/display.mjs). */
export function x11(env = process.env, home = homedir(), sockets = '/tmp/.X11-unix') {
  const number = /^:(\d{1,5})(?:\.\d+)?$/.exec(env.DISPLAY ?? '')?.[1]
  try {
    const auth = realpathSync(env.XAUTHORITY || join(home, '.Xauthority'))
    return !!number && lstatSync(join(sockets, 'X' + number)).isSocket() && lstatSync(auth).isFile()
  } catch {
    return false
  }
}

/** cmd.exe's line for a .cmd shim, every word quoted and none it would expand (the helper's windowsLine). */
export const cmdLine = (words) =>
  words.some((word) => /["%^&|<>!\r\n]|\\$/.test(word))
    ? null
    : '"' + words.map((w) => '"' + w + '"').join(' ') + '"'

/** How to start claude: on Windows npm's .cmd shim is bypassed for the program it starts. */
export function claudeCommand(claude, platform = process.platform) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(claude)) return claude
  const exe = join(
    dirname(claude),
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe',
  )
  return existsSync(exe) ? exe : null
}

/**
 * One short request with the settings in this process. It runs in ~/.aitheroute,
 * not in whatever folder the command was started from: `claude -p` skips the
 * trust dialog, and a project's own .claude settings and hooks are not ours to run.
 */
export function checkRequest(
  claude,
  cwd,
  run = spawnSync,
  platform = process.platform,
  env = process.env,
) {
  if (!claude) return false
  const options = {cwd, env, stdio: ['ignore', 'ignore', 'inherit'], timeout: 180000}
  const program = claudeCommand(claude, platform)
  if (program) return run(program, ['-p', 'Hi'], options).status === 0
  // A .cmd outside npm's layout (nvm-windows, volta, scoop): through cmd.exe, quoted.
  const line = cmdLine([claude, '-p', 'Hi'])
  const shell = env.ComSpec || env.COMSPEC || 'cmd.exe'
  const verbatim = {...options, windowsVerbatimArguments: true}
  return !!line && run(shell, ['/d', '/s', '/c', line], verbatim).status === 0
}
