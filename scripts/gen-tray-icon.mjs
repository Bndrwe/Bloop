// Generates resources/trayTemplate.png (16x16) and trayTemplate@2x.png (32x32):
// a black paw print on transparent background (macOS "template" image).
// Usage: node scripts/gen-tray-icon.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// Paw shapes in a 0..1 unit square: [cx, cy, rx, ry]
const SHAPES = [
  [0.5, 0.68, 0.24, 0.2], // main pad
  [0.2, 0.42, 0.095, 0.12], // toes
  [0.38, 0.25, 0.1, 0.13],
  [0.62, 0.25, 0.1, 0.13],
  [0.8, 0.42, 0.095, 0.12]
]
function inside(x, y) {
  return SHAPES.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1)
}
function render(size) {
  const ss = 4
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) if (inside((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size)) hits++
      const i = (y * size + x) * 4
      buf[i] = buf[i + 1] = buf[i + 2] = 0
      buf[i + 3] = Math.round((255 * hits) / (ss * ss))
    }
  return encodePng(size, buf)
}

mkdirSync(join(root, 'resources'), { recursive: true })
writeFileSync(join(root, 'resources/trayTemplate.png'), render(16))
writeFileSync(join(root, 'resources/trayTemplate@2x.png'), render(32))
console.log('wrote resources/trayTemplate.png and trayTemplate@2x.png')
