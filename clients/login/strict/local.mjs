import {createServer} from 'node:http'
import {connect} from 'node:net'
import {once} from 'node:events'

export async function localProxy(password, enabled) {
  // The private namespace owns this loopback port. The loopback helper in
  // the host namespace still authenticates every CONNECT.
  const basic = 'Basic ' + Buffer.from('route:' + password).toString('base64')
  const local = createServer((_req, res) => res.writeHead(405).end())
  local.on('connection', (socket) => socket.on('error', () => {}))
  local.on('connect', (req, client, head) => {
    if (
      (!enabled() && req.headers['proxy-authorization'] !== basic) ||
      req.headers.origin ||
      !/^([a-z0-9-]+\.)+[a-z0-9-]+:\d{1,5}$/i.test(req.url ?? '')
    ) {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const relay = connect('/run/route/bridge')
    relay.once('error', () => client.destroy())
    client.once('close', () => relay.destroy())
    relay.once('close', () => client.destroy())
    relay.write(
      'CONNECT ' +
        req.url +
        ' HTTP/1.1\r\nHost: ' +
        req.url +
        '\r\nProxy-Authorization: ' +
        basic +
        '\r\n\r\n',
    )
    if (head.length) relay.write(head)
    client.pipe(relay).pipe(client)
  })
  local.listen(0, '127.0.0.1')
  await once(local, 'listening')
  return local.address().port
}
