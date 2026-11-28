import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {mergeJson} from './claude-config.mjs'
import {fromSaved} from './tools.mjs'

/**
 * The leak guard, on and off at the person's choice. Two layers:
 * Claude Code's settings.json gets the gateway's address and the two traffic
 * flags, so a Claude Code session goes to the gateway even where the shell's
 * settings are not loaded (an editor started from the Dock, fish, cron), and
 * without our token header the gateway refuses it rather than it going
 * direct; then, with the administrator's consent, the hosts file closes
 * Anthropic's hosts to every program (hosts.mjs, elevate.mjs). ~/.aitheroute/guard.json
 * keeps what it set, so the setup puts it back when run again and off takes
 * out only that.
 */

export const FLAGS = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
}

// y, yes, and the Russian d, da.
export const yes = (answer) => /^(y|yes|\u0434|\u0434\u0430)$/iu.test(String(answer ?? '').trim())

const guardFile = (base) => join(base, 'guard.json')
export function readGuard(base) {
  try {
    const data = JSON.parse(readFileSync(guardFile(base), 'utf8'))
    return typeof data?.origin === 'string' && Array.isArray(data.added) ? data : null
  } catch {
    return null
  }
}
const writeGuard = (base, state) => writeFileSync(guardFile(base), JSON.stringify(state) + '\n')

/**
 * Puts the guard's values into settings.json's env, or takes out the ones it
 * added while they still hold its values. A flag the person set, to any value,
 * is theirs. The names it added, or null when the file is not a JSON object.
 */
export function guardSettings(on, origin, file, added = []) {
  if (!on && !existsSync(file)) return []
  const now = new Set(added)
  const done = mergeJson(file, (c) => {
    const env = c.env && typeof c.env === 'object' && !Array.isArray(c.env) ? c.env : {}
    for (const [name, value] of Object.entries({ANTHROPIC_BASE_URL: origin, ...FLAGS})) {
      const free = name === 'ANTHROPIC_BASE_URL' ? env[name] !== value : !(name in env)
      if (on && free) {
        env[name] = value
        now.add(name)
      } else if (!on && now.has(name) && env[name] === value) delete env[name]
    }
    if (Object.keys(env).length) c.env = env
    else delete c.env
  })
  return done ? (on ? [...now] : []) : null
}

const https = (url) => {
  const u = URL.parse(url ?? '')
  return u?.protocol === 'https:' ? u.origin : null
}

/**
 * The gateway the person set up: the guard's own record, then env.sh (the
 * setup's latest, even for a terminal opened before it ran again), then this
 * shell's settings. Only an https address counts.
 */
export function savedOrigin(d) {
  const file = join(d.base, 'env.sh')
  const sh =
    existsSync(file) && /^export ANTHROPIC_BASE_URL='([^']+)'/m.exec(readFileSync(file, 'utf8'))
  return https(readGuard(d.base)?.origin) ?? https(sh?.[1]) ?? fromSaved(d.env)?.origin ?? null
}

/** The settings layer again, for the gateway's current address: the setup run again calls it. */
export function guardKeep(d, origin) {
  const before = readGuard(d.base)
  const added = guardSettings(true, origin, d.settingsFile, before?.added)
  if (added) writeGuard(d.base, {origin, added, created: !!before?.created})
  return !!added
}

export async function guardOn(d, origin) {
  const before = readGuard(d.base)
  const created = before ? !!before.created : !existsSync(d.settingsFile)
  const added = guardSettings(true, origin, d.settingsFile, before?.added)
  if (!added) return d.stop('flagsFailed', {file: d.settingsFile})
  writeGuard(d.base, {origin, added, created})
  const vars = {off: d.protectCommand + ' off', file: d.hostsFile}
  if (!d.hostsOn()) {
    // A block cut short is finished without asking again: the person agreed to it before.
    if (!d.hostsLeft() && !yes(await d.askLine(d.words.guardHostsAsk)))
      return (d.say('guardSettingsOnly', vars), 0)
    const failed = d.hostsGuard(true)
    if (failed) return (d.say(failed, vars), 0)
  }
  d.say('guardOn', vars)
  return (shadows(d), 0)
}

/** Lines of the person's above the block that still send a guarded host elsewhere. */
function shadows(d) {
  const hosts = d.hostsOn() ? d.hostsShadowed() : []
  if (hosts.length) d.say('guardHostsShadowed', {file: d.hostsFile, hosts: hosts.join(', ')})
}

/** Both layers off; without the guard's record (the folder deleted), our gateway's address still goes. */
export function guardOff(d) {
  const origin = savedOrigin(d)
  const state = readGuard(d.base) ?? (origin && {origin, added: ['ANTHROPIC_BASE_URL']})
  if (state && !guardSettings(false, state.origin, d.settingsFile, state.added))
    return d.stop('flagsFailed', {file: d.settingsFile})
  const left = existsSync(d.settingsFile) && readFileSync(d.settingsFile, 'utf8').trim()
  if (state?.created && left === '{}') rmSync(d.settingsFile)
  rmSync(guardFile(d.base), {force: true})
  if (d.hostsLeft() && d.hostsGuard(false)) return d.stop('guardHostsLeft', {file: d.hostsFile})
  d.say('guardOff')
  return 0
}

const STATES = [
  ['guardIsOff', 'guardIsHostsOnly'],
  ['guardIsSettingsOnly', 'guardIsOn'],
]
export function guardStatus(d) {
  d.say(STATES[+!!readGuard(d.base)][+d.hostsOn()], {cmd: d.protectCommand, file: d.hostsFile})
  return (shadows(d), 0)
}
