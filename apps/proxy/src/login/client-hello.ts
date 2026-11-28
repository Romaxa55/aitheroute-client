/** Return null for a partial ClientHello. Reject malformed TLS before sending bytes to the exit. */
export const serverName = (input: Buffer): string | null => {
  if (input.length > 96 * 1024) throw new Error('oversized ClientHello')
  const fragments: Buffer[] = []
  let size = 0
  let expected: number | undefined
  for (let offset = 0; offset + 5 <= input.length;) {
    if (input[offset] !== 22 || input[offset + 1] !== 3) throw new Error('TLS handshake required')
    const length = input.readUInt16BE(offset + 3)
    if (!length || length > 16384) throw new Error('invalid TLS record')
    const end = offset + 5 + length
    if (end > input.length) return null
    fragments.push(input.subarray(offset + 5, end))
    size += length
    offset = end
    if (expected === undefined && size >= 4) {
      const header = Buffer.concat(fragments, 4)
      if (header[0] !== 1) throw new Error('ClientHello required')
      expected = 4 + header.readUIntBE(1, 3)
    }
    if (expected !== undefined && size >= expected)
      return nameInHello(Buffer.concat(fragments, expected).subarray(4))
  }
  return null
}

const nameInHello = (body: Buffer): string => {
  let pos = 34 // legacy version and random
  const field = (bytes: 1 | 2) => {
    const len = body.readUIntBE(pos, bytes)
    pos += bytes
    const start = pos
    pos += len
    if (pos > body.length) throw new Error('truncated ClientHello')
    return body.subarray(start, pos)
  }
  field(1) // legacy session id
  field(2) // cipher suites
  field(1) // compression
  const extensions = field(2)
  if (pos !== body.length) throw new Error('invalid ClientHello')
  let name: string | undefined
  for (let off = 0; off < extensions.length;) {
    const type = extensions.readUInt16BE(off)
    const len = extensions.readUInt16BE(off + 2)
    off += 4
    const end = off + len
    if (end > extensions.length) throw new Error('truncated extension')
    if (type === 0) {
      const data = extensions.subarray(off, end)
      if (data.readUInt16BE(0) !== len - 2 || data[2] !== 0 || data.readUInt16BE(3) !== len - 5)
        throw new Error('invalid server name')
      if (name !== undefined) throw new Error('duplicate server name')
      name = data.subarray(5).toString('latin1')
    }
    off = end
  }
  if (!name) throw new Error('server name required')
  return name
}
