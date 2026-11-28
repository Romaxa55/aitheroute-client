import {connect, isIP} from 'node:net'
import {serverName} from '../../apps/proxy/src/login/client-hello.ts'

// The authenticated model API has its own HTTPS origin on Aitheroute. Never
// give an isolated process a general TCP forwarder, even to a shared edge IP.
export function acceptOrigin(authority, origin, client, head, dial = connect) {
  const port = Number(origin.port || 443)
  if (authority !== origin.hostname + ':' + port || isIP(origin.hostname)) return false
  let upstream
  let hello = Buffer.alloc(0)
  const stop = () => {
    if (!client.destroyed) client.destroy()
    upstream?.destroy()
  }
  const timeout = setTimeout(stop, 10000)
  client.once('close', () => {
    clearTimeout(timeout)
    upstream?.destroy()
  })
  client.once('error', stop)
  const inspect = (chunk) => {
    try {
      hello = Buffer.concat([hello, chunk])
      const name = serverName(hello)
      if (name === null) return
      if (name !== origin.hostname) return stop()
      client.pause()
      client.off('data', inspect)
      upstream = dial({host: origin.hostname, port})
      upstream.once('error', stop)
      upstream.once('close', () => client.destroy())
      upstream.once('connect', () => {
        clearTimeout(timeout)
        upstream.write(hello)
        hello = Buffer.alloc(0)
        upstream.pipe(client)
        client.pipe(upstream)
      })
    } catch {
      stop()
    }
  }
  client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  client.on('data', inspect)
  if (head.length) inspect(head)
  if (!upstream && !client.destroyed) client.resume()
  return true
}
