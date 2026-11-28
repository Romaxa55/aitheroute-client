import {access, lstat, realpath} from 'node:fs/promises'
import {constants} from 'node:fs'
import {execFile, spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {setTimeout as delay} from 'node:timers/promises'

export const error = (code) => Object.assign(new Error(code), {code})

export const errorReasons = Object.freeze({
  STRICT_PLATFORM: 'unsupported',
  STRICT_DEPENDENCY: 'setup',
  STRICT_COMMAND: 'setup',
  STRICT_BWRAP: 'bwrap',
  STRICT_XEPHYR: 'xephyr',
  STRICT_CHROMIUM: 'chromium',
  STRICT_NODE: 'node',
  STRICT_NODE_VERSION: 'nodeVersion',
  STRICT_CLI_MISSING: 'cliMissing',
  STRICT_BROWSER: 'browser',
  STRICT_DISPLAY: 'display',
  STRICT_NETWORK: 'isolation',
  STRICT_PROXY: 'gateway',
  STRICT_GATEWAY_PROOF: 'gatewayProof',
  STRICT_PROVIDER_HOST: 'providerHost',
  STRICT_PROVIDER_TLS: 'providerTls',
})

// Only these outcomes are part of the guest-to-supervisor wire protocol.
const wireCodes = new Set([
  'STRICT_COMMAND',
  'STRICT_PROXY',
  'STRICT_BROWSER',
  'STRICT_NETWORK',
  'STRICT_GATEWAY_PROOF',
  'STRICT_PROVIDER_HOST',
  'STRICT_PROVIDER_TLS',
])
export const wireCode = (code, fallback = 'STRICT_NETWORK') =>
  wireCodes.has(code) ? code : fallback

export async function executable(name) {
  if (
    typeof name !== 'string' ||
    !/^(?:\/usr\/(?:local\/)?bin\/)?[a-zA-Z0-9_][a-zA-Z0-9._+-]*$/.test(name)
  )
    throw error('STRICT_COMMAND')
  for (const path of name.startsWith('/')
    ? [name]
    : ['/usr/local/bin/' + name, '/usr/bin/' + name]) {
    try {
      const full = await realpath(path)
      if (!full.startsWith('/usr/') || !(await lstat(full)).isFile()) continue
      await access(full, constants.X_OK)
      return path
    } catch {}
  }
  throw error('STRICT_CLI_MISSING')
}

export async function checkNode(run = promisify(execFile)) {
  let version
  try {
    const {stdout} = await run('/usr/bin/node', ['--version'], {
      timeout: 3000,
      env: {PATH: '/usr/bin:/bin'},
    })
    version = /^v(\d+)\.(\d+)\./.exec(stdout)
  } catch {
    throw error('STRICT_NODE')
  }
  if (!version) throw error('STRICT_NODE')
  if (Number(version[1]) < 24 || (Number(version[1]) === 24 && Number(version[2]) < 5))
    throw error('STRICT_NODE_VERSION')
}

export async function checkDependencies(find = executable, version = checkNode) {
  const required = {
    bwrap: 'STRICT_BWRAP',
    Xephyr: 'STRICT_XEPHYR',
    chromium: 'STRICT_CHROMIUM',
    node: 'STRICT_NODE',
  }
  for (const [name, code] of Object.entries(required)) {
    try {
      await find('/usr/bin/' + name)
    } catch {
      throw error(code)
    }
  }
  await version()
}

export function supervised(program, args, settings) {
  const child = spawn(program, args, {...settings, detached: true})
  const exited = new Promise((r) => {
    child.once('error', () => r(1))
    child.once('close', (code) => r(code ?? 1))
  })
  return {
    child,
    exited,
    async stop() {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, 'SIGTERM')
          await Promise.race([exited, delay(1000, null, {ref: false})])
          if (child.exitCode === null && child.signalCode === null)
            process.kill(-child.pid, 'SIGKILL')
        } catch {}
      }
      await exited
    },
  }
}

export async function deadline(promise, ms, code) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, fail) => {
        timer = setTimeout(() => fail(error(code)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
