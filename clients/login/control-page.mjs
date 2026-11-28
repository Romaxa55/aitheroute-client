import {randomBytes} from 'node:crypto'
import {createServer} from 'node:http'
import {once} from 'node:events'

export async function controlPage(render, act) {
  const path = '/' + randomBytes(24).toString('hex') + '/'
  const csp =
    "default-src 'none'; connect-src 'self'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
    "form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  let host
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    // Chromium serializes the Origin on ordinary form POSTs as null under no-referrer.
    res.setHeader('referrer-policy', 'same-origin')
    res.setHeader('content-security-policy', csp)
    res.setHeader('x-content-type-options', 'nosniff')
    const reject = (status) => res.writeHead(status, {connection: 'close'}).end()
    if (req.headers.host !== host) return reject(403)
    try {
      if (req.method === 'GET' && req.url === path) {
        const html = await render()
        return res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end(html)
      }
      const action = req.url?.startsWith(path) ? req.url.slice(path.length) : ''
      if (
        req.method !== 'POST' ||
        !/^(continue|retry|stop|profile-(clean|reuse)-[a-f0-9]{32})$/.test(action)
      )
        return reject(404)
      if (req.headers.origin !== 'http://' + host) return reject(403)
      if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) > 1024)
        return reject(413)
      req.resume()
      await act(action)
      res.writeHead(303, {location: path}).end()
    } catch {
      reject(500)
    }
  })
  server.requestTimeout = 10000
  server.headersTimeout = 8000
  server.maxConnections = 24
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  host = '127.0.0.1:' + server.address().port
  return {
    url: 'http://' + host + path,
    close: () => {
      server.close()
      server.closeAllConnections()
    },
  }
}
