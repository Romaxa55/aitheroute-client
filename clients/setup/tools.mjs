import {spawnSync} from 'node:child_process'
import {existsSync, statSync} from 'node:fs'
import {delimiter, dirname, join} from 'node:path'

/** A program by name on PATH (with PATHEXT on Windows), or null. */
export function which(name, env = process.env, platform = process.platform) {
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean))
    for (const ext of exts) {
      const path = join(dir, name + ext.toLowerCase())
      if (existsSync(path) && statSync(path).isFile()) return path
    }
  return null
}

/** npm's own script beside this Node.js: the portable layout, the Unix one, Debian's package. */
export function npmCli(node = process.execPath) {
  const tries = [
    join(dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    '/usr/share/nodejs/npm/bin/npm-cli.js',
  ]
  return tries.find((path) => existsSync(path)) ?? null
}

const QUIET = [
  '--no-fund',
  '--no-audit',
  '--no-update-notifier',
  '--progress=false',
  '--loglevel=error',
]

/**
 * Claude Code: the person's own if it is on PATH, else installed with npm into
 * ~/.aitheroute/claude, and brought up to date on every run (its own updater
 * is off with CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC). npm, not Anthropic's
 * installer: the npm registry answers where downloads.claude.ai refuses or
 * cannot be reached. Returns {bin} - the folder to put on PATH, null for the
 * person's own - or {stop} with the reason.
 */
export function ensureClaude(
  base,
  say,
  run = spawnSync,
  cli = npmCli(),
  platform = process.platform,
) {
  const prefix = join(base, 'claude')
  const bin = platform === 'win32' ? prefix : join(prefix, 'bin')
  const ours = which('claude', {...process.env, PATH: bin}, platform)
  if (!ours && which('claude', process.env, platform)) return {bin: null}
  if (!cli) return ours ? {bin} : {stop: 'noNpm'}
  say(ours ? 'claudeUpdate' : 'claude')
  const pkg = join(
    prefix,
    platform === 'win32' ? '' : 'lib',
    'node_modules',
    '@anthropic-ai',
    'claude-code',
  )
  const works = () =>
    run(join(pkg, 'bin', 'claude.exe'), ['--version'], {stdio: 'ignore'}).status === 0
  const args = [cli, 'install', '-g', '--prefix', prefix, ...QUIET, '@anthropic-ai/claude-code']
  // An update that fails keeps the copy that works.
  if (run(process.execPath, args, {stdio: 'inherit'}).status !== 0)
    return ours ? {bin} : {stop: 'claudeFailed'}
  // npm 12 skips install scripts: the package's own installer puts the native binary in place.
  if (!works()) run(process.execPath, [join(pkg, 'install.cjs')], {cwd: pkg, stdio: 'inherit'})
  return works() && which('claude', {...process.env, PATH: bin}, platform)
    ? {bin}
    : {stop: 'claudeFailed'}
}

/** The gateway and the token from the bot's command or link: `https://<gateway>/i/<token>`. */
export function fromCommand(text) {
  const found = /(https:\/\/[A-Za-z0-9.-]+(?::\d+)?)\/i\/([A-Za-z0-9_-]+)/.exec(text ?? '')
  return found ? {origin: found[1], token: found[2]} : null
}

/** What an earlier run saved: the gateway's address and the token in its header. */
export function fromSaved(env = process.env) {
  const token = /x-aitheroute-token:\s*([A-Za-z0-9_-]+)/.exec(env.ANTHROPIC_CUSTOM_HEADERS ?? '')
  const origin = URL.parse(env.ANTHROPIC_BASE_URL ?? '')
  return token && origin?.protocol === 'https:' ? {origin: origin.origin, token: token[1]} : null
}
