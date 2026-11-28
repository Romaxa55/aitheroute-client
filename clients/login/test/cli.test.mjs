import assert from 'node:assert/strict'
import {spawn, spawnSync} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createInterface} from 'node:readline'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

const program = fileURLToPath(new URL('../cli.mjs', import.meta.url))
test('help and the offline preview work before pairing', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'aitr-preview-'))
  t.after(() => rm(folder, {force: true, recursive: true}))
  const help = spawnSync(process.execPath, [program, '--help'], {encoding: 'utf8'})
  assert.equal(help.status, 0)
  assert.match(help.stdout, /pair HTTPS_ORIGIN/)
  const output = join(folder, 'sample.html')
  const preview = () => spawnSync(process.execPath, [program, 'preview', output])
  assert.equal(preview().status, 0)
  assert.match(await readFile(output, 'utf8'), /<html/i)
  assert.equal(preview().status, 1)
})

test(
  'ordinary run opens the local gate, and a blocked session cannot execute the requested CLI',
  {timeout: 15000},
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), 'aitr-gated-cli-'))
    t.after(() => rm(folder, {force: true, recursive: true}))
    const marker = join(folder, 'ran')
    const child = spawn(
      process.execPath,
      [
        program,
        'run',
        'chatgpt',
        '--',
        process.execPath,
        '-e',
        'require("node:fs").writeFileSync(process.argv[1],"started")',
        marker,
      ],
      {env: {...process.env, HOME: folder, USERPROFILE: folder}, stdio: ['ignore', 'pipe', 'pipe']},
    )
    t.after(() => child.kill())
    const exit = once(child, 'exit')
    const lines = createInterface({input: child.stdout})
    t.after(() => lines.close())
    const [line] = await once(lines, 'line')
    const url = new URL(line.match(/http:\/\/127\.0\.0\.1:\d+\/\w+\//)[0])
    const click = (action) =>
      fetch(new URL(action, url), {
        method: 'POST',
        headers: {origin: url.origin},
        redirect: 'manual',
      })
    const html = await (await fetch(url)).text()
    assert.ok(!html.includes('action="continue"'))
    assert.equal((await click('continue')).status, 303)
    assert.equal((await click('stop')).status, 303)
    assert.equal((await exit)[0], 130)
    await assert.rejects(stat(marker), {code: 'ENOENT'})
  },
)

// A closed terminal window sends SIGHUP (on Windows too: Node turns the
// console's close into it); Ctrl+C sends SIGINT. Each must end the helper
// through its cleanup - the browser and its temporary profile go - not kill it.
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'])
  test(
    `${signal} ends the helper like its stop button`,
    // On Windows child.kill() ends a process outright: no signal to hear.
    {timeout: 15000, skip: process.platform === 'win32'},
    async (t) => {
      const folder = await mkdtemp(join(tmpdir(), 'aitr-signal-cli-'))
      t.after(() => rm(folder, {force: true, recursive: true}))
      const child = spawn(process.execPath, [program, 'run', 'chatgpt', '--', process.execPath], {
        env: {...process.env, HOME: folder, USERPROFILE: folder},
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      t.after(() => child.kill('SIGKILL'))
      const exit = once(child, 'exit')
      const lines = createInterface({input: child.stdout})
      t.after(() => lines.close())
      await once(lines, 'line')
      child.kill(signal)
      assert.deepEqual(await exit, [130, null])
    },
  )
