import {connect} from 'node:net'
import {constants} from 'node:fs'
import {networkInterfaces} from 'node:os'
import {access, mkdir, readlink, writeFile} from 'node:fs/promises'
import {createInterface} from 'node:readline'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {browserSession} from './browser.mjs'
import {localProxy} from './local.mjs'
import {probe} from './probe.mjs'
import {error, wireCode} from './system.mjs'

const channel = connect('/run/route/control')
channel.on('error', () => process.exit(1))
channel.once('close', () => process.exit(1))
const lines = createInterface({input: channel})
let view,
  port,
  settings,
  verified = false,
  started = false
const reply = (body) => channel.write(JSON.stringify(body) + '\n')
let finishing = false
function finish(exit) {
  if (finishing) return
  finishing = true
  channel.end(JSON.stringify({exit}) + '\n', () => process.exit(exit))
}

async function init(message) {
  const names = Object.keys(networkInterfaces())
  if (
    names.length !== 1 ||
    names[0] !== 'lo' ||
    (await readlink('/proc/self/ns/net')) === message.hostNS
  )
    throw error('STRICT_NETWORK')
  // Debian's shell launcher sources /etc/chromium.d. Its system binary uses
  // the explicit isolated flags without importing host desktop configuration.
  const native = '/usr/lib/chromium/chromium'
  try {
    await access(native, constants.X_OK)
    message.browser = native
  } catch (err) {
    if (err.code !== 'ENOENT') throw error('STRICT_BROWSER')
  }
  settings = message
  port = await localProxy(message.password, () => started)
  await mkdir('/tmp/route-runtime', {mode: 0o700})
  await mkdir('/tmp/openers', {mode: 0o700})
  const opener =
    '#!/bin/sh\ncase "$1" in https://*) exec "' +
    message.browser +
    '" --user-data-dir=/tmp/browser -- "$1";; *) exit 1;; esac\n'
  await writeFile('/tmp/openers/xdg-open', opener, {mode: 0o700, flag: 'wx'})
  // Separate names cover launchers used by commonly packaged vendor CLIs.
  await writeFile('/tmp/openers/sensible-browser', opener, {mode: 0o700, flag: 'wx'})
  await writeFile('/tmp/openers/open', opener, {mode: 0o700, flag: 'wx'})
  view = await browserSession(message.browser, port, (status) =>
    finish(started && !settings.command ? status : 1),
  )
}

async function open() {
  if (!verified || started) throw error('STRICT_PROXY')
  started = true
  await view.open(settings.command ? 'about:blank' : settings.page)
  if (!settings.command) return
  const local = 'http://127.0.0.1:' + port
  const bypass = 'localhost,127.0.0.1,::1,[::1]'
  const env = {
    ...process.env,
    PATH: '/tmp/openers:' + process.env.PATH,
    BROWSER: '/tmp/openers/xdg-open',
    HTTPS_PROXY: local,
    HTTP_PROXY: local,
    ALL_PROXY: local,
    https_proxy: local,
    http_proxy: local,
    all_proxy: local,
    NO_PROXY: bypass,
    no_proxy: bypass,
    NODE_USE_ENV_PROXY: '1',
  }
  const [program, ...args] = settings.command
  const cli = spawn(program, args, {env, stdio: 'inherit'})
  cli.once('exit', (code) => finish(code ?? 1))
  try {
    await once(cli, 'spawn')
  } catch {
    throw error('STRICT_COMMAND')
  }
}

try {
  for await (const line of lines) {
    try {
      const data = JSON.parse(line)
      if (data.action === 'init' && !settings) await init(data)
      else if (data.action === 'check' && view) {
        verified = false
        await probe(port, settings.password, new URL(settings.page).hostname)
        verified = true
      } else if (data.action === 'open' && view) await open()
      else throw error('STRICT_COMMAND')
      reply({ok: true})
    } catch (e) {
      reply({code: wireCode(e.code)})
    }
  }
} finally {
  process.exit(1)
}
