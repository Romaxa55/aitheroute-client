import {randomBytes, timingSafeEqual} from 'node:crypto'
import {createServer} from 'node:http'
import {isIP} from 'node:net'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'

import {acceptOrigin} from './origin-route.mjs'

const capacity = 1024 * 1024
const forbid = (socket, status, extra = '') =>
  socket.end(
    'HTTP/1.1 ' + status + '\r\n' + extra + 'Connection: close\r\nContent-Length: 0\r\n\r\n',
  )

async function sendClientBytes(socket, peer, head) {
  if (head.length) peer.send(head)
  for await (const bytes of socket) {
    while (!socket.destroyed && !socket.writableEnded && peer.bufferedAmount >= capacity)
      await delay(10)
    if (socket.destroyed || socket.writableEnded) break
    for (let i = 0; i < bytes.length; i += 16384) peer.send(bytes.subarray(i, i + 16384))
  }
}

async function bridge(socket, head, url, host, lease, dial) {
  let peer
  let established = false
  const stop = () => {
    try {
      peer?.close()
    } catch {}
  }
  const fail = () => {
    if (!socket.destroyed && !socket.writableEnded) {
      if (established) socket.end()
      else forbid(socket, '502 Login gateway unavailable')
    }
    stop()
  }
  const deadline = setTimeout(fail, 20000)
  socket.once('close', () => {
    clearTimeout(deadline)
    stop()
  })
  try {
    const credential = await lease()
    if (socket.destroyed || socket.writableEnded) return
    peer = dial(url)
    peer.binaryType = 'arraybuffer'
    peer.addEventListener('open', () => {
      try {
        peer.send(JSON.stringify({credential, host, port: 443}))
      } catch {
        fail()
      }
    })
    peer.addEventListener('error', fail)
    peer.addEventListener('close', fail)
    peer.addEventListener('message', ({data}) => {
      try {
        if (socket.destroyed || socket.writableEnded) return
        if (!established) {
          if (data !== 'ok') return fail()
          clearTimeout(deadline)
          established = true
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          void sendClientBytes(socket, peer, head).then(stop, fail)
        } else {
          if (!(data instanceof ArrayBuffer) || data.byteLength + socket.writableLength > capacity)
            return fail()
          socket.write(new Uint8Array(data))
        }
      } catch {
        fail()
      }
    })
  } catch {
    fail()
  }
}

export async function openProxy(origin, lease, dial = (url) => new WebSocket(url)) {
  const url = new URL('/login/tunnel', origin)
  url.protocol = 'wss:'
  const password = randomBytes(16).toString('hex')
  const expected = Buffer.from('Basic ' + Buffer.from('route:' + password).toString('base64'))
  const sockets = new Set()
  // Web pages, web sockets and absolute-form HTTP requests cannot use this listener.
  const server = createServer((_req, res) => res.writeHead(405, {connection: 'close'}).end())
  server.on('upgrade', (_req, socket) => forbid(socket, '405 Method Not Allowed'))
  server.on('connection', (socket) => {
    socket.once('error', () => socket.destroy())
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.maxConnections = 64
  server.headersTimeout = 15000
  server.on('connect', (req, socket, head) => {
    socket.pause()
    const actual = Buffer.from(req.headers['proxy-authorization'] ?? '')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return forbid(
        socket,
        '407 Proxy Authentication Required',
        'Proxy-Authenticate: Basic realm="AI The Route local helper"\r\n',
      )
    if (!req.headers.origin && acceptOrigin(req.url, new URL(origin), socket, head)) return
    const host = /^([a-z0-9.-]+):443$/i.exec(req.url ?? '')?.[1]?.toLowerCase()
    if (!host || isIP(host) || !host.includes('.') || host.endsWith('.') || req.headers.origin)
      return forbid(socket, '403 Forbidden')
    void bridge(socket, head, url, host, lease, dial)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    port: server.address().port,
    password,
    stop: () => {
      server.close()
      for (const socket of sockets) socket.destroy()
    },
  }
}
