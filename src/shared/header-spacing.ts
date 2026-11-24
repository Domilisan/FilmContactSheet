import { detailsFontSize, xml } from './layout'
import type { HeaderMeasureInput } from './model'

const scale = 32
interface Raster { data: Uint8Array | Uint8ClampedArray; info: { width: number; height: number; channels: number } }
export function createHeaderSpacingMeasurer(rasterize: (svg: string) => Promise<Raster>) {
  const cache = new Map<string, Promise<{ top: number; bottom: number }>>()

  // 各端用自己的 SVG 渲染器测量实际墨迹，包含字体回退和下伸部。
  function inkBounds(value: string, size: number, weight: number) {
    const key = JSON.stringify([value, size, weight])
    const cached = cache.get(key)
    if (cached) return cached
    const result = (async () => {
      // 分段叠放在同一基线上；只测垂直边缘，避免长扫描仪名称产生超宽位图。
      const chunks = value.match(/[\s\S]{1,20}/gu) ?? ['']
      const width = Math.ceil((size * 22 + 4) * scale), height = Math.ceil(size * 4 * scale)
      const baseline = size * 2
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width / scale} ${height / scale}"><g font-family="Arial, Microsoft YaHei, sans-serif" font-size="${size}" font-weight="${weight}" dominant-baseline="middle">${chunks.map(chunk => `<text x="2" y="${baseline}">${xml(chunk)}</text>`).join('')}</g></svg>`
      const { data, info } = await rasterize(svg)
      let first = info.height, last = -1
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * info.channels + info.channels - 1] >= 32) {
            first = Math.min(first, y); last = y; break
          }
        }
      }
      return last < 0 ? { top: 0, bottom: 0 }
        : { top: first / scale - baseline, bottom: (last + 1) / scale - baseline }
    })()
    if (cache.size >= 128) cache.delete(cache.keys().next().value!)
    cache.set(key, result)
    result.catch(() => cache.delete(key))
    return result
  }

  return async function measureHeaderOrderY(header: HeaderMeasureInput): Promise<number> {
    if (!header.order.trim()) return 6
    const title = await inkBounds(header.title, header.titleSize, 700)
    const order = await inkBounds(header.order, 5, 400)
    const details = await inkBounds(header.details, detailsFontSize, 400)
    // 标题和第三行始终保持空白状态的位置；只把第二行墨迹居中放进两者之间。
    // 输入、删除或切换中英文时，不再用第二行挤压整块页头。
    return (title.bottom + 12 + details.top - order.top - order.bottom) / 2
  }
}
