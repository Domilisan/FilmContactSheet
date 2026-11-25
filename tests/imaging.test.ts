import { beforeAll, afterAll, expect, test } from 'vitest'
import sharp from 'sharp'
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectPhoto, exportSheet, writeSizeLimitedJpeg } from '../src/main/imaging'
import { MAX_EXPORT_BYTES } from '../src/shared/export-settings'
import { newProject, addAssets, defaultTemplate } from '../src/shared/model'
import { layoutSheet, newScanProject } from '../src/shared/layout'
import { scanProfiles, rotationForProfile } from '../src/shared/scan-types'

let dir: string
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'pdimpression-test-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

test('reads 16-bit TIFF, exports original pixels with correct geometry and ICC', async () => {
  const source = join(dir, 'scan.tif')
  await sharp({ create: { width: 360, height: 240, channels: 3, background: '#e83020' } })
    .toColourspace('rgb16').withMetadata().tiff({ compression: 'lzw' }).toFile(source)
  const original = await readFile(source)
  const asset = await inspectPhoto(source)
  expect(asset.status).toBe('ready')
  expect(asset.depth).toBe('ushort')
  expect(asset.hasIcc).toBe(true)
  expect(asset.preview).toMatch(/^data:image\/jpeg;base64,/)
  const p = addAssets(newProject(), [asset])
  // Poison the editor thumbnail. Export MUST still read the TIFF on disk.
  p.slots[0]!.preview = 'data:image/jpeg;base64,invalid'
  const dest = join(dir, 'out.jpg')
  await exportSheet(p, 2000, 94, dest, join(dir, '.export.tmp'), () => {})
  const meta = await sharp(dest).metadata()
  expect(meta.width).toBe(2000)
  expect(meta.height).toBe(Math.round(2000 * Math.SQRT2))
  expect(meta.icc?.length).toBeGreaterThan(0)
  expect((await stat(dest)).size).toBeLessThanOrEqual(MAX_EXPORT_BYTES)
  // The fixed JPEG must render in the export, not merely exist as an SVG href.
  const logoRect = layoutSheet(p).logo
  const logo = await sharp(dest).extract({ left: Math.round(logoRect.x * 8), top: Math.round(logoRect.y * 8), width: 240, height: 240 }).removeAlpha().raw().toBuffer()
  let darkLogoPixels = 0
  for (let i = 0; i < logo.length; i += 3) if (logo[i] < 100 && logo[i + 1] < 100 && logo[i + 2] < 100) darkLogoPixels++
  expect(darkLogoPixels).toBeGreaterThan(1000)
  const frame = layoutSheet(p).frames[0]
  const sample = await sharp(dest).extract({ left: Math.round((frame.x + 18) * 8), top: Math.round((frame.y + 12) * 8), width: 1, height: 1 }).raw().toBuffer()
  expect(sample[0]).toBeGreaterThan(180)
  expect(sample[1]).toBeLessThan(100)
  expect(await readFile(source)).toEqual(original)
})

test.each(scanProfiles.filter(p => p.mode === 'strip' || p.id === 'half' || p.id === '645'))('$label exports complete TIFF content without cropping or internal separators', async profile => {
  const w = Math.round(profile.ratioWidth * 100), h = Math.round(profile.ratioHeight * 100)
  const source = join(dir, `${profile.id}.tif`)
  const svg = `<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#18bd38"/><rect width="${w / 3}" height="100%" fill="#e83020"/><rect x="${w * 2 / 3}" width="${w / 3}" height="100%" fill="#2048e8"/></svg>`
  await sharp(Buffer.from(svg)).toColourspace('rgb16').withMetadata().tiff().toFile(source)
  const original = await readFile(source)
  const asset = await inspectPhoto(source)
  asset.rotation = rotationForProfile(asset, profile)
  const p = addAssets(newScanProject(defaultTemplate, profile.id), [asset])
  const destination = join(dir, `${profile.id}.jpg`)
  await exportSheet(p, 1600, 94, destination, join(dir, `${profile.id}.tmp`), () => {})
  const layout = layoutSheet(p), frame = layout.frames[0], scale = 1600 / layout.width
  for (const [fraction, channel] of [[0.08, 0], [0.5, 1], [0.92, 2]]) {
    const pixel = await sharp(destination).extract({ left: Math.round((frame.x + frame.width * fraction) * scale),
      top: Math.round((frame.y + frame.height / 2) * scale), width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    expect(pixel[channel]).toBeGreaterThan(150)
    expect(pixel[(channel + 1) % 3]).toBeLessThan(100)
  }
  expect(await readFile(source)).toEqual(original)
}, 30000)

test('under-limit JPEG keeps the requested quality and identical encoded pixels', async () => {
  const pipeline = sharp({ create: { width: 320, height: 240, channels: 3, background: '#c47e3a' } }).withMetadata()
  const expected = await pipeline.clone().jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer()
  const output = join(dir, 'under-limit.jpg')
  let adjusted = false
  expect(await writeSizeLimitedJpeg(pipeline, output, 94, MAX_EXPORT_BYTES, () => { adjusted = true })).toBe(94)
  expect(adjusted).toBe(false)
  expect(await readFile(output)).toEqual(expected)
})

test('oversized JPEG adjusts quality while preserving dimensions and ICC', async () => {
  const pipeline = sharp(randomBytes(512 * 512 * 3), { raw: { width: 512, height: 512, channels: 3 } }).withMetadata()
  const high = await pipeline.clone().jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer()
  const low = await pipeline.clone().jpeg({ quality: 1, chromaSubsampling: '4:4:4' }).toBuffer()
  const budget = Math.floor((high.length + low.length) / 2)
  const output = join(dir, 'bounded.jpg')
  const quality = await writeSizeLimitedJpeg(pipeline, output, 94, budget)
  expect(quality).toBeLessThan(94)
  expect((await stat(output)).size).toBeLessThanOrEqual(budget)
  const metadata = await sharp(output).metadata()
  expect(metadata.width).toBe(512)
  expect(metadata.height).toBe(512)
  expect(metadata.icc?.length).toBeGreaterThan(0)
  const next = await pipeline.clone().jpeg({ quality: quality + 1, chromaSubsampling: '4:4:4' }).toBuffer()
  expect(next.length).toBeGreaterThan(budget)
})

test('impossible size limit reports failure instead of claiming successful export', async () => {
  const pipeline = sharp({ create: { width: 32, height: 32, channels: 3, background: '#fff' } })
  await expect(writeSizeLimitedJpeg(pipeline, join(dir, 'impossible.jpg'), 94, 1)).rejects.toThrow('无法满足文件大小上限')
})

test('corrupt file returns a visible error asset', async () => {
  const file = join(dir, 'bad.tif'); await writeFile(file, 'not a tiff')
  const asset = await inspectPhoto(file)
  expect(asset.status).toBe('error')
  expect(asset.error).toBeTruthy()
})

test('export cannot fall back to a cached preview after source disappears', async () => {
  const file = join(dir, 'missing.jpg')
  await sharp({ create: { width: 240, height: 360, channels: 3, background: '#00abff' } }).jpeg().toFile(file)
  const asset = await inspectPhoto(file)
  expect(asset.rotation).toBe(90)
  expect(asset.warning).toContain('ICC')
  await rm(file)
  await expect(exportSheet(addAssets(newProject(), [asset]), 1600, 90, join(dir, 'never.jpg'), join(dir, 'never.tmp'), () => {})).rejects.toThrow()
})
