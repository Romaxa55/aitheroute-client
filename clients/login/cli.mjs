#!/usr/bin/env node
import {writeFileSync} from 'node:fs'
import {Writable} from 'node:stream'
import {createInterface} from 'node:readline/promises'
import {pairDevice, checkProvider, loadSession, selectProfile} from './session.mjs'
import {choiceId, privateHome} from './pair-store.mjs'
import {renderScreen} from './screen/render.mjs'
import {launch} from './launch.mjs'

const usage =
  'Usage: node clients/login/cli.mjs pair HTTPS_ORIGIN | select PROVIDER clean|reuse | profile PROVIDER | preview HTML_FILE | open PROVIDER [--console] | run PROVIDER -- PROGRAM [ARG...]'

async function codeFromStdin() {
  if (!process.stdin.isTTY) {
    // readFileSync(0) fails with EAGAIN on a pipe whose writer is not done yet.
    let text = ''
    for await (const chunk of process.stdin) text += chunk
    return text.trim()
  }
  process.stderr.write('Pairing code from your bot (hidden): ')
  const sink = new Writable({
    write(_chunk, _encoding, done) {
      done()
    },
  })
  const prompt = createInterface({input: process.stdin, terminal: true, output: sink})
  try {
    return (await prompt.question('')).trim()
  } finally {
    prompt.close()
    process.stderr.write('\n')
  }
}

async function finishPair(state) {
  const {provider, credential} = state
  if (state.pendingProfileChoice) {
    const command = 'node clients/login/cli.mjs select ' + provider + ' '
    console.error(
      [
        'Provider: ' + provider + '. This pairing needs a profile decision.',
        'A fresh profile starts without the previous vendor credentials or API settings: ' +
          command +
          'clean',
        'Using the previous profile keeps its signed-in account and settings: ' + command + 'reuse',
        'Your pairing is saved. Either choice preserves the previous files.',
      ].join('\n'),
    )
    if (!process.stdin.isTTY) return 2
    const prompt = createInterface({input: process.stdin, output: process.stderr})
    try {
      const answer = (
        await prompt.question('Enter clean or reuse (Return to decide later): ')
      ).trim()
      if (!answer) return 2
      await selectProfile(provider, answer, undefined, choiceId(credential))
    } finally {
      prompt.close()
    }
  }
  console.log('Paired ' + provider + '.')
  return 0
}

async function main([action, value, ...rest]) {
  if ((action === '--help' || action === '-h') && value === undefined) {
    console.log(usage)
    return 0
  }
  if (!value) throw new Error(usage)
  if (action === 'preview' && !rest.length) {
    const html = await renderScreen({
      provider: 'chatgpt',
      host: 'example.com',
      mode: 'browser',
      state: 'checking',
      preview: true,
    })
    writeFileSync(value, html, {flag: 'wx', mode: 0o600})
    console.log('Open this offline preview in your browser: ' + value)
    return 0
  }
  if (action === 'pair' && !rest.length) {
    return finishPair(await pairDevice(value, await codeFromStdin()))
  }
  if (action === 'select' && rest.length === 1) {
    await selectProfile(checkProvider(value), rest[0])
    console.log('Profile selected for ' + value + '.')
    return 0
  }
  if (action === 'profile' && !rest.length) {
    const state = await loadSession(checkProvider(value))
    console.log(await privateHome(state.provider, state.profile))
    return 0
  }
  if (action === 'open' && (!rest.length || (rest.length === 1 && rest[0] === '--console'))) {
    return launch(checkProvider(value), null, rest[0] === '--console')
  }
  if (action === 'run' && rest[0] === '--' && rest[1])
    return launch(checkProvider(value), rest.slice(1))
  throw new Error(usage)
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (e) {
  console.error('AI The Route: ' + e.message)
  process.exitCode = 1
}
