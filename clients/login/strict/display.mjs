import {randomBytes} from 'node:crypto'
import {writeFile, lstat, mkdir, realpath} from 'node:fs/promises'
import {createInterface} from 'node:readline'
import {once} from 'node:events'
import {homedir} from 'node:os'
import {baseMounts} from './sandbox.mjs'
import {deadline, error, supervised} from './system.mjs'

// A wildcard Xauthority record is private to this Xephyr instance. Only its
// socket and cookie reach the child; the real desktop and its cookie stay out.
function cookie() {
  const fields = [
    Buffer.alloc(0),
    Buffer.alloc(0),
    Buffer.from('MIT-MAGIC-COOKIE-1'),
    randomBytes(16),
  ]
  const out = [Buffer.from([255, 255])]
  for (const value of fields) {
    const len = Buffer.alloc(2)
    len.writeUInt16BE(value.length)
    out.push(len, value)
  }
  return Buffer.concat(out)
}
export async function nestedDisplay(dir) {
  const display = process.env.DISPLAY
  const number = /^:(\d{1,5})(?:\.\d+)?$/.exec(display ?? '')?.[1]
  if (!number) throw error('STRICT_DISPLAY')
  const parentSocket = '/tmp/.X11-unix/X' + number
  let authority
  try {
    if (!(await lstat(parentSocket)).isSocket()) throw error('STRICT_DISPLAY')
    authority = await realpath(process.env.XAUTHORITY || homedir() + '/.Xauthority')
    if (!(await lstat(authority)).isFile()) throw error('STRICT_DISPLAY')
  } catch {
    throw error('STRICT_DISPLAY')
  }
  const guestDisplay = number === '80' ? 81 : 80
  await mkdir(dir + '/sockets', {mode: 0o700})
  await writeFile(dir + '/auth', cookie(), {mode: 0o600, flag: 'wx'})
  // Xephyr must never allocate or unlink sockets in the host X11 directory.
  // Its private socket directory contains one read-only mount of the parent.
  const args = [
    ...baseMounts(),
    '--tmpfs',
    '/tmp',
    '--bind',
    dir + '/sockets',
    '/tmp/.X11-unix',
    '--ro-bind',
    parentSocket,
    parentSocket,
    '--ro-bind',
    authority,
    '/run/parent-auth',
    '--ro-bind',
    dir + '/auth',
    '/run/nested-auth',
    '--setenv',
    'DISPLAY',
    display,
    '--setenv',
    'XAUTHORITY',
    '/run/parent-auth',
    '--setenv',
    'HOME',
    '/tmp',
    '--setenv',
    'PATH',
    '/usr/bin:/bin',
    '--',
    '/usr/bin/Xephyr',
    ':' + guestDisplay,
    '-displayfd',
    '1',
    '-nolisten',
    'tcp',
    '-terminate',
    '-extension',
    'GLX',
    '-auth',
    '/run/nested-auth',
    '-screen',
    '1120x760',
    '-title',
    'AI The Route',
  ]
  const instance = supervised('/usr/bin/bwrap', args, {
    env: {},
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const output = createInterface({input: instance.child.stdout})
  try {
    const line = await deadline(
      Promise.race([
        once(output, 'line').then(([line]) => line),
        instance.exited.then(() => {
          throw error('STRICT_DISPLAY')
        }),
      ]),
      10000,
      'STRICT_DISPLAY',
    )
    if (line !== String(guestDisplay) || !(await lstat(dir + '/sockets/X' + line)).isSocket())
      throw error('STRICT_DISPLAY')
    return {...instance, number: Number(line)}
  } catch {
    await instance.stop()
    throw error('STRICT_DISPLAY')
  } finally {
    output.close()
  }
}
