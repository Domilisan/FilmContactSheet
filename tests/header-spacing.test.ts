import { expect, test } from 'vitest'
import sharp from 'sharp'
import { newProject } from '../src/shared/model'
import { layoutSheet, rollHeader, sheetSvg } from '../src/shared/layout'
import { measureHeaderOrderY } from '../src/main/header-spacing'

test.each([
  ['Kodak UltraMax 400', '冷静', 'Hasselblad X5'],
  ['未填写胶卷型号', '冷静', '诺日士'],
  ['未填写胶卷型号', '冷静Lengjing', ''],
  ['未填写胶卷型号', '冷', ''],
  ['未填写胶卷型号', '冷静L', ''],
  ['Kodak Gold 200', 'Amy / pd', 'Noritsu HS-1800']
])('visible header gaps match for %s / %s', async (film, roll, scanner) => {
  const p = newProject(undefined, 'xpan')
  Object.assign(p, { film, roll, scanner, date: '2026-11-24' })
  const l = layoutSheet(p), header = rollHeader(p)
  const orderY = await measureHeaderOrderY(header)
  const bands = async (y?: number) => {
    const scale = 32, width = l.width / 2, height = 28
    const svg = sheetSvg(p, { orderY: y }).replace(/width="[^"]+mm" height="[^"]+mm" viewBox="[^"]+"/,
      `width="${width * scale}" height="${height * scale}" viewBox="${width} ${l.headerY - 10} ${width} ${height}"`)
    const lines = [...svg.matchAll(/<text [^>]*text-anchor="end"[^>]*>[\s\S]*?<\/text>/g)].map(match => match[0])
    const result: { top: number; bottom: number }[] = []
    for (const line of lines) {
      const isolated = svg.replace(/<g font-family=[\s\S]*<\/g>/, `<g font-family="Arial, Microsoft YaHei, sans-serif">${line}</g>`)
      const { data, info } = await sharp(Buffer.from(isolated)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let top = info.height, bottom = 0
      for (let row = 0; row < info.height; row++) {
        let ink = false
        for (let col = 0; col < info.width; col++) {
          const offset = (row * info.width + col) * info.channels
          if (data[offset + info.channels - 1] >= 32) { ink = true; break }
        }
        if (ink) { top = Math.min(top, row); bottom = row + 1 }
      }
      result.push({ top, bottom })
    }
    return result
  }
  const before = await bands(), after = await bands(orderY)
  expect(after).toHaveLength(3)
  expect(after[0]).toEqual(before[0])
  expect(after[2]).toEqual(before[2])
  const firstGap = after[1].top - after[0].bottom
  const secondGap = after[2].top - after[1].bottom
  expect(firstGap).toBeGreaterThan(0)
  expect(secondGap).toBeGreaterThan(0)
  expect(Math.abs(firstGap - secondGap)).toBeLessThanOrEqual(2)
})

test('missing order keeps the original third-line position', async () => {
  expect(await measureHeaderOrderY(rollHeader(newProject()))).toBe(6)
})
