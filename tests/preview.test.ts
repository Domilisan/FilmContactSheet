import { afterAll, beforeAll, expect, test } from 'vitest'
import sharp from 'sharp'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectPhoto } from '../src/main/imaging'
import { assetSchema, MAX_PREVIEW_LENGTH } from '../src/shared/model'
import { scanProfiles } from '../src/shared/scan-types'

let dir: string
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'pdimpression-preview-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })
const decode = (preview: string) => Buffer.from(preview.split(',')[1], 'base64')

test.each(scanProfiles.filter(p => p.mode === 'strip'))('$label keeps fine detail and both ends across the whole row', async profile => {
  const height = 960, width = Math.round(height * profile.ratioWidth / profile.ratioHeight)
  const source = join(dir, `${profile.id}.tif`)
  const svg = `<svg width="${width}" height="${height}">
    <defs><pattern id="detail" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="white"/><rect width="8" height="16" fill="black"/></pattern></defs>
    <rect width="100%" height="100%" fill="url(#detail)"/>
    <rect width="100" height="100%" fill="#ef2020"/><rect x="${width - 100}" width="100" height="100%" fill="#2030ef"/>
  </svg>`
  await sharp(Buffer.from(svg)).toColourspace('rgb16').withMetadata().tiff().toFile(source)
  const asset = await inspectPhoto(source)
  expect(asset.status).toBe('ready')
  const preview = decode(asset.preview), meta = await sharp(preview).metadata()
  expect(meta.height).toBe(720)
  expect(meta.width).toBe(Math.round(width * 720 / height))
  expect(meta.icc?.length).toBeGreaterThan(0)
  expect(assetSchema.safeParse(asset).success).toBe(true)
  // Narrow alternating bars must survive, not blur into a flat grey row.
  const line = await sharp(preview).extract({ left: 100, top: 100, width: 240, height: 1 }).removeAlpha().raw().toBuffer()
  expect(Math.max(...line) - Math.min(...line)).toBeGreaterThan(220)
  for (const [left, channel] of [[10, 0], [meta.width! - 10, 2]]) {
    const pixel = await sharp(preview).extract({ left, top: 100, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    expect(pixel[channel]).toBeGreaterThan(200)
    expect(pixel[(channel + 1) % 3]).toBeLessThan(70)
  }
})

test.each([1, 6])('portrait strip retains orientation %i and full aspect ratio', async orientation => {
  const source = join(dir, `portrait-${orientation}.jpg`)
  await sharp({ create: { width: 960, height: 3360, channels: 3, background: '#698e79' } })
    .withMetadata({ orientation }).jpeg().toFile(source)
  const asset = await inspectPhoto(source)
  expect(asset.status).toBe('ready')
  const meta = await sharp(decode(asset.preview)).metadata()
  expect([meta.width, meta.height]).toEqual(orientation === 1 ? [720, 2520] : [2520, 720])
  expect(asset.width / asset.height).toBeCloseTo(meta.width! / meta.height!, 3)
})

test.each([[1440, 960, 720, 480], [300, 100, 300, 100], [30000, 300, 7200, 72]])(
  'preview %i × %i preserves single-photo size and bounds long/small inputs', async (width, height, expectedWidth, expectedHeight) => {
    const source = join(dir, `size-${width}.jpg`)
    await sharp({ create: { width, height, channels: 3, background: '#698e79' } }).jpeg().toFile(source)
    const asset = await inspectPhoto(source)
    expect(asset.status).toBe('ready')
    const meta = await sharp(decode(asset.preview)).metadata()
    expect([meta.width, meta.height]).toEqual([expectedWidth, expectedHeight])
  })

test('dense strip grain stays within project/IPC size limit without losing the image', async () => {
  const width = 7200, height = 720, source = join(dir, 'grain.tif')
  await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).tiff({ compression: 'lzw' }).toFile(source)
  const asset = await inspectPhoto(source)
  expect(asset.status).toBe('ready')
  expect(asset.preview.length).toBeLessThanOrEqual(MAX_PREVIEW_LENGTH)
  expect(assetSchema.safeParse(asset).success).toBe(true)
  const meta = await sharp(decode(asset.preview)).metadata()
  expect(meta.width).toBeGreaterThan(720)
  expect(meta.width).toBeLessThan(width)
  expect(meta.width! / meta.height!).toBeCloseTo(width / height, 1)
})
