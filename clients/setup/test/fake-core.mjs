/** A setup core with every outside step replaced: what it said, saved and ran is recorded. */

export const OAUTH = 'sk-ant-oat01-' + 'Ab3_-'.repeat(12)
export const NONE = {shell: [], settings: [], ours: [], apiKey: false}

export function fakeCore(over = {}) {
  const said = []
  const saved = []
  const stops = []
  const d = {
    env: {AITR_ORIGIN: 'https://gw.example', AITR_TOKEN: 'atr_1', PATH: '/usr/bin'},
    base: '/h/.aitheroute',
    // Each message is its own key, so the tests read which one was said.
    words: new Proxy({}, {get: (_, key) => String(key)}),
    helper: '/h/.aitheroute/helper/clients/login/cli.mjs',
    now: () => 0,
    say: (key) => said.push(key),
    stop: (key, vars) => (stops.push({key, vars}), 1),
    askLine: async () => '',
    askToken: async () => null,
    conflicts: () => NONE,
    prepare: () => said.push('(prepare)'),
    pairingCode: async () => ({code: 'pair_1'}),
    ensureClaude: () => ({bin: '/h/.aitheroute/claude/bin'}),
    claudeFlags: () => null,
    signInBlocker: async () => null,
    pairHelper: () => true,
    setupToken: () => 'Your token:\n\n' + OAUTH + '\n\nStore it safely.\n',
    check: () => true,
    save: (vars, paths) => (saved.push({vars, paths}), null),
    dropOurs: () => true,
    settingsFile: '/h/.claude/settings.json',
    rcLine: () => ({file: '/h/.zshrc', line: '. env.sh'}),
    platform: 'linux',
    hostsFile: '/etc/hosts',
    protectCommand: 'sh ~/.aitheroute/start.sh protect',
    writeHosts: () => said.push('(hosts)'),
    hostsOn: () => false,
    hostsLeft: () => false,
    hostsShadowed: () => [],
    hostsGuard: () => null,
    guard: () => null,
    guardKeep: () => (said.push('(guardKeep)'), true),
    guardOn: async () => (said.push('(guardOn)'), 0),
    ...over,
  }
  return {d, said, saved, stops}
}
