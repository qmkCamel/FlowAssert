import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'
import sharp from 'sharp'
import { externalLimits } from './workbench-external-contracts.js'

export async function readExternalFile(path: string, limit: number): Promise<Buffer> {
  const full = resolve(path), root = parse(full).root
  const parents: Array<{ path: string; dev: number; ino: number }> = []
  for (let cursor = dirname(full); ; cursor = dirname(cursor)) {
    const stat = await lstat(cursor)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('external-unsafe-path')
    parents.push({ path: cursor, dev: stat.dev, ino: stat.ino })
    if (cursor === root) break
  }
  const before = await lstat(full)
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > limit) throw new Error('external-file-budget')
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const start = await handle.stat()
    if (!start.isFile() || start.dev !== before.dev || start.ino !== before.ino || start.size !== before.size) throw new Error('external-file-changed')
    const bytes = Buffer.alloc(start.size)
    let offset = 0
    while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) throw new Error('external-file-changed'); offset += read.bytesRead }
    const end = await handle.stat(), current = await lstat(full)
    if (end.size !== start.size || end.mtimeMs !== start.mtimeMs || end.ctimeMs !== start.ctimeMs || current.ino !== start.ino || current.dev !== start.dev || current.isSymbolicLink()) throw new Error('external-file-changed')
    for (const parent of parents) { const stat = await lstat(parent.path); if (stat.isSymbolicLink() || stat.dev !== parent.dev || stat.ino !== parent.ino) throw new Error('external-file-changed') }
    return bytes
  } finally { await handle.close() }
}
export async function validateExternalAttachment(bytes: Buffer, type: string): Promise<void> {
  if (!bytes.length || bytes.length > externalLimits.attachment) throw new Error('external-attachment-budget')
  if (type === 'image/png' || type === 'image/jpeg') {
    const image = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: 'warning' }), meta = await image.metadata()
    if (meta.format !== (type === 'image/png' ? 'png' : 'jpeg') || !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096 || (meta.pages ?? 1) !== 1) throw new Error('external-image-type')
    await image.raw().toBuffer(); return
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (text.includes('\0') || /<\s*(?:!?doctype\s+html|html|svg|script)\b/i.test(text) || /^#!|^\s*(?:import\s|export\s|(?:const|let|var)\s+\w+\s*=)/.test(text)) throw new Error('external-active-content')
  if (type === 'application/json') JSON.parse(text)
  else if (type === 'application/xml') {
    const { SaxesParser } = await import('saxes'), parser = new SaxesParser(); let depth = 0
    parser.on('doctype', () => { throw new Error('external-doctype-forbidden') }); parser.on('processinginstruction', () => { throw new Error('external-instruction-forbidden') })
    parser.on('opentag', () => { if (++depth > 16) throw new Error('external-xml-budget') }); parser.on('closetag', () => { depth-- })
    parser.on('error', () => { throw new Error('external-invalid-xml') }); parser.write(text).close()
  } else if (type !== 'text/plain') throw new Error('external-attachment-type')
}
