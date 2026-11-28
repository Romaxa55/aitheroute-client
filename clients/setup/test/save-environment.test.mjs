import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {privateBase, saveEnvironment} from '../env.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'aitr-save-'))
const mode = (path) => statSync(path).mode & 0o777
const unix = process.platform !== 'win32'

describe('saveEnvironment', {skip: !unix}, () => {
  it('keeps the values private in env.sh, loads it from the shell file, sets them here', () => {
    const dir = temp()
    const envFile = join(dir, 'aitheroute', 'env.sh')
    const rc = join(dir, '.zshrc')
    writeFileSync(rc, 'alias ll=ls\n')
    mkdirSync(join(dir, 'aitheroute'), {mode: 0o755})
    writeFileSync(envFile, 'old', {mode: 0o644})
    try {
      assert.equal(
        saveEnvironment({AITR_TEST_SAVED: 'v'}, ['/p'], 'darwin', undefined, envFile, rc),
        null,
      )
      const text = readFileSync(rc, 'utf8')
      assert.ok(text.startsWith('alias ll=ls\n') && text.includes(`. "${envFile}"`))
      assert.ok(!text.includes('AITR_TEST_SAVED'))
      assert.ok(readFileSync(envFile, 'utf8').includes("export AITR_TEST_SAVED='v'"))
      assert.equal(mode(envFile), 0o600)
      assert.equal(mode(join(dir, 'aitheroute')), 0o700)
      assert.equal(process.env.AITR_TEST_SAVED, 'v')
    } finally {
      delete process.env.AITR_TEST_SAVED
    }
  })

  it('says when only the shell file could not take the block, or nothing could be saved', () => {
    const dir = temp()
    // A folder where the file should be: no write gets through, not even as root.
    const rc = join(dir, '.zshrc')
    mkdirSync(rc)
    const envFile = join(dir, 'a', 'env.sh')
    assert.equal(
      saveEnvironment({AITR_TEST_RC: '1'}, [], 'linux', undefined, envFile, rc),
      'rcFailed',
    )
    assert.ok(readFileSync(envFile, 'utf8').includes('AITR_TEST_RC'))
    const blocked = join(dir, 'file')
    writeFileSync(blocked, '')
    assert.equal(
      saveEnvironment({AITR_TEST_RC: '1'}, [], 'linux', undefined, join(blocked, 'env.sh'), rc),
      'envFailed',
    )
    delete process.env.AITR_TEST_RC
  })

  it('makes an older, wider ~/.aitheroute private', () => {
    const base = join(temp(), '.aitheroute')
    mkdirSync(base, {mode: 0o755})
    privateBase(base, 'linux')
    assert.equal(mode(base), 0o700)
  })
})

describe('saveEnvironment on Windows', () => {
  it('hands the values over as JSON in the environment, not on the command line', () => {
    let seen
    const run = (program, args, options) => (
      (seen = {program, args, env: options.env}),
      {status: 0}
    )
    assert.equal(saveEnvironment({AITR_TEST_WIN: "a 'b'"}, ['C:\\x', 'C:\\y'], 'win32', run), null)
    assert.equal(seen.program, 'powershell.exe')
    assert.deepEqual(JSON.parse(seen.env.AITR_SET), {AITR_TEST_WIN: "a 'b'"})
    assert.equal(seen.env.AITR_PATHS, 'C:\\x;C:\\y')
    assert.ok(!seen.args.join(' ').includes("a 'b'"))
    assert.ok(seen.args.at(-1).includes('ExpandString'))
    assert.equal(
      saveEnvironment({}, [], 'win32', () => ({status: 1})),
      'envFailed',
    )
    delete process.env.AITR_TEST_WIN
  })
})
