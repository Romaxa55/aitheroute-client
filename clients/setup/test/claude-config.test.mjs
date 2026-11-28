import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {claudeFlags, conflicts, dropOurs, mergeJson} from '../claude-config.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'aitr-flags-'))

describe('mergeJson and claudeFlags', () => {
  it('creates, merges and leaves alone what is not a JSON object', () => {
    const dir = temp()
    const file = join(dir, 'deep', 'a.json')
    assert.equal(
      mergeJson(file, (c) => (c.one = 1)),
      true,
    )
    assert.equal(
      mergeJson(file, (c) => (c.two = 2)),
      true,
    )
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {one: 1, two: 2})
    for (const text of ['{broken', '[1]', 'null']) {
      writeFileSync(file, text)
      assert.equal(
        mergeJson(file, (c) => (c.x = 1)),
        false,
      )
      assert.equal(readFileSync(file, 'utf8'), text)
    }
  })

  it('marks the first run done and turns off the WebFetch preflight', () => {
    const home = temp()
    writeFileSync(join(home, '.claude.json'), '{"theme": "dark"}')
    assert.equal(claudeFlags({}, home), null)
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')), {
      theme: 'dark',
      hasCompletedOnboarding: true,
    })
    assert.equal(
      JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))
        .skipWebFetchPreflight,
      true,
    )
    const config = temp()
    assert.equal(claudeFlags({CLAUDE_CONFIG_DIR: config}, home), null)
    assert.equal(
      JSON.parse(readFileSync(join(config, '.claude.json'), 'utf8')).hasCompletedOnboarding,
      true,
    )
    assert.equal(
      JSON.parse(readFileSync(join(config, 'settings.json'), 'utf8')).skipWebFetchPreflight,
      true,
    )
  })

  it('names the file that is not a JSON object', () => {
    const home = temp()
    const config = temp()
    writeFileSync(join(config, 'settings.json'), '[1]')
    assert.equal(claudeFlags({CLAUDE_CONFIG_DIR: config}, home), join(config, 'settings.json'))
    writeFileSync(join(home, '.claude.json'), '{oops')
    assert.equal(claudeFlags({}, home), join(home, '.claude.json'))
  })
})

describe('conflicts and dropOurs', () => {
  const ORIGIN = 'https://gw.example'
  const settings = (data) => {
    const file = join(temp(), 'settings.json')
    writeFileSync(file, JSON.stringify(data))
    return file
  }

  it('finds nothing on a clean machine, or in a file that is not JSON', () => {
    const none = {shell: [], settings: [], ours: [], apiKey: false}
    assert.deepEqual(conflicts(ORIGIN, {}, join(temp(), 'missing.json')), none)
    const broken = join(temp(), 'settings.json')
    writeFileSync(broken, '{oops')
    assert.deepEqual(conflicts(ORIGIN, {}, broken), none)
  })

  it('names what in the shell would win over the sign-in', () => {
    const env = {
      ANTHROPIC_AUTH_TOKEN: 'x',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '0',
    }
    assert.deepEqual(conflicts(ORIGIN, env, settings({})).shell, [
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK',
    ])
    assert.equal(conflicts(ORIGIN, {ANTHROPIC_API_KEY: 'k'}, settings({})).apiKey, true)
  })

  it("tells another provider's settings from an earlier setup of ours", () => {
    const theirs = settings({
      env: {
        ANTHROPIC_BASE_URL: 'https://other.example',
        ANTHROPIC_AUTH_TOKEN: 'x',
        ANTHROPIC_API_KEY: 'k',
      },
      apiKeyHelper: '/bin/key',
    })
    const found = conflicts(ORIGIN, {}, theirs)
    assert.deepEqual(found.settings, [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'apiKeyHelper',
    ])
    assert.equal(found.apiKey, false)
    const ours = settings({
      env: {
        ANTHROPIC_BASE_URL: ORIGIN,
        ANTHROPIC_CUSTOM_HEADERS: 'x-aitheroute-token: atr_old',
        KEEP: '1',
      },
    })
    const mine = conflicts(ORIGIN, {}, ours)
    assert.deepEqual(mine.settings, [])
    assert.deepEqual(mine.ours, ['ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS'])
    assert.equal(dropOurs(mine.ours, ours), true)
    assert.deepEqual(JSON.parse(readFileSync(ours, 'utf8')).env, {KEEP: '1'})
    assert.equal(dropOurs([], ours), true)
  })

  it("takes the leak guard's address as ours, even after the gateway's has changed", () => {
    const guarded = settings({env: {ANTHROPIC_BASE_URL: 'https://old.example'}})
    assert.deepEqual(conflicts(ORIGIN, {}, guarded).settings, ['ANTHROPIC_BASE_URL'])
    const found = conflicts(ORIGIN, {}, guarded, 'https://old.example')
    assert.deepEqual([found.settings, found.ours], [[], ['ANTHROPIC_BASE_URL']])
  })
})
