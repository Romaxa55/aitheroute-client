import {spawnSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join, win32} from 'node:path'
import {fileURLToPath} from 'node:url'
import {claudeFlags, conflicts, dropOurs, settingsFile} from './claude-config.mjs'
import {loadLine, privateBase, rcFile, saveEnvironment} from './env.mjs'
import {hostsGuard} from './elevate.mjs'
import {guardKeep, guardOn, readGuard} from './guard.mjs'
import {guarded, hostsFile, readHosts, shadowed} from './hosts.mjs'
import {hostsLeft, writeHosts} from './hosts-write.mjs'
import {checkRequest, pairHelper, pairingCode, signInBlocker} from './steps.mjs'
import {askLine, askToken, runCaptured} from './token.mjs'
import {ensureClaude, which} from './tools.mjs'

/** The setup core's real steps; core.mjs only orders them, so tests swap these. */

const here = dirname(fileURLToPath(import.meta.url))
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (all, name) => vars[name] ?? all)
const without = (env, names) =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !names.test(name)))

// The sign-in runs as in a fresh terminal: no gateway, key or older sign-in of the person's.
export const signInEnv = (env) =>
  without(
    env,
    /^(ANTHROPIC_(BASE_URL|CUSTOM_HEADERS|API_KEY|AUTH_TOKEN)|CLAUDE_CODE_OAUTH_TOKEN)$/i,
  )
// `claude -p` always takes an API key over the sign-in: the checks are about the sign-in.
export const checkEnv = (env) => without(env, /^ANTHROPIC_API_KEY$/i)

/** The person's language: the first stage's choice, else the system's. */
export function language(
  env = process.env,
  locale = Intl.DateTimeFormat().resolvedOptions().locale,
) {
  if (['ru', 'en'].includes(env.AITR_LANG)) return env.AITR_LANG
  return locale.startsWith('ru') ? 'ru' : 'en'
}

/** The login helper's folder: beside setup/ in the unpacked archive, beside clients/setup in the repository. */
const helperDir = [join(here, '..', 'helper', 'clients', 'login'), join(here, '..', 'login')].find(
  (dir) => existsSync(join(dir, 'cli.mjs')),
)

/**
 * How the person runs the leak guard by hand. On Windows the full path, which
 * cmd and PowerShell both take as it is (neither reads the other's ~ or
 * %USERPROFILE%); through cmd /c when it has a space. Any other sign (& ( ) '
 * % $ ...) breaks cmd, and PowerShell runs a .cmd through cmd too: then Node
 * itself, quoted for PowerShell, where the setup runs.
 */
export function protectCommand(platform, base, node = process.execPath) {
  if (platform !== 'win32') return 'sh ~/.aitheroute/start.sh protect'
  const start = win32.join(base, 'start.cmd')
  if (/^[\p{L}\p{N}_.:\\~-]+$/u.test(start)) return `${start} protect`
  if (/^[\p{L}\p{N}_.:\\~ -]+$/u.test(start)) return `cmd /c "${start}" protect`
  const quote = (text) => `'${text.replaceAll("'", "''")}'`
  return `& ${quote(node)} ${quote(win32.join(base, 'setup', 'protect.mjs'))}`
}

export function defaults(env = process.env, platform = process.platform) {
  const words = JSON.parse(readFileSync(join(here, language(env) + '.json'), 'utf8'))
  const base = join(homedir(), '.aitheroute')
  const cli = helperDir && join(helperDir, 'cli.mjs')
  const hosts = hostsFile(platform, env)
  const d = {
    env,
    base,
    words,
    helper: cli,
    now: () => Date.now(),
    say: (key, vars) => console.log(fill(words[key], vars)),
    stop: (key, vars) => (console.error('AI The Route: ' + fill(words[key], vars)), 1),
    askLine: (question) => askLine(question),
    askToken: (question) => askToken(question),
    conflicts: (origin, guardedOrigin) =>
      conflicts(origin, env, settingsFile(env), guardedOrigin ?? readGuard(base)?.origin),
    prepare: () => privateBase(base),
    pairingCode: (origin, token) => pairingCode(origin, token),
    ensureClaude: (say) => ensureClaude(base, say),
    claudeFlags: () => claudeFlags(env),
    signInBlocker: () => signInBlocker(helperDir),
    pairHelper: (origin, code) => pairHelper(cli, origin, code),
    setupToken: () =>
      runCaptured(
        process.execPath,
        [cli, 'run', 'anthropic', '--', 'claude', 'setup-token'],
        process.platform,
        spawnSync,
        signInEnv(env),
      ),
    check: () => checkRequest(which('claude'), base, spawnSync, process.platform, checkEnv(env)),
    save: (vars, paths) => saveEnvironment(vars, paths),
    dropOurs: (keys) => dropOurs(keys, settingsFile(env)),
    settingsFile: settingsFile(env),
    rcLine: () => ({file: rcFile(), line: loadLine(join(base, 'env.sh'))}),
    // The leak guard (guard.mjs).
    platform,
    hostsFile: hosts,
    protectCommand: protectCommand(platform, base),
    writeHosts: (on) => writeHosts(on, hosts, platform),
    hostsOn: () => existsSync(hosts) && guarded(readHosts(hosts)),
    hostsLeft: () => hostsLeft(hosts),
    hostsShadowed: () => (existsSync(hosts) ? shadowed(readHosts(hosts)) : []),
    hostsGuard: (on) => hostsGuard(on, join(here, 'protect.mjs'), d),
    guard: () => readGuard(base),
    guardKeep: (origin) => guardKeep(d, origin),
    guardOn: (origin) => guardOn(d, origin),
  }
  return d
}
