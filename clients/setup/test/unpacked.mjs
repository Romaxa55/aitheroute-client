import {spawnSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

/** The archive as it unpacks, for the start.sh tests, and start.sh run detached in a new home. */

export const SETUP = join(dirname(fileURLToPath(import.meta.url)), '..')
export const words = (lang) => JSON.parse(readFileSync(join(SETUP, lang + '.json'), 'utf8'))
/** The core's files as the archive packer lists them (package-setup.py's CORE): the one list. */
const packer = readFileSync(join(SETUP, 'package-setup.py'), 'utf8')
export const CORE = [.../^CORE = \(([^)]*)\)/m.exec(packer)[1].matchAll(/'([^']+)'/g)].map(
  (m) => m[1],
)

export const unpacked = () => {
  const dir = mkdtempSync(join(tmpdir(), 'aitr-start-'))
  cpSync(join(SETUP, 'bundle'), dir, {recursive: true})
  mkdirSync(join(dir, 'setup'))
  for (const name of CORE) cpSync(join(SETUP, name), join(dir, 'setup', name))
  // The helper as the archive holds it: its own folder, the gateway's one shared file beside.
  const helper = join(dir, 'helper')
  cpSync(join(SETUP, '..', 'login'), join(helper, 'clients', 'login'), {
    recursive: true,
    filter: (path) => !path.includes(join('login', 'test')),
  })
  const hello = join(helper, 'apps', 'proxy', 'src', 'login')
  mkdirSync(hello, {recursive: true})
  cpSync(
    join(SETUP, '..', '..', 'apps', 'proxy', 'src', 'login', 'client-hello.ts'),
    join(hello, 'client-hello.ts'),
  )
  writeFileSync(join(hello, 'package.json'), '{"type": "module"}\n')
  return dir
}

export const start = (dir, env, args = []) =>
  new Promise((resolve) => {
    const home = mkdtempSync(join(tmpdir(), 'aitr-home-'))
    const out = spawnSync('sh', [join(dir, 'start.sh'), ...args], {
      env: {HOME: home, PATH: dirname(process.execPath) + ':/usr/bin:/bin', ...env},
      encoding: 'utf8',
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    resolve({...out, home})
  })
