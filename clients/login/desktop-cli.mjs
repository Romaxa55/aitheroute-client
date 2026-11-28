import {spawn} from 'node:child_process'
import {constants} from 'node:fs'
import {access, mkdir, writeFile} from 'node:fs/promises'
import {delimiter, extname, isAbsolute, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {error} from './strict/system.mjs'

const opener = fileURLToPath(new URL('browser-open.mjs', import.meta.url))
const sh = (s) => "'" + s.replaceAll("'", "'\\''") + "'"
const key = (env, name) => Object.keys(env).find((k) => k.toUpperCase() === name) ?? name

/** A vendor CLI by name on PATH (with PATHEXT on Windows), or an absolute path. */
export async function resolveCommand(name, env = process.env, platform = process.platform) {
  if (
    typeof name !== 'string' ||
    !(isAbsolute(name) || /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/.test(name))
  )
    throw error('STRICT_COMMAND')
  const win = platform === 'win32'
  const pathext = (env[key(env, 'PATHEXT')] ?? '.EXE;.CMD;.BAT').split(';')
  const exts =
    win && !extname(name) ? pathext.filter((e) => /^\.(com|exe|bat|cmd)$/i.test(e)) : ['']
  const dirs = isAbsolute(name) ? [''] : (env[key(env, 'PATH')] ?? '').split(delimiter)
  for (const dir of dirs.filter((d, i) => d || (!i && isAbsolute(name))))
    for (const ext of exts.filter((e, i) => e || !i)) {
      const path = dir ? join(dir, name + ext) : name + ext
      try {
        await access(path, win ? constants.F_OK : constants.X_OK)
        return path
      } catch {}
    }
  throw error('STRICT_CLI_MISSING')
}

/**
 * Openers a CLI may call for its sign-in link: an https link goes to the
 * helper's browser window, a non-local http link is refused. Anything else (a
 * file, a local callback) goes to macOS's own `open`; `browser` and `xdg-open`
 * refuse it.
 */
export async function openers(dir, platform = process.platform) {
  const bin = join(dir, 'bin')
  await mkdir(bin, {mode: 0o700})
  if (platform === 'win32') {
    const browser = join(bin, 'browser.cmd')
    const cmd = (s) => '"' + s.replaceAll('%', '%%') + '"'
    await writeFile(browser, '@' + cmd(process.execPath) + ' ' + cmd(opener) + ' %*\r\n')
    return {bin, browser}
  }
  const node = sh(process.execPath) + ' ' + sh(opener)
  const route =
    'for a; do case "$a" in\n' +
    `  [hH][tT][tT][pP][sS]://*) exec ${node} "$a" ;;\n` +
    '  [hH][tT][tT][pP]://localhost[:/]* | [hH][tT][tT][pP]://127.0.0.1[:/]*) ;;\n' +
    '  [hH][tT][tT][pP]://*) exit 1 ;;\n' +
    'esac; done\n'
  const shim = (name, tail) =>
    writeFile(join(bin, name), '#!/bin/sh\n' + route + tail, {mode: 0o700})
  await shim('browser', 'exit 1\n')
  await shim('open', 'exec /usr/bin/open "$@"\n')
  await shim('xdg-open', 'exit 1\n')
  return {bin, browser: join(bin, 'browser')}
}

/**
 * Each CLI keeps its sign-in in the provider's private home through its own
 * variable, not HOME: the person's git and ssh setup stay as they are, and
 * Claude Code's macOS Keychain entry follows CLAUDE_CONFIG_DIR, so the
 * person's own Claude login is left alone. Gemini CLI prints its link
 * (NO_BROWSER); Claude Code prints the full one for pasting.
 */
export const providerEnvironment = (provider, home) =>
  ({
    anthropic: {
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CLAUDE_CODE_FULL_SIGN_IN_LINK: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    openai: {CODEX_HOME: join(home, '.codex')},
    chatgpt: {CODEX_HOME: join(home, '.codex')},
    gemini: {GEMINI_CLI_HOME: home},
    'gemini-cli': {GEMINI_CLI_HOME: home, NO_BROWSER: 'true'},
  })[provider] ?? {}

const INHERITED = ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'GEMINI_FORCE_ENCRYPTED_FILE_STORAGE']

/** The CLI's environment: the relay as its proxy, the gateway direct, the provider's home. */
export function cliEnvironment(settings, base = process.env, platform = process.platform) {
  const {port, origin, provider, home, bin, browser, profileDir, exe} = settings
  const local = 'http://127.0.0.1:' + port
  const bypass = ['localhost', '127.0.0.1', '::1', '[::1]', new URL(origin).hostname].join(',')
  const env = {...base}
  // Inherited, these would move the CLI's stored sign-in off the private home.
  for (const k of Object.keys(env)) if (INHERITED.includes(k.toUpperCase())) delete env[k]
  const path = env[key(env, 'PATH')] ?? ''
  const set = {
    PATH: bin + delimiter + path,
    BROWSER: browser,
    HTTPS_PROXY: local,
    HTTP_PROXY: local,
    ALL_PROXY: local,
    NO_PROXY: bypass,
    NODE_USE_ENV_PROXY: '1',
    AITR_LOGIN_PROFILE: profileDir,
    AITR_LOGIN_PORT: String(port),
    AITR_LOGIN_ORIGIN: origin,
    AITR_LOGIN_BROWSER: exe,
    ...providerEnvironment(provider, home),
  }
  for (const name of Object.keys(set)) {
    // Windows names are case-insensitive: one spelling each, ours.
    if (platform === 'win32')
      for (const k of Object.keys(env)) if (k.toUpperCase() === name) delete env[k]
    env[name] = set[name]
    if (platform !== 'win32' && /PROXY$/.test(name)) env[name.toLowerCase()] = set[name]
  }
  return env
}

/**
 * Codex goes around the proxy when a sign-in exchange through it fails
 * (system_proxy_fallback, on by default) or when told to follow the system's
 * proxy settings (respect_system_proxy): never here. -c outranks its config files.
 */
export const vendorArgs = (program, args) =>
  /^codex(\.(cmd|exe|bat))?$/i.test(program.split(/[\\/]/).pop())
    ? [
        '-c',
        'features.system_proxy_fallback=false',
        '-c',
        'features.respect_system_proxy=false',
        ...args,
      ]
    : args

/** cmd.exe parses a .cmd shim's line itself: every word quoted, none it would expand. */
export function windowsLine(program, args, comspec = 'cmd.exe') {
  const words = [program, ...args]
  // A trailing backslash would escape the closing quote.
  if (words.some((w) => /["%^&|<>!\r\n]|\\$/.test(w))) throw error('STRICT_COMMAND')
  return [comspec, ['/d', '/s', '/c', '"' + words.map((w) => '"' + w + '"').join(' ') + '"']]
}

export function spawnCli(program, args, env, platform = process.platform, cwd = undefined) {
  const options = {env, stdio: 'inherit', cwd}
  // A .cmd shim (npm on Windows) only runs through cmd.exe.
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(program)) return spawn(program, args, options)
  const [file, argv] = windowsLine(program, args, env[key(env, 'COMSPEC')])
  return spawn(file, argv, {...options, windowsVerbatimArguments: true})
}
