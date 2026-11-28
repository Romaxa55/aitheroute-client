import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {test} from 'node:test'
import {acceptOrigin} from '../origin-route.mjs'

test('only the paired DNS name and exact HTTPS port can select the Aitheroute socket', () => {
  for (const dest of [
    'example.org:8443',
    'gate.example:443',
    'gate.example:8443@other.example',
    '127.0.0.1:8443',
  ]) {
    assert.equal(acceptOrigin(dest, new URL('https://gate.example:8443'), null, null), false)
  }
  const socket = new EventEmitter()
  socket.write = () => {}
  socket.resume = () => {}
  socket.destroy = () => {
    socket.destroyed = true
    socket.emit('close')
  }
  let dials = 0
  assert.equal(
    acceptOrigin(
      'gate.example:8443',
      new URL('https://gate.example:8443'),
      socket,
      Buffer.from('plaintext'),
      () => dials++,
    ),
    true,
  )
  assert.equal(socket.destroyed, true)
  assert.equal(dials, 0)
})

test('verifies a real client SNI before sending model traffic to the paired gateway', async (t) => {
  const {createServer, connect} = await import('node:net')
  const {connect: tlsConnect} = await import('node:tls')
  const {once} = await import('node:events')
  const accepted = []
  const upstream = createServer((socket) => socket.once('data', () => socket.end()))
  const broker = createServer((client) => {
    const auth = new URL('https://gate.example:8443')
    acceptOrigin('gate.example:8443', auth, client, Buffer.alloc(0), (settings) => {
      accepted.push(settings)
      return connect(upstream.address().port, '127.0.0.1')
    })
  })
  for (const server of [upstream, broker]) {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => server.close())
  }
  const sendHello = async (servername) => {
    const client = connect(broker.address().port, '127.0.0.1')
    await once(client, 'data') // consume the 200 response before starting inner TLS
    const secure = tlsConnect({socket: client, servername})
    secure.on('error', () => {})
    await new Promise((resolve) => secure.once('close', resolve))
  }
  await sendHello('other.example')
  assert.deepEqual(accepted, [])
  await sendHello('gate.example')
  assert.deepEqual(accepted, [{host: 'gate.example', port: 8443}])
})
