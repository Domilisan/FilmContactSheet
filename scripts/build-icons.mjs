import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Keep the original mark inside a rounded app tile. Only generated application icons change.
const source = fileURLToPath(new URL('../pics/logo.jpg', import.meta.url))
const output = fileURLToPath(new URL('../build/', import.meta.url))
await mkdir(output, { recursive: true })
const sizes = [16, 24, 32, 48, 64, 128, 256]
const logo = await sharp(source).trim({ background: '#ffffff', threshold: 20 })
  .resize(212, 212, { fit: 'contain', background: '#ffffff' }).png().toBuffer()
const roundedTile = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect x="4" y="4" width="248" height="248" rx="53" fill="white"/></svg>')
const icon = await sharp({ create: { width: 256, height: 256, channels: 4, background: '#ffffff' } })
  .composite([{ input: logo, left: 22, top: 22 }, { input: roundedTile, blend: 'dest-in' }]).png().toBuffer()
const frames = await Promise.all(sizes.map(size => sharp(icon).resize(size, size).png().toBuffer()))
const directory = Buffer.alloc(6 + sizes.length * 16)
directory.writeUInt16LE(1, 2) // ICO image type
directory.writeUInt16LE(sizes.length, 4)
let offset = directory.length
frames.forEach((frame, index) => {
  const entry = 6 + index * 16
  directory[entry] = directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index]
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(frame.length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += frame.length
})
await writeFile(new URL('../build/icon.ico', import.meta.url), Buffer.concat([directory, ...frames]))
await writeFile(new URL('../build/icon.png', import.meta.url), frames.at(-1))
console.log('Application icons generated from pics/logo.jpg')
