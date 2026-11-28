import {readFileSync} from 'node:fs'
import {join} from 'node:path'

/**
 * The leak guard's block in the hosts file: Anthropic's account and
 * API hosts point nowhere, so nothing on this computer reaches them past the
 * gateway (Claude Code without our settings, the Claude Desktop app, a browser
 * on claude.ai). The route itself is unaffected: Claude Code calls the gateway
 * by its own name, and the login helper's browser and CLI leave name lookups
 * to the gateway (--host-resolver-rules, HTTPS_PROXY). Docs, support, status
 * pages and claude.com stay open. The hosts come from Claude Code 2.1.332's own
 * addresses and a session measured through a proxy (docs/setup.md). This file
 * reads and builds the text; hosts-write.mjs writes it.
 */

export const HOSTS = [
  'api.anthropic.com',
  'claude.ai',
  'www.claude.ai',
  'platform.claude.com',
  'console.anthropic.com',
  'downloads.claude.ai',
  'mcp-proxy.anthropic.com',
  'statsig.anthropic.com',
]

const START = '# >>> AI The Route leak guard >>>'
const END = '# <<< AI The Route leak guard <<<'
const BLOCK = [START, ...HOSTS.flatMap((host) => [`0.0.0.0 ${host}`, `:: ${host}`]), END]
const OURS = new Set(BLOCK)

export const hostsFile = (platform = process.platform, env = process.env) =>
  platform === 'win32'
    ? join(env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
    : '/etc/hosts'

// One character per byte: a file in any encoding but UTF-16 comes back byte for byte.
export const readHosts = (file) => readFileSync(file, 'latin1')
/** UTF-16 (a byte order mark, or NUL bytes, as Notepad's "Unicode" writes it) is left alone. */
export const wide = (text) => /^(\xff\xfe|\xfe\xff)/.test(text) || text.includes('\0')

/** The lines with each one's own line end, so the person's lines go back as they were. */
function rows(text) {
  const out = []
  const ends = /\r\n|\n/g
  let at = 0
  for (let m; (m = ends.exec(text)); at = m.index + m[0].length)
    out.push({line: text.slice(at, m.index), end: m[0]})
  if (at < text.length) out.push({line: text.slice(at), end: ''})
  return out
}
const glue = (list) => list.map((row) => row.line + row.end).join('')

const mark = (row) => row.line === START || row.line === END

/** The whole block is there: a start mark, an end mark after it, every line of ours between. */
export function guarded(text) {
  const lines = rows(text).map((row) => row.line)
  const start = lines.indexOf(START)
  const inside = start < 0 ? [] : lines.slice(start, lines.indexOf(END, start) + 1)
  return BLOCK.every((line) => inside.includes(line))
}
/** Any trace of it, whole or cut short: off takes all of it out. */
export const marked = (text) => rows(text).some(mark)

/** Guarded hosts a line of the person's above the block sends elsewhere: the first line wins. */
export function shadowed(text) {
  const lines = rows(text).map((row) => row.line)
  const start = lines.indexOf(START)
  const above = lines.slice(0, Math.max(start, 0))
  const names = above.flatMap((line) => line.replace(/#.*/, '').trim().split(/\s+/).slice(1))
  return HOSTS.filter((host) => names.some((name) => name.toLowerCase() === host))
}

/**
 * The text with the guard's block taken out, and put back at the end when
 * `on`. Between the two marks only our own lines go; a block cut short by hand
 * (no end mark) ends at the first line that is not ours.
 */
export function withGuard(text, on) {
  // A whole block, the only one, stays where it is (the person may have added lines after it).
  if (on && guarded(text) && rows(text).filter(mark).length === 2) return text
  let list = rows(text)
  for (let start; (start = list.findIndex((row) => row.line === START)) >= 0;) {
    const end = list.findIndex((row, i) => i > start && row.line === END)
    const drop = new Set()
    for (let i = start; i < list.length && (end > 0 ? i <= end : OURS.has(list[i].line)); i++)
      if (OURS.has(list[i].line)) drop.add(i)
    // The blank line the guard put before its block (never the file's first line).
    if (start > 1 && list[start - 1].line === '') drop.add(start - 1)
    list = list.filter((_, i) => !drop.has(i))
  }
  // An end mark with no start (that line deleted by hand): ours just above it go with it.
  for (let end; (end = list.findIndex((row) => row.line === END)) >= 0;) {
    let first = end
    while (first > 0 && OURS.has(list[first - 1].line)) first--
    const blank = first > 1 && list[first - 1].line === '' ? 1 : 0
    list.splice(first - blank, end - first + 1 + blank)
  }
  if (!on) return glue(list)
  const eol = list.find((row) => row.end)?.end ?? '\n'
  if (list.length && !list.at(-1).end) list.at(-1).end = eol
  if (list.length) list.push({line: '', end: eol})
  return glue([...list, ...BLOCK.map((line) => ({line, end: eol}))])
}
