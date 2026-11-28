import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createInterface} from 'node:readline'

/**
 * The one-year sign-in token `claude setup-token` prints. Claude
 * Code wraps it to the terminal's width, and a mouse copy keeps the breaks
 * (anthropics/claude-code#54738), so the setup reads it from a transcript of
 * the session (`script`, macOS and Linux) and joins the wrapped pieces; failing
 * that - and on Windows - the person pastes it and the pieces are joined the same way.
 */

const START = 'sk-ant-oat01-'
const ESCAPES =
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78]/g
const PIECE = /^[A-Za-z0-9_-]+$/
// A frame drawn around the token (box lines, pipes) is not part of it.
const FRAME = /^[\s\u2500-\u257f|]+|[\s\u2500-\u257f|]+$/g
export const VALID = /^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/

/** The last token in a terminal transcript, its wrapped pieces joined back. */
export function findToken(transcript) {
  const lines = transcript
    .replace(ESCAPES, '')
    .replace(/\r\n/g, '\n')
    .split(/[\r\n]/)
    .map((line) => line.replace(FRAME, ''))
  for (let i = lines.length - 1; i >= 0; i--) {
    const at = lines[i].lastIndexOf(START)
    if (at === -1) continue
    let token = /^[A-Za-z0-9_-]+/.exec(lines[i].slice(at))[0]
    // Only a token that runs to its line's end can go on, wrapped, below.
    const open = !lines[i].slice(at + token.length)
    for (let j = i + 1; open && j < lines.length && PIECE.test(lines[j]); j++) token += lines[j]
    return VALID.test(token) ? token : null
  }
  return null
}

const quote = (arg) => "'" + arg.replaceAll("'", "'\\''") + "'"

/** Runs a command on this terminal and returns what it printed (empty where it cannot). */
export function runCaptured(
  command,
  args,
  platform = process.platform,
  run = spawnSync,
  env = process.env,
) {
  if (platform === 'win32') return (run(command, args, {stdio: 'inherit', env}), '')
  const dir = mkdtempSync(join(tmpdir(), 'aitr-'))
  const log = join(dir, 'session')
  const argv =
    platform === 'darwin'
      ? ['-q', log, command, ...args]
      : ['-q', '-e', '-c', [command, ...args].map(quote).join(' '), log]
  try {
    // util-linux runs the -c line with $SHELL: the quoting above is for sh.
    const done = run('script', argv, {stdio: 'inherit', env: {...env, SHELL: '/bin/sh'}})
    const printed = done.error ? '' : readFileSync(log, {encoding: 'utf8', flag: 'a+'})
    // No script, or one that refused the options (BusyBox has no -e): run it plainly.
    if (!printed && (done.error || done.status !== 0)) run(command, args, {stdio: 'inherit', env})
    return printed
  } catch {
    return ''
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
}

/** Lines the person pastes, until an empty one after some text; the pieces joined. */
export function askToken(question, input = process.stdin, output = process.stdout) {
  output.write(question + '\n')
  const lines = createInterface({input, terminal: false})
  return new Promise((resolve) => {
    let text = ''
    // close() runs the close listener at once: settle first.
    const end = () => {
      const token = text.replace(/\s+/g, '')
      resolve(VALID.test(token) ? token : null)
      lines.close()
    }
    lines.on('line', (line) => (line.trim() || !text ? (text += line.trim()) : end()))
    lines.on('close', () => resolve(VALID.test(text) ? text : null))
  })
}

/** One line the person types or pastes. */
export function askLine(question, input = process.stdin, output = process.stdout) {
  output.write(question + '\n')
  const lines = createInterface({input, terminal: false})
  return new Promise((resolve) => {
    lines.once('line', (line) => (resolve(line.trim()), lines.close()))
    lines.on('close', () => resolve(''))
  })
}
