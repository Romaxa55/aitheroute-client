import assert from 'node:assert/strict'
import {once} from 'node:events'
import {connect} from 'node:net'
import {test} from 'node:test'
import {openProxy} from '../tunnel.mjs'

class Peer extends EventTarget {
  sent = []
  bufferedAmount = 0
  closed = false
  send(data) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
  message(data) {
    this.dispatchEvent(new MessageEvent('message', {data}))
  }
}

async function fixture(t) {
  const peer = new Peer()
  const proxy = await openProxy(
    'https://route.example',
    async () => 'session-secret',
    (url) => {
      assert.equal(url.href, 'wss://route.example/login/tunnel')
      setImmediate(() => peer.dispatchEvent(new Event('open')))
      return peer
    },
  )
  t.after(() => proxy.stop())
  const client = connect(proxy.port, '127.0.0.1')
  client.setTimeout(2500, () => client.destroy(new Error('test timeout')))
  await once(client, 'connect')
  t.after(() => client.destroy())
  const auth = 'Basic ' + Buffer.from('route:' + proxy.password).toString('base64')
  return {peer, client, auth}
}

test('CONNECT requires local proxy credentials', async (t) => {
  const {peer, client} = await fixture(t)
  client.write('CONNECT auth.example:443 HTTP/1.1\r\nHost: auth.example\r\n\r\n')
  assert.match(String((await once(client, 'data'))[0]), /407/)
  assert.deepEqual(peer.sent, [])
})

test('forwards TLS bytes only after the gateway confirms a CONNECT', async (t) => {
  const {peer, client, auth} = await fixture(t)
  client.write(
    'CONNECT auth.example:443 HTTP/1.1\r\nProxy-Authorization: ' + auth + '\r\n\r\nhello',
  )
  await new Promise((resolve, reject) => {
    const limit = setTimeout(() => {
      clearInterval(wait)
      reject(new Error('no handshake'))
    }, 1000)
    const wait = setInterval(() => {
      if (peer.sent.length) {
        clearTimeout(limit)
        clearInterval(wait)
        resolve()
      }
    }, 1)
  })
  assert.deepEqual(
    peer.sent.map((x) => JSON.parse(x)),
    [{credential: 'session-secret', host: 'auth.example', port: 443}],
  )
  const status = once(client, 'data')
  peer.message('ok')
  assert.match(String((await status)[0]), /200 Connection Established/)
  assert.equal(Buffer.from(peer.sent[1]).toString(), 'hello')
  client.write('second chunk')
  while (peer.sent.length < 3 && !client.destroyed) await new Promise((r) => setTimeout(r, 5))
  assert.equal(Buffer.from(peer.sent[2]).toString(), 'second chunk')
  const response = once(client, 'data')
  peer.message(Uint8Array.from([0, 255, 32]).buffer)
  assert.deepEqual((await response)[0], Buffer.from([0, 255, 32]))
})

test('a denied gateway handshake never opens a local tunnel', async (t) => {
  const {peer, client, auth} = await fixture(t)
  client.write('CONNECT auth.example:443 HTTP/1.1\r\nProxy-Authorization: ' + auth + '\r\n\r\n')
  while (!peer.sent.length && !client.destroyed) await new Promise((r) => setTimeout(r, 5))
  const response = once(client, 'data')
  peer.dispatchEvent(new Event('close'))
  assert.match(String((await response)[0]), /502/)
})
