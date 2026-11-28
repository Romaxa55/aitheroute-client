import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {envScript, rcFile, shellBlock, withBlock, writeBlock} from '../env.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'aitr-env-'))
const sh = (script) =>
  spawnSync('sh', ['-c', script], {encoding: 'utf8', env: {PATH: '/usr/bin:/bin'}}).stdout

describe('rcFile', () => {
  it('follows the shell, ZDOTDIR and the platform', () => {
    assert.equal(rcFile({SHELL: '/bin/zsh', ZDOTDIR: '/z'}, '/h', 'darwin'), '/z/.zshrc')
    assert.equal(rcFile({SHELL: '/bin/zsh'}, '/h', 'darwin'), '/h/.zshrc')
    assert.equal(rcFile({SHELL: '/usr/bin/bash'}, '/h', 'linux'), '/h/.bashrc')
    assert.equal(rcFile({SHELL: '/bin/fish'}, '/h', 'linux'), '/h/.profile')
    assert.equal(rcFile({}, '/h', 'linux'), '/h/.profile')
  })

  it('on macOS bash, takes the login file that is there rather than hide it', () => {
    const home = temp()
    assert.equal(rcFile({SHELL: '/bin/bash'}, home, 'darwin'), join(home, '.bash_profile'))
    writeFileSync(join(home, '.profile'), '')
    assert.equal(rcFile({SHELL: '/bin/bash'}, home, 'darwin'), join(home, '.profile'))
    writeFileSync(join(home, '.bash_login'), '')
    assert.equal(rcFile({SHELL: '/bin/bash'}, home, 'darwin'), join(home, '.bash_login'))
  })
})

describe('envScript and the block', () => {
  it('quotes every value for sh', () => {
    const script = envScript({A: "it's $HOME", B: 'x-aitheroute-token: atr_1'}, [
      '/h/claude/bin',
      '/odd $dir',
    ])
    const out = sh(script + 'printf "%s|%s|%s" "$A" "$B" "$PATH"')
    assert.equal(out, "it's $HOME|x-aitheroute-token: atr_1|/h/claude/bin:/odd $dir:/usr/bin:/bin")
    assert.ok(!envScript({A: '1'}, []).includes('PATH'))
  })

  it('loads env.sh only while it exists', () => {
    const file = join(temp(), 'env.sh')
    const load = shellBlock(file) + '\nprintf "%s" "${A-unset}"'
    assert.equal(sh(load), 'unset')
    writeFileSync(file, envScript({A: 'set'}, []))
    assert.equal(sh(load), 'set')
  })

  it('replaces its own block, keeps the rest and puts the block last', () => {
    const once = withBlock('alias ll=ls\n', shellBlock('/a/env.sh'))
    const twice = withBlock(once + 'export LATER=1\n', shellBlock('/b/env.sh'))
    assert.equal(twice.match(/>>> AI The Route >>>/g).length, 1)
    assert.ok(twice.startsWith('alias ll=ls\n\nexport LATER=1\n\n'))
    assert.ok(twice.endsWith('. "/b/env.sh"\n# <<< AI The Route <<<\n'))
    assert.equal(withBlock('', 'B'), 'B\n')
  })

  it('leaves a file with the block alone, and only appends to one not in UTF-8', () => {
    const dir = temp()
    const rc = join(dir, '.zshrc')
    writeBlock(rc, shellBlock('/a/env.sh'))
    const text = readFileSync(rc, 'utf8')
    writeBlock(rc, shellBlock('/a/env.sh'))
    assert.equal(readFileSync(rc, 'utf8'), text)
    const legacy = join(dir, '.profile')
    const cp1251 = Buffer.from([0x23, 0x20, 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x0a])
    writeFileSync(legacy, cp1251)
    writeBlock(legacy, shellBlock('/a/env.sh'))
    const after = readFileSync(legacy)
    assert.ok(after.subarray(0, cp1251.length).equals(cp1251))
    assert.ok(after.toString('latin1').includes('>>> AI The Route >>>'))
  })
})
