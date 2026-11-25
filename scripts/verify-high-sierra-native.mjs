import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

// A portable check of the two downloaded, thin x86_64 Mach-O files. The full
// packaged-app verifier on Mac additionally checks every binary and its signature.
const packageJson = JSON.parse(await readFile('node_modules/sharp/package.json', 'utf8'))
assert.equal(packageJson.version, '0.32.6')
assert.equal(packageJson.config.libvips, '8.14.5')
const report = []
for (const file of [
  'node_modules/sharp/build/Release/sharp-darwin-x64.node',
  'node_modules/sharp/vendor/8.14.5/darwin-x64/lib/libvips-cpp.42.dylib'
]) {
  const bytes = await readFile(file)
  assert.equal(bytes.readUInt32LE(0), 0xfeedfacf, `Expected a little-endian 64-bit Mach-O: ${file}`)
  assert.equal(bytes.readUInt32LE(4), 0x01000007, `Expected Intel x86_64: ${file}`)
  const versions = []
  let offset = 32
  const end = offset + bytes.readUInt32LE(20)
  assert(end <= bytes.length, 'Truncated Mach-O header')
  for (let i = 0; i < bytes.readUInt32LE(16); i++) {
    assert(offset + 8 <= end, 'Truncated load command')
    const command = bytes.readUInt32LE(offset), size = bytes.readUInt32LE(offset + 4)
    assert(size >= 8 && offset + size <= end, 'Invalid load command size')
    if (command === 0x24 || command === 0x32) {
      assert(size >= (command === 0x24 ? 16 : 24))
      if (command === 0x32) assert.equal(bytes.readUInt32LE(offset + 8), 1, 'Expected macOS platform')
      const version = bytes.readUInt32LE(offset + (command === 0x24 ? 8 : 12))
      assert(version <= ((10 << 16) | (13 << 8) | 6), `${file} requires a newer system`)
      versions.push(`${version >>> 16}.${(version >>> 8) & 255}.${version & 255}`)
    }
    offset += size
  }
  assert(versions.length > 0, `Missing deployment target: ${file}`)
  report.push({ file, arch: 'x86_64', minimumVersions: versions, sha256: createHash('sha256').update(bytes).digest('hex') })
}
await mkdir('.test-output', { recursive: true })
await writeFile('.test-output/high-sierra-native.json', JSON.stringify({ target: '10.13.6', binaries: report }, null, 2))
console.log(JSON.stringify(report, null, 2))
