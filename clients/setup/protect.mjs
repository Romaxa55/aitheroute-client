#!/usr/bin/env node
import {defaults} from './defaults.mjs'
import {guardOff, guardOn, guardStatus, readGuard, savedOrigin} from './guard.mjs'

/**
 * `start protect on|off|status`: the leak guard by hand, at any
 * time after the setup (guard.mjs). `hosts on|off` is the elevated child that
 * only writes the hosts file.
 */
export async function main(args = process.argv.slice(2), d = defaults()) {
  const [what, how] = args
  if (what === 'hosts' && (how === 'on' || how === 'off')) {
    try {
      d.writeHosts(how === 'on')
      return 0
    } catch {
      return 1
    }
  }
  if (what === 'off') return guardOff(d)
  if (what === 'status') return guardStatus(d)
  if (what !== 'on') {
    d.say('guardUsage', {cmd: d.protectCommand})
    return 2
  }
  const origin = savedOrigin(d)
  if (!origin) return d.stop('guardNoSetup')
  // Never over a value of someone else's: the same check the setup makes.
  const clash = d.conflicts(origin, readGuard(d.base)?.origin)
  if (clash.settings.length)
    return d.stop('foreignSettings', {names: clash.settings.join(', '), file: d.settingsFile})
  return guardOn(d, origin)
}

if (import.meta.main) process.exitCode = await main()
