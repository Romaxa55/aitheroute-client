#!/usr/bin/env node
import {delimiter} from 'node:path'
import {defaults} from './defaults.mjs'
import {yes} from './guard.mjs'
import {findToken, VALID} from './token.mjs'
import {fromCommand, fromSaved} from './tools.mjs'

/**
 * The setup core: Claude Code with the person's own subscription
 * through AI The Route. The first stage (install.sh, install.ps1 or start)
 * brings Node.js and passes the gateway and token in AITR_ORIGIN and
 * AITR_TOKEN; run on its own it asks for the bot's command. The person's
 * settings are saved only once the sign-in token is in hand (before that, just
 * Claude Code's two flags), so a run that stops halfway leaves an earlier
 * working setup as it was. The steps come in `d` (defaults.mjs).
 */

/** A pairing code lives 10 minutes; one older than this is asked for again before use. */
export const CODE_FRESH_MS = 5 * 60 * 1000

async function where(d) {
  const {AITR_ORIGIN: origin, AITR_TOKEN: token} = d.env
  delete d.env.AITR_TOKEN
  if (origin && token) return {origin, token}
  // Run again by hand: a new command from the bot, or Enter for the saved one.
  const saved = fromSaved(d.env)
  const line = await d.askLine(saved ? d.words.commandOrKeep : d.words.command)
  return fromCommand(line) ?? (line ? null : saved)
}

/** The one-year sign-in token: through the helper where it can open the sign-in, else pasted. */
async function signIn(d, origin, code) {
  const blocker = await d.signInBlocker()
  if (blocker) {
    d.say(blocker)
    return {oauth: await d.askToken(d.words.pasteOther)}
  }
  const paired = await code()
  if (paired.stop) return paired
  d.say('pair')
  if (!d.pairHelper(origin, paired.code)) return {stop: 'pairFailed'}
  d.say('signIn')
  const printed = d.setupToken()
  // Nothing printed at all (Windows), or a token printed but not read: it is on screen.
  // A transcript without one means the sign-in never got that far: it comes from elsewhere.
  const shown = !printed || printed.includes('sk-ant-oat01-')
  return {
    oauth: findToken(printed) ?? (await d.askToken(shown ? d.words.paste : d.words.pasteOther)),
  }
}

export async function main(d = defaults()) {
  const found = await where(d)
  if (!found) return d.stop('invalid')
  if (!d.helper) return d.stop('incomplete')
  const {origin, token} = found
  const clash = d.conflicts(origin)
  if (clash.shell.length) return d.stop('foreignEnv', {names: clash.shell.join(', ')})
  if (clash.settings.length)
    return d.stop('foreignSettings', {names: clash.settings.join(', '), file: d.settingsFile})
  if (clash.apiKey) d.say('apiKey')
  d.prepare()
  const first = await d.pairingCode(origin, token)
  if (first.stop) return d.stop(first.stop)
  const issued = d.now()
  const claude = d.ensureClaude(d.say)
  if (claude.stop) return d.stop(claude.stop)
  const paths = claude.bin ? [claude.bin] : []
  if (claude.bin) d.env.PATH = claude.bin + delimiter + d.env.PATH
  const vars = {
    ANTHROPIC_BASE_URL: origin,
    ANTHROPIC_CUSTOM_HEADERS: 'x-aitheroute-token: ' + token,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    // Not covered by the flag above: the official plugin marketplace is fetched from downloads.claude.ai.
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
  }
  // This process only, for the checks below; saved once, at the end.
  Object.assign(d.env, vars)
  const flags = d.claudeFlags()
  if (flags) return d.stop('flagsFailed', {file: flags})
  const before = d.env.CLAUDE_CODE_OAUTH_TOKEN
  let oauth = VALID.test(before ?? '') && d.check() ? before : null
  if (oauth) d.say('keptSignIn')
  else {
    // A slow download can outlast the first code: then a fresh one.
    const code = async () =>
      d.now() - issued < CODE_FRESH_MS ? first : d.pairingCode(origin, token)
    const signed = await signIn(d, origin, code)
    if (signed.stop) return d.stop(signed.stop)
    oauth = signed.oauth
  }
  if (!oauth) return d.stop('noToken')
  d.say('env')
  const saved = d.save({...vars, CLAUDE_CODE_OAUTH_TOKEN: oauth}, paths)
  if (saved === 'envFailed') return d.stop('envFailed')
  // A leak guard that is on (guard.mjs) keeps its address in settings.json: moved to the
  // gateway's current one before the check, never dropped, so it is not off for a moment.
  const guard = d.guard()
  const drop = guard ? clash.ours.filter((name) => name !== 'ANTHROPIC_BASE_URL') : clash.ours
  if (!d.dropOurs(drop) || (guard && !d.guardKeep(origin)))
    return d.stop('flagsFailed', {file: d.settingsFile})
  if (saved === 'rcFailed') d.say('rcFailed', d.rcLine())
  d.say('check')
  if (!d.check()) return d.stop('checkFailed')
  // Offered once everything works, the person's choice; kept as it is when on.
  if (guard) d.say('guardKept')
  else if (yes(await d.askLine(d.words.guardAsk))) {
    const failed = await d.guardOn(origin)
    if (failed) return failed
  }
  d.say('done')
  return 0
}

if (import.meta.main) process.exitCode = await main()
