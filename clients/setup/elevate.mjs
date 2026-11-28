import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'

/**
 * The leak guard's hosts block on or off: written directly where
 * this process may, else by `entry hosts on|off` through sudo or Windows'
 * elevation prompt. Null once the file reads back as asked (on: the whole
 * block; off: no trace of it), else the message that says why not.
 */

// Start-Process shows Windows' elevation prompt; refusing it throws. One argument
// string, quoted by us: Windows PowerShell 5.1 joins an array's items without quotes.
const ELEVATE = `try { $p = Start-Process -FilePath $env:AITR_NODE -ArgumentList $env:AITR_ARGLINE -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } catch { exit 1 }`

export function hostsGuard(on, entry, d) {
  try {
    d.writeHosts(on)
  } catch (e) {
    if (e?.code === 'AITR_WIDE') return 'guardHostsEncoding'
    if (e?.code !== 'EACCES' && e?.code !== 'EPERM') return 'guardHostsRights'
    elevated(on ? 'on' : 'off', entry, d)
  }
  return (on ? d.hostsOn() : !d.hostsLeft()) ? null : 'guardHostsRights'
}

function elevated(how, entry, d) {
  const run = d.run ?? spawnSync
  // Ctrl-C at sudo's password prompt reaches this process too: it stops sudo, not the setup.
  const keep = () => {}
  process.on('SIGINT', keep)
  try {
    if (d.platform === 'win32') {
      const env = {
        ...process.env,
        AITR_NODE: process.execPath,
        AITR_ARGLINE: `"${entry}" hosts ${how}`,
      }
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ELEVATE], {
        env,
        stdio: 'inherit',
      })
    } else {
      const sudo = existsSync('/usr/bin/sudo') ? '/usr/bin/sudo' : 'sudo'
      run(sudo, [process.execPath, entry, 'hosts', how], {stdio: 'inherit'})
    }
  } finally {
    process.off('SIGINT', keep)
  }
}
