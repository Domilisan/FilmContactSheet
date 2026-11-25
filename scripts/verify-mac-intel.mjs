import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

assert.equal(process.platform, 'darwin', 'Run this verification on macOS')
const app = resolve(process.argv[2] || 'release/mac/PD Impression High Sierra.app')
const target = '10.13.6'
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim()
const newerThanTarget = version => {
  const left = version.split('.').map(Number), right = target.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0)
  }
  return false
}
const minimum = run('/usr/bin/plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', '-o', '-', join(app, 'Contents/Info.plist')])
assert.equal(minimum, target)
assert.equal(run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(app, 'Contents/Info.plist')]), 'studio.pdimpression.highsierra')
assert.equal(run('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', join(app, 'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist')]), '26.6.10')
const sharpPackage = JSON.parse(await readFile(join(app, 'Contents/Resources/app.asar.unpacked/node_modules/sharp/package.json'), 'utf8'))
assert.equal(sharpPackage.version, '0.32.6')
assert.equal(sharpPackage.config.libvips, '8.14.5')
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
const magicNumbers = new Set(['cffaedfe', 'feedfacf', 'cefaedfe', 'feedface', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'])
const binaries = []
async function scan(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) { await scan(path); continue }
    if (!entry.isFile()) continue // Framework symlinks point into directories already scanned.
    const handle = await open(path, 'r')
    const magic = Buffer.alloc(4)
    try { await handle.read(magic, 0, 4, 0) } finally { await handle.close() }
    if (!magicNumbers.has(magic.toString('hex'))) continue
    const architectures = run('/usr/bin/lipo', ['-archs', path]).split(/\s+/)
    assert(architectures.includes('x86_64'), `Missing Intel slice: ${path}`)
    // Electron helper names end in parentheses, e.g. "Helper (GPU)".
    // -m treats those as literal filenames instead of archive(member) syntax.
    const commands = run('/usr/bin/otool', ['-m', '-arch', 'x86_64', '-l', path])
    const versions = [...commands.matchAll(/cmd LC_BUILD_VERSION\s[\s\S]*?\bminos ([\d.]+)|cmd LC_VERSION_MIN_MACOSX\s[\s\S]*?\bversion ([\d.]+)/g)]
      .map(match => match[1] || match[2])
    assert(versions.length, `No macOS deployment target: ${path}`)
    for (const version of versions) assert(!newerThanTarget(version), `${path} requires macOS ${version}, newer than ${target}`)
    binaries.push({ path: path.slice(app.length + 1), architectures, minimumVersions: versions })
  }
}
await scan(join(app, 'Contents'))
// Save the inventory before presence checks so CI retains diagnostics on failure.
await mkdir('.test-output', { recursive: true })
await writeFile('.test-output/mac-intel-verification.json', JSON.stringify({ target, minimum, binaries }, null, 2))
assert(binaries.some(binary => binary.path.endsWith('MacOS/PD Impression High Sierra')), 'Missing application executable')
assert(binaries.some(binary => binary.path.endsWith('/sharp/build/Release/sharp-darwin-x64.node')), 'Missing Intel Sharp 0.32 native addon')
assert(binaries.some(binary => binary.path.endsWith('/sharp/vendor/8.14.5/darwin-x64/lib/libvips-cpp.42.dylib')), 'Missing Intel libvips 8.14.5')
console.log(`Verified ${binaries.length} Intel binaries and deployment targets <= macOS ${target}. High Sierra runtime testing is still required.`)
