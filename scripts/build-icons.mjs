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
// Native macOS icon representations, rendered from the source at Retina size.
const macLogo = await sharp(source).trim({ background: '#ffffff', threshold: 20 })
  .resize(848, 848, { fit: 'contain', background: '#ffffff' }).png().toBuffer()
const macMask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="16" y="16" width="992" height="992" rx="212" fill="white"/></svg>')
const macIcon = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ffffff' } })
  .composite([{ input: macLogo, left: 88, top: 88 }, { input: macMask, blend: 'dest-in' }]).png().toBuffer()
const macSizes = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]
const macEntries = await Promise.all(macSizes.map(async ([type, size]) => {
  const png = await sharp(macIcon).resize(size, size).png().toBuffer()
  const header = Buffer.alloc(8)
  header.write(type, 0, 4, 'ascii'); header.writeUInt32BE(png.length + 8, 4)
  return Buffer.concat([header, png])
}))
const macHeader = Buffer.alloc(8)
macHeader.write('icns'); macHeader.writeUInt32BE(8 + macEntries.reduce((sum, entry) => sum + entry.length, 0), 4)
await writeFile(new URL('../build/icon.icns', import.meta.url), Buffer.concat([macHeader, ...macEntries]))
console.log('Application icons generated from pics/logo.jpg')
