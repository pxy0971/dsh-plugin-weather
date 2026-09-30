// Minimal asar reader: extract the JSON header index and optionally one file.
import fs from 'node:fs'

const [asarPath, mode, target] = process.argv.slice(2)
const fd = fs.openSync(asarPath, 'r')
const sizeBuf = Buffer.alloc(16)
fs.readSync(fd, sizeBuf, 0, 16, 0)
const headerSize = sizeBuf.readUInt32LE(12)
const headerBuf = Buffer.alloc(headerSize)
fs.readSync(fd, headerBuf, 0, headerSize, 16)
const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''))
const baseOffset = 16 + headerSize

function walk(node, prefix, out) {
  for (const [key, value] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${key}` : key
    if (value.files) walk(value, p, out)
    else out.push({ path: p, size: value.size, offset: value.offset })
  }
  return out
}

const entries = walk(header, '', [])

if (mode === 'list') {
  const filter = target ? new RegExp(target, 'i') : null
  for (const e of entries) {
    if (!filter || filter.test(e.path)) console.log(`${e.size}\t${e.path}`)
  }
  console.log(`# total entries: ${entries.length}`)
} else if (mode === 'read') {
  const entry = entries.find(e => e.path === target)
  if (!entry) { console.error('not found: ' + target); process.exit(2) }
  const buf = Buffer.alloc(Number(entry.size))
  fs.readSync(fd, buf, 0, buf.length, baseOffset + Number(entry.offset))
  process.stdout.write(buf)
} else if (mode === 'extract') {
  const filter = new RegExp(target, 'i')
  const outRoot = process.argv[5]
  let n = 0
  for (const e of entries) {
    if (!filter.test(e.path)) continue
    const dest = `${outRoot}/${e.path}`
    fs.mkdirSync(dest.slice(0, dest.lastIndexOf('/')), { recursive: true })
    const buf = Buffer.alloc(Number(e.size))
    if (buf.length) fs.readSync(fd, buf, 0, buf.length, baseOffset + Number(e.offset))
    fs.writeFileSync(dest, buf)
    n++
  }
  console.log(`extracted ${n} files to ${outRoot}`)
}
fs.closeSync(fd)
