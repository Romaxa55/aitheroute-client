import {createServer} from 'node:http'
import {connect} from 'node:net'
import {once} from 'node:events'

// A desktop browser cannot answer a proxy's 407 without a prompt, so
// on macOS and Windows it uses this loopback relay. The relay adds the helper's
// credential and passes CONNECT on to the authenticated tunnel listener, which
// still allows only the paired provider's hosts through the gateway.
export async function relay(target, password) {
  const basic = 'Basic ' + Buffer.from('route:' + password).toString('base64')
  const sockets = new Set()
  const server = createServer((_req, res) => res.writeHead(405, {connection: 'close'}).end())
  server.on('upgrade', (_req, socket) => socket.destroy())
  server.on('connection', (socket) => {
    socket.on('error', () => socket.destroy())
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.maxConnections = 64
  server.headersTimeout = 15000
  server.on('connect', (req, client, head) => {
    // A name on 443 only, never an address: the gateway allows no more.
    if (req.headers.origin || !/^([a-z0-9-]+\.)+[a-z][a-z0-9-]*:443$/i.test(req.url ?? ''))
      return client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    const upstream = connect(target, '127.0.0.1')
    upstream.once('error', () => client.destroy())
    client.once('close', () => upstream.destroy())
    upstream.once('close', () => client.destroy())
    upstream.write(
      'CONNECT ' +
        req.url +
        ' HTTP/1.1\r\nHost: ' +
        req.url +
        '\r\nProxy-Authorization: ' +
        basic +
        '\r\n\r\n',
    )
    if (head.length) upstream.write(head)
    client.pipe(upstream).pipe(client)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    port: server.address().port,
    stop: () => {
      server.close()
      for (const socket of sockets) socket.destroy()
    },
  }
}
