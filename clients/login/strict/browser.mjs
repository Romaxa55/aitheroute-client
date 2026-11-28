import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {error} from './system.mjs'

export async function browserSession(browser, port, onExit) {
  const args = [
    '--user-data-dir=/tmp/browser',
    '--ozone-platform=x11',
    '--remote-debugging-pipe',
    '--proxy-server=http://127.0.0.1:' + port,
    '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
    '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-features=EncryptedClientHello',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]
  const child = spawn(browser, args, {stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']})
  let text = '',
    next = 0
  const calls = new Map()
  const ended = (status) => {
    for (const pending of calls.values()) pending.reject(error('STRICT_BROWSER'))
    calls.clear()
    onExit(Number.isInteger(status) ? status : 1)
  }
  child.once('exit', ended)
  child.once('error', ended)
  child.stdio[3].on('error', () => {})
  child.stdio[4].setEncoding('utf8')
  child.stdio[4].on('data', (chunk) => {
    text += chunk
    if (text.length > 1048576) {
      child.kill()
      return
    }
    let boundary
    while ((boundary = text.indexOf('\0')) >= 0) {
      const data = text.slice(0, boundary)
      text = text.slice(boundary + 1)
      try {
        const frame = JSON.parse(data),
          pending = calls.get(frame.id)
        if (!pending) continue
        calls.delete(frame.id)
        if (frame.error) pending.reject(error('STRICT_BROWSER'))
        else pending.resolve(frame.result)
      } catch {
        child.kill()
      }
    }
  })
  function request(method, params = {}) {
    const id = ++next
    const pending = Promise.withResolvers()
    calls.set(id, pending)
    child.stdio[3].write(JSON.stringify({id, method, params}) + '\0')
    return pending.promise
  }
  await once(child, 'spawn')
  const tabs = await request('Target.getTargets')
  if (!tabs.targetInfos.some((tab) => tab.type === 'page' && tab.url === 'about:blank'))
    throw error('STRICT_BROWSER')
  return {open: (url) => request('Target.createTarget', {url})}
}
