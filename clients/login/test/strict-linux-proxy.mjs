import assert from 'node:assert/strict'
import {once} from 'node:events'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {join} from 'node:path'
import tls from 'node:tls'

export async function fixtureProxy(dir, host = 'chatgpt.com') {
  const pages = []
  const http = createServer((req, res) => {
    pages.push({
      host: req.headers.host,
      path: req.url,
      agent: req.headers['user-agent'],
      dest: req.headers['sec-fetch-dest'],
    })
    res
      .writeHead(200, {'content-type': 'text/html', connection: 'close'})
      .end('<title>Synthetic provider</title>')
  })
  const targets = [],
    sockets = new Set()
  let fault,
    transfers = 0,
    requests = 0
  const vendors = {}
  for (const prefix of ['fixture', 'wrong']) {
    const key = await readFile(join(dir, prefix + '-key.pem'))
    const cert = await readFile(join(dir, prefix + '-cert.pem'))
    vendors[prefix] = tls.createServer({key, cert}, (s) => {
      transfers++
      s.on('data', () => requests++)
      http.emit('connection', s)
    })
  }
  const password = '1'.repeat(32)
  const basic = 'Basic ' + Buffer.from('route:' + password).toString('base64')
  const server = createServer()
  server.on('connect', (req, client, head) => {
    sockets.add(client)
    client.on('error', () => {})
    client.once('close', () => sockets.delete(client))
    assert.equal(req.headers['proxy-authorization'], basic)
    targets.push(req.url)
    if (!['check.login.invalid:443', host + ':443'].includes(req.url)) {
      client.destroy()
      return
    }
    if (fault === 'revoked') {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) client.unshift(head)
    if (req.url === host + ':443') {
      vendors[fault === 'certificate' ? 'wrong' : 'fixture'].emit('connection', client)
    } else {
      let nonce = Buffer.alloc(0)
      client.on('data', (data) => {
        if (fault === 'drop') {
          client.destroy()
          return
        }
        nonce = Buffer.concat([nonce, data])
        assert.ok(nonce.length <= 32)
        if (nonce.length === 32) client.end(Buffer.concat([Buffer.from('AITR1'), nonce]))
      })
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    proxy: {port: server.address().port, password},
    targets,
    pages,
    get transfers() {
      return transfers
    },
    get requests() {
      return requests
    },
    fault(value) {
      fault = value
      if (value === 'offline') {
        server.close()
        for (const socket of sockets) socket.destroy()
      }
    },
    close() {
      for (const c of sockets) c.destroy()
      server.close()
    },
  }
}
