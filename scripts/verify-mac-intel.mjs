import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, open, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

assert.equal(process.platform, 'darwin', 'Run this verification on macOS')
const app = resolve(process.argv[2] || 'release/mac/PD Impression.app')
const target = '13.7.1'
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
assert(binaries.some(binary => binary.path.endsWith('MacOS/PD Impression')), 'Missing application executable')
assert(binaries.some(binary => binary.path.endsWith('sharp-darwin-x64.node')), 'Missing Intel Sharp native addon')
await mkdir('.test-output', { recursive: true })
await writeFile('.test-output/mac-intel-verification.json', JSON.stringify({ target, minimum, binaries }, null, 2))
console.log(`Verified ${binaries.length} Intel binaries and deployment targets <= macOS ${target}. Ventura runtime testing is still required.`)
