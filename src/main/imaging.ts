import sharp, { type OverlayOptions, type Sharp } from 'sharp'
import { randomUUID } from 'node:crypto'
import { stat, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { MAX_PREVIEW_LENGTH, type Asset, type Project, type Progress } from '../shared/model'
import { exportErrors, layoutSheet, sheetSvg, rollHeader } from '../shared/layout'
import { measureHeaderOrderY } from './header-spacing'
import { MAX_EXPORT_BYTES } from '../shared/export-settings'
import { projectProfile } from '../shared/scan-types'
import { filmFrameColor } from '../shared/branding'

sharp.cache({ memory: 96, files: 16, items: 60 })
sharp.concurrency(2)
const inputOptions = { limitInputPixels: 150_000_000, failOn: 'error' as const }

async function photoPreview(filePath: string, width: number, height: number): Promise<string> {
  const longEdge = Math.max(width, height), shortEdge = Math.min(width, height)
  // Long scans occupy a whole row. Keep detail along their short edge instead
  // of sharing a single photograph's 720 pixels across the entire strip.
  // Use geometry so imports, replacements and reopened projects behave alike.
  const elongated = longEdge / shortEdge >= 3
  let scale = elongated ? Math.min(1, 720 / shortEdge, 7200 / longEdge) : Math.min(1, 720 / longEdge)
  const prefix = 'data:image/jpeg;base64,'
  const maxBytes = Math.floor((MAX_PREVIEW_LENGTH - prefix.length) / 4) * 3
  const original = sharp(filePath, inputOptions).autoOrient().pipelineColourspace('rgb16')
  for (;;) {
    const preview = await original.clone()
      .resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)),
        fit: 'inside', withoutEnlargement: true })
      .withIccProfile('srgb').jpeg(elongated ? { quality: 88, chromaSubsampling: '4:4:4' } : { quality: 84 }).toBuffer()
    if (preview.length <= maxBytes) return prefix + preview.toString('base64')
    // Bound IPC/project payloads even for dense grain. Always resample the
    // original, never an already compressed JPEG; keep the complete image.
    scale *= Math.min(0.8, Math.sqrt(maxBytes / preview.length) * 0.9)
  }
}

// 每次从同一个原始合成流程编码，避免对 JPEG 反复压缩。
// 首次质量已达标时直接采用；超限才搜索可容纳的较高 JPEG 质量。
export async function writeSizeLimitedJpeg(image: Sharp, temporary: string, quality: number,
  maxBytes = MAX_EXPORT_BYTES, onAdjust: () => void = () => {}): Promise<number> {
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error('JPEG 质量必须在 1 至 100 之间。')
  const encode = async (value: number) => {
    await image.clone().jpeg({ quality: value, chromaSubsampling: '4:4:4' }).toFile(temporary)
    return (await stat(temporary)).size
  }
  if (await encode(quality) <= maxBytes) return quality
  onAdjust()
  let low = 1, high = quality - 1, best = 0, lastQuality = quality
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2)
    const size = await encode(candidate)
    lastQuality = candidate
    if (size <= maxBytes) { best = candidate; low = candidate + 1 }
    else high = candidate - 1
  }
  if (!best) throw new Error('当前尺寸无法满足文件大小上限，请选择较小的高清尺寸后重试。')
  if (lastQuality !== best) await encode(best)
  if ((await stat(temporary)).size > maxBytes) throw new Error('输出超过文件大小上限，未保存导出文件。')
  return best
}

