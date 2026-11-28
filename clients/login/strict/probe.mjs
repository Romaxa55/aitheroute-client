import http from 'node:http'
import tls from 'node:tls'
import {randomBytes} from 'node:crypto'
import {error} from './system.mjs'

function tunnel(port, password, host, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'CONNECT',
      path: host + ':443',
      agent: false,
      signal,
      headers: {
        host: host + ':443',
        'proxy-authorization': 'Basic ' + Buffer.from('route:' + password).toString('base64'),
      },
    })
    req.on('error', reject)
    req.once('connect', (res, socket, head) => {
      if (res.statusCode !== 200 || head.length) {
        socket.destroy()
        reject(new Error('connection refused'))
        return
      }
      socket.on('error', () => {})
      resolve(socket)
    })
    req.end()
  })
}

async function nonceProof(socket, signal) {
  const nonce = randomBytes(32)
  const expected = Buffer.concat([Buffer.from('AITR1'), nonce])
  let received = 0
  socket.write(nonce)
  for await (const data of socket) {
    signal.throwIfAborted()
    if (!data.equals(expected.subarray(received, received + data.length))) break
    received += data.length
    if (received === expected.length) return
  }
  throw new Error('gateway verification failed')
}

export async function probe(port, password, host, signal = AbortSignal.timeout(15000)) {
  for (const destination of ['check.login.invalid', host]) {
    const challenge = destination === 'check.login.invalid'
    let code = challenge ? 'STRICT_GATEWAY_PROOF' : 'STRICT_PROVIDER_HOST'
    let socket
    const stop = () => socket?.destroy(error(code))
    try {
      socket = await tunnel(port, password, destination, signal)
      signal.addEventListener('abort', stop, {once: true})
      signal.throwIfAborted()
      if (challenge) await nonceProof(socket, signal)
      else {
        code = 'STRICT_PROVIDER_TLS'
        await new Promise((ok, fail) => {
          const secure = tls.connect({
            socket,
            servername: host,
            rejectUnauthorized: true,
            minVersion: 'TLSv1.2',
          })
          let verified = false
          secure.once('error', fail)
          secure.once('secureConnect', () => {
            verified = true
            secure.end()
          })
          secure.once('close', () => (verified ? ok() : fail(new Error('TLS closed'))))
        })
      }
      signal.throwIfAborted()
    } catch {
      throw error(code)
    } finally {
      signal.removeEventListener('abort', stop)
      socket?.destroy()
    }
  }
}
