import {createServer, connect} from 'node:net'
import {once} from 'node:events'
import {createInterface} from 'node:readline'
import {error, wireCode} from './system.mjs'

export async function listen(path, connection) {
  const sockets = new Set()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
    connection(socket)
  })
  server.listen(path)
  await once(server, 'listening')
  return async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((ok) => server.close(ok))
  }
}

export const bridge = (port) => (socket) => {
  const dest = connect(port, '127.0.0.1')
  dest.on('error', () => socket.destroy())
  socket.once('close', () => dest.destroy())
  dest.once('close', () => socket.destroy())
  socket.pipe(dest).pipe(socket)
}

export function control(onEnded, onLost) {
  let peer,
    pending,
    finished = false
  const ready = Promise.withResolvers()
  ready.promise.catch(() => {})
  function attach(socket) {
    if (peer) {
      socket.destroy()
      return
    }
    peer = socket
    ready.resolve()
    const input = createInterface({input: socket, crlfDelay: Infinity})
    input.on('line', (line) => {
      try {
        const {ok, code, exit} = JSON.parse(line)
        if (Number.isInteger(exit) && exit >= 0 && exit <= 255) {
          finished = true
          onEnded(exit)
          return
        }
        if (!pending) throw error('STRICT_NETWORK')
        const active = pending
        pending = null
        if (ok === true) active.resolve()
        else active.reject(error(wireCode(code)))
      } catch {
        socket.destroy()
      }
    })
    socket.once('close', () => {
      pending?.reject(error('STRICT_NETWORK'))
      pending = null
      if (!finished) onLost()
    })
  }
  return {
    attach,
    ready: ready.promise,
    request(message) {
      if (!peer || peer.destroyed || pending) return Promise.reject(error('STRICT_NETWORK'))
      pending = Promise.withResolvers()
      peer.write(JSON.stringify(message) + '\n')
      return pending.promise
    },
  }
}
