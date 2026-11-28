import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {CORE, SETUP} from './unpacked.mjs'

describe('the archive', () => {
  it("ships every module of the core and everything they import (package-setup.py's CORE)", () => {
    const modules = readdirSync(SETUP).filter((name) => name.endsWith('.mjs'))
    assert.deepEqual(
      modules.filter((name) => !CORE.includes(name)),
      [],
    )
    for (const name of modules)
      for (const [, dep] of readFileSync(join(SETUP, name), 'utf8').matchAll(/from '\.\/([^']+)'/g))
        assert.ok(CORE.includes(dep), `${name} imports ${dep}, which the archive lacks`)
    assert.ok(CORE.includes('ru.json') && CORE.includes('en.json'))
  })
})
