import {mkdtempSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

export const GW = 'https://gw.example'
export const read = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** A guard's steps over a temporary home: what it said and asked is recorded. */
export function guardDeps(over = {}) {
  const base = mkdtempSync(join(tmpdir(), 'aitr-guard-'))
  const said = []
  let hosts = false
  let part = false
  const d = {
    base,
    env: {},
    settingsFile: join(base, 'settings.json'),
    hostsFile: '/etc/hosts',
    protectCommand: 'sh start.sh protect',
    words: new Proxy({}, {get: (_, key) => String(key)}),
    say: (key, vars) => said.push(vars?.off ? `${key} ${vars.off}` : key),
    stop: (key) => (said.push('stop ' + key), 1),
    askLine: async (q) => (said.push('? ' + q), 'y'),
    hostsOn: () => hosts,
    hostsLeft: () => hosts || part,
    hostsShadowed: () => [],
    hostsGuard: (on) => ((hosts = on), (part = false), null),
    ...over,
  }
  return {d, said, setHosts: (on) => (hosts = on), setPart: (on) => (part = on)}
}