export async function inspectPhoto(filePath: string, id = randomUUID()): Promise<Asset> {
  const asset: Asset = { id, path: filePath, name: path.basename(filePath), size: 0, width: 0, height: 0,
    depth: '', hasIcc: false, space: '', rotation: 0, status: 'error', preview: '' }
  try {
    asset.size = (await stat(filePath)).size
    const metadata = await sharp(filePath, inputOptions).metadata()
    if (!['jpeg', 'tiff'].includes(metadata.format ?? '')) throw new Error('第一版仅接受 TIFF 和 JPEG 照片。')
    if ((metadata.pages ?? 1) > 1) throw new Error(`此文件有 ${metadata.pages} 页，暂不支持多页 TIFF。`)
    if (!metadata.width || !metadata.height) throw new Error('无法读取图片尺寸。')
    const swap = (metadata.orientation ?? 1) >= 5
    asset.width = swap ? metadata.height : metadata.width
    asset.height = swap ? metadata.width : metadata.height
    asset.rotation = asset.height > asset.width ? 90 : 0
    asset.depth = metadata.depth ?? 'unknown'
    asset.space = metadata.space ?? 'unknown'
    asset.hasIcc = Boolean(metadata.icc)
    if (!asset.hasIcc && !['srgb', 'rgb', 'b-w', 'grey16', 'rgb16'].includes(asset.space))
      throw new Error(`无 ICC 的 ${asset.space} 图片无法安全解释颜色，请先嵌入正确配置。`)
    if (!asset.hasIcc) asset.warning = '未嵌入 ICC；预览按 sRGB／灰度解释，导出前需确认。'
    asset.preview = await photoPreview(filePath, asset.width, asset.height)
    asset.status = 'ready'
  } catch (error) { asset.error = error instanceof Error ? error.message : String(error) }
  return asset
}

export async function exportSheet(project: Project, width: number, quality: number, destination: string,
  temporary: string, onProgress: (progress: Progress) => void): Promise<void> {
  const errors = exportErrors(project)
  if (errors.length) throw new Error(errors.join('\n'))
  if (!Number.isInteger(width) || width < 1600 || width > 10000) throw new Error('输出宽度必须在 1600 至 10000 像素之间。')
  const layout = layoutSheet(project)
  const position = projectProfile(project).mode === 'strip' ? 'left' : 'centre'
  const height = Math.round(width * Math.SQRT2)
  const scale = width / layout.width
  const density = width / (layout.width / 25.4)
  const frames = layout.frames.filter(f => f.asset)
  const overlays: OverlayOptions[] = []
  try {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i], asset = f.asset!
      onProgress({ message: `处理原图 ${asset.name}`, current: i, total: frames.length + 1 })
      const left = Math.round(f.x * scale), top = Math.round(f.y * scale)
      const w = Math.round((f.x + f.width) * scale) - left
      const h = Math.round((f.y + f.height) * scale) - top
      const input = await sharp(asset.path, inputOptions).autoOrient().rotate(asset.rotation)
        .pipelineColourspace('rgb16').resize(w, h, { fit: 'contain', position, background: filmFrameColor })
        .withIccProfile('srgb').png().toBuffer()
      overlays.push({ input, left, top })
    }
    onProgress({ message: '合成胶片与品牌信息', current: frames.length, total: frames.length + 1 })
    // Use explicit raster dimensions. Millimetre SVG dimensions combined with
    // an input density can be applied twice by the SVG loader and explode RAM.
    const orderY = await measureHeaderOrderY(rollHeader(project))
    const exportSvg = sheetSvg(project, { orderY }).replace(/width="[^"]+mm" height="[^"]+mm"/, `width="${width}" height="${height}"`)
    const image = sharp(Buffer.from(exportSvg), { limitInputPixels: 150_000_000 })
      .resize(width, height, { fit: 'fill' }).composite(overlays)
      .withIccProfile('srgb').withMetadata({ density })
    await writeSizeLimitedJpeg(image, temporary, quality, MAX_EXPORT_BYTES, () => {
      onProgress({ message: '文件超过 25MB，正在优化 JPEG 质量…', current: frames.length, total: frames.length + 1 })
    })
    await rename(temporary, destination)
    onProgress({ message: '导出完成', current: frames.length + 1, total: frames.length + 1 })
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}
