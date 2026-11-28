import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join} from 'node:path'

/**
 * Claude Code's own files: two flags the setup sets, and what in
 * them or in the shell would quietly override the gateway. Claude Code takes
 * credentials in this order (code.claude.com/docs/en/iam): Bedrock, Vertex or
 * Foundry, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, apiKeyHelper, and only then
 * CLAUDE_CODE_OAUTH_TOKEN; the `env` of settings.json wins over the shell.
 */

const PROVIDERS = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']
const SHELL = ['ANTHROPIC_AUTH_TOKEN', ...PROVIDERS]
const SETTINGS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  // In settings.json it wins over the shell, so the setup cannot keep it out of the checks.
  'ANTHROPIC_API_KEY',
  ...PROVIDERS,
]

export const configDir = (env = process.env, home = homedir()) =>
  env.CLAUDE_CONFIG_DIR || join(home, '.claude')
export const settingsFile = (env = process.env, home = homedir()) =>
  join(configDir(env, home), 'settings.json')
const stateFile = (env, home) =>
  env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json')

const set = (value) => !!value && !['0', 'false'].includes(String(value).toLowerCase())

function readObject(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

/**
 * What stands in the gateway's way: `shell` and `settings` name what the
 * person must remove first, `ours` what an earlier setup of ours left in
 * settings.json (safe to drop), `apiKey` an API key that wins over the sign-in.
 * `guarded` is the address the leak guard set (guard.mjs), ours even if the
 * gateway's address has changed since.
 */
export function conflicts(origin, env = process.env, file = settingsFile(env), guarded = null) {
  const settings = readObject(file)
  const vars = settings.env && typeof settings.env === 'object' ? settings.env : {}
  const ours = (name) =>
    (name === 'ANTHROPIC_BASE_URL' && (vars[name] === origin || vars[name] === guarded)) ||
    (name === 'ANTHROPIC_CUSTOM_HEADERS' && /^x-aitheroute-token:/i.test(String(vars[name])))
  const present = SETTINGS.filter((name) => set(vars[name]))
  return {
    shell: SHELL.filter((name) => set(env[name])),
    settings: [
      ...present.filter((name) => !ours(name)),
      ...(settings.apiKeyHelper ? ['apiKeyHelper'] : []),
    ],
    ours: present.filter(ours),
    apiKey: set(env.ANTHROPIC_API_KEY),
  }
}

/** Changes a JSON object file in place; leaves a file it cannot read as an object alone. */
export function mergeJson(file, change) {
  let data = {}
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return false
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
  }
  change(data)
  mkdirSync(dirname(file), {recursive: true})
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  return true
}

/** Drops what an earlier setup of ours wrote into settings.json's env: env.sh holds it now. */
export const dropOurs = (keys, file = settingsFile()) =>
  !keys.length ||
  mergeJson(file, (c) => {
    for (const key of keys) delete c.env[key]
  })

/**
 * Claude Code's own first-run check and WebFetch's domain check go straight to
 * api.anthropic.com, past the gateway, and where that host refuses or cannot
 * be reached Claude Code quits before its first request. A finished first run
 * (hasCompletedOnboarding, an internal field of ~/.claude.json) and
 * skipWebFetchPreflight (a documented setting) keep both away, so a session
 * talks to the gateway only. Null when done, else the file that is not a JSON object.
 */
export function claudeFlags(env = process.env, home = homedir()) {
  const state = stateFile(env, home)
  if (!mergeJson(state, (c) => (c.hasCompletedOnboarding = true))) return state
  const settings = settingsFile(env, home)
  if (!mergeJson(settings, (c) => (c.skipWebFetchPreflight = true))) return settings
  return null
}
