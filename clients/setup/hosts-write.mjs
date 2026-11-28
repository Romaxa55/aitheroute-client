import {spawnSync} from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  writeSync,
} from 'node:fs'
import {dirname} from 'node:path'
import {hostsFile, marked, readHosts, wide, withGuard} from './hosts.mjs'

/**
 * Puts the leak guard's block (hosts.mjs) in the hosts file or takes it out,
 * keeping the file's owner, mode, ACL or SELinux label (never a new file),
 * then drops the system's cached lookups. Never empties the file first: on
 * appends; off cuts the end off when the block is last, else writes over the
 * old bytes in place with the old text kept beside the file until done, so a
 * stop midway is put right first thing on the next run. Nothing to change,
 * nothing written. Throws without the rights, and with code AITR_WIDE for a
 * UTF-16 file.
 */

const FLUSH = {
  darwin: [
    ['dscacheutil', ['-flushcache']],
    ['killall', ['-HUP', 'mDNSResponder']],
  ],
  win32: [['ipconfig', ['/flushdns']]],
  linux: [['resolvectl', ['flush-caches']]],
}

/** The old text beside the hosts file while it is written over in place. */
export const undoFile = (file) => file + '.aitheroute-old'

/** Anything of the guard's there: a trace of the block, or the copy of a write that stopped. */
export const hostsLeft = (file) =>
  [undoFile(file), undoFile(file) + '.tmp'].some((f) => existsSync(f)) ||
  (existsSync(file) && marked(readHosts(file)))

export function writeHosts(on, file = hostsFile(), platform = process.platform, run = spawnSync) {
  const undo = undoFile(file)
  let changed = false
  if (existsSync(undo)) {
    // A write in place that stopped midway: the old text goes back before anything else.
    overwrite(file, readFileSync(undo))
    rmSync(undo)
    changed = true
  }
  rmSync(undo + '.tmp', {force: true})
  const text = readHosts(file)
  if (wide(text)) throw Object.assign(new Error(file + ' is UTF-16'), {code: 'AITR_WIDE'})
  const next = withGuard(text, on)
  if (next !== text) {
    if (next.startsWith(text)) appendFileSync(file, next.slice(text.length), 'latin1')
    else if (text.startsWith(next)) truncateSync(file, next.length)
    else {
      keep(undo, Buffer.from(text, 'latin1'))
      overwrite(file, Buffer.from(next, 'latin1'))
      rmSync(undo)
    }
    changed = true
  }
  if (changed)
    for (const [command, args] of FLUSH[platform] ?? FLUSH.linux)
      run(command, args, {stdio: 'ignore'})
}

/** Whole or not at all: written beside, flushed, then renamed into place. */
function keep(undo, bytes) {
  const tmp = undo + '.tmp'
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeAll(fd, bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, undo)
  syncFolder(dirname(undo))
}

function overwrite(file, bytes) {
  const fd = openSync(file, 'r+')
  try {
    writeAll(fd, bytes)
    ftruncateSync(fd, bytes.length)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function writeAll(fd, bytes) {
  for (let at = 0; at < bytes.length;) {
    const n = writeSync(fd, bytes, at, bytes.length - at, at)
    if (!n) throw new Error('the hosts file took no bytes')
    at += n
  }
}

// The rename itself survives a power cut (macOS, Linux); Windows does not open folders, nor need to.
function syncFolder(folder) {
  try {
    const fd = openSync(folder, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {}
}
