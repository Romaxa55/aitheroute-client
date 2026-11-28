#!/usr/bin/env node
import {spawn} from 'node:child_process'
import {lstatSync} from 'node:fs'
import {join} from 'node:path'
import {browserArgs} from './desktop.mjs'

// Used as BROWSER by clients that support it. The profile belongs to the
// running helper, so Chromium opens a tab on the same authenticated proxy.
const url = process.argv.slice(2).find((arg) => /^https:\/\//i.test(arg))
if (!url || !process.env.AITR_LOGIN_PROFILE) process.exit(1)
// Only to the helper's running browser (its profile lock): a new one would
// outlive the session. Else the CLI prints its link.
const lock = (name) => {
  try {
    return Boolean(lstatSync(join(process.env.AITR_LOGIN_PROFILE, name)))
  } catch {
    return false
  }
}
if (!lock('SingletonLock') && !lock('lockfile')) process.exit(1)
const args = browserArgs(
  process.env.AITR_LOGIN_PROFILE,
  {port: process.env.AITR_LOGIN_PORT},
  process.env.AITR_LOGIN_ORIGIN,
  url,
)
const child = spawn(process.env.AITR_LOGIN_BROWSER, args, {stdio: 'ignore', detached: true})
child.once('error', () => process.exit(1))
child.unref()
