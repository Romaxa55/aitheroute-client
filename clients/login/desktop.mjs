import {existsSync} from 'node:fs'
import {delimiter, join, isAbsolute} from 'node:path'

const pages = {
  anthropic: 'https://claude.ai/login',
  openai: 'https://platform.openai.com/api-keys',
  chatgpt: 'https://chatgpt.com/auth/login',
  gemini: 'https://aistudio.google.com/apikey',
  'gemini-cli': 'https://accounts.google.com/',
}

export function officialPage(provider, consoleMode = false) {
  if (consoleMode && provider !== 'anthropic')
    throw new Error('--console applies to an Anthropic API key.')
  if (!pages[provider]) throw new Error('Unknown provider.')
  return consoleMode ? 'https://platform.claude.com/' : pages[provider]
}

export function browserArgs(profile, {port}, origin, page) {
  const gateway = new URL(origin).hostname
  return [
    '--user-data-dir=' + profile,
    '--proxy-server=http://127.0.0.1:' + port,
    '--proxy-bypass-list=localhost;127.0.0.1;[::1];' + new URL(origin).host,
    // A page goes to the proxy by name; nothing else may resolve a name here
    // (^NOTFOUND: ~ is a valid host character, so ~NOTFOUND is a lookup).
    // The proxy's own 127.0.0.1 goes through these rules too: it must stay out.
    '--host-resolver-rules=MAP * ^NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE ' +
      gateway,
    '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    // ECH would hide the name the gateway checks; Cast discovery talks to the LAN.
    '--disable-features=EncryptedClientHello,MediaRouter',
    '--disable-background-networking',
    '--disable-background-mode',
    '--no-first-run',
    '--no-default-browser-check',
    page,
  ]
}

export function childEnvironment(base, {port, password}, origin) {
  const url = 'http://route:' + password + '@127.0.0.1:' + port
  const bypass = ['localhost', '127.0.0.1', '::1', '[::1]', new URL(origin).hostname].join(',')
  return {
    ...base,
    HTTPS_PROXY: url,
    https_proxy: url,
    HTTP_PROXY: url,
    http_proxy: url,
    ALL_PROXY: url,
    all_proxy: url,
    NO_PROXY: bypass,
    no_proxy: bypass,
    NODE_USE_ENV_PROXY: '1',
  }
}

export function findBrowser(env = process.env) {
  const choices =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ]
      : process.platform === 'win32'
        ? [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]
            .filter(Boolean)
            .flatMap((dir) => [
              join(dir, 'Google/Chrome/Application/chrome.exe'),
              join(dir, 'Microsoft/Edge/Application/msedge.exe'),
            ])
        : [
            'chromium',
            'chromium-browser',
            'google-chrome',
            'google-chrome-stable',
            'microsoft-edge',
          ]
  for (const c of env.AITR_BROWSER ? [env.AITR_BROWSER] : choices) {
    const paths = isAbsolute(c)
      ? [c]
      : (env.PATH ?? '')
          .split(delimiter)
          .filter(Boolean)
          .map((d) => join(d, c))
    for (const path of paths) if (existsSync(path)) return path
  }
  throw new Error('Install Chrome or Edge, or set AITR_BROWSER to its executable path.')
}
