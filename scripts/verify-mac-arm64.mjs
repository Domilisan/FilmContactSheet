import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'

assert.equal(process.platform, 'darwin', 'Run this verification on macOS')
assert.equal(process.arch, 'arm64', 'Use native Apple Silicon Node.js, not Rosetta')
const config = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const productName = config.build.productName
const app = resolve(process.argv[2] || `release/mac-arm64/${productName}.app`)
const target = config.build.mac.minimumSystemVersion
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim()
const plist = (file, key) => run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', file])
const newerThanTarget = version => {
  const left = version.split('.').map(Number), right = target.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0)
  }
  return false
}
const magicNumbers = new Set(['cffaedfe', 'feedfacf', 'cefaedfe', 'feedface', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'])
const report = { target, architecture: 'arm64', passed: false, binaries: [] }
async function scan(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) { await scan(path); continue }
    if (!entry.isFile()) continue // Framework symlinks refer to files scanned under Versions/.
    const handle = await open(path, 'r')
    const magic = Buffer.alloc(4)
    try { await handle.read(magic, 0, 4, 0) } finally { await handle.close() }
    if (!magicNumbers.has(magic.toString('hex'))) continue
    const architectures = run('/usr/bin/lipo', ['-archs', path]).split(/\s+/)
    assert(architectures.includes('arm64'), `Missing ARM64 slice: ${path}`)
    const commands = run('/usr/bin/otool', ['-m', '-arch', 'arm64', '-l', path])
    const versions = [...commands.matchAll(/cmd LC_BUILD_VERSION\s[\s\S]*?\bminos ([\d.]+)|cmd LC_VERSION_MIN_MACOSX\s[\s\S]*?\bversion ([\d.]+)/g)]
      .map(match => match[1] || match[2])
    const binary = { path: relative(app, path).replaceAll('\\', '/'), architectures, minimumVersions: versions }
    report.binaries.push(binary)
    assert(versions.length, `No macOS deployment target: ${path}`)
    for (const version of versions) assert(!newerThanTarget(version), `${path} requires macOS ${version}, newer than ${target}`)
  }
}
try {
  const info = join(app, 'Contents/Info.plist')
  report.minimum = plist(info, 'LSMinimumSystemVersion')
  assert.equal(report.minimum, target)
  assert.equal(plist(info, 'CFBundleIdentifier'), config.build.appId)
  assert.equal(plist(join(app, 'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist'), 'CFBundleVersion'), config.devDependencies.electron)
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  await scan(join(app, 'Contents'))
  assert(report.binaries.some(binary => binary.path.endsWith(`MacOS/${productName}`)), 'Missing application executable')
  assert(report.binaries.some(binary => /\/@img\/sharp-darwin-arm64\/lib\/sharp-darwin-arm64(?:-[^/]+)?\.node$/.test(binary.path)), 'Missing ARM64 Sharp addon')
  assert(report.binaries.some(binary => /\/@img\/sharp-libvips-darwin-arm64\/.*\.dylib$/.test(binary.path)), 'Missing ARM64 libvips')
  report.passed = true
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  throw error
} finally {
  await mkdir('.test-output', { recursive: true })
  await writeFile('.test-output/mac-arm64-verification.json', JSON.stringify(report, null, 2))
}
console.log(`Verified ${report.binaries.length} ARM64 binaries, signature and deployment targets <= macOS ${target}. Target Mac testing is still required.`)
