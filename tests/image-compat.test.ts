import { expect, test } from 'vitest'
import sharp from 'sharp'
import { renderPhotoTile } from '../src/main/image-compat'

// Distinct corners detect mirror mistakes as well as an ignored manual rotation.
const colours = [[220, 30, 20], [20, 190, 40], [30, 50, 220], [220, 190, 20]]
const orientations = [
  [0, 1, 2, 3], [1, 0, 3, 2], [3, 2, 1, 0], [2, 3, 0, 1],
  [0, 2, 1, 3], [2, 0, 3, 1], [3, 1, 2, 0], [1, 3, 0, 2]
]
for (let orientation = 1; orientation <= 8; orientation++) {
  test(`EXIF ${orientation} plus all manual quarter-turns preserves corners, dimensions and sRGB`, async () => {
    const svg = `<svg width="120" height="80">${colours.map((c, i) =>
      `<rect x="${i % 2 * 60}" y="${Math.floor(i / 2) * 40}" width="60" height="40" fill="rgb(${c.join(',')})"/>`).join('')}</svg>`
    const source = await sharp(Buffer.from(svg)).withMetadata({ orientation }).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer()
    expect((await sharp(source).metadata()).orientation).toBe(orientation)
    let corners = orientations[orientation - 1]
    for (let turn = 0; turn < 4; turn++) {
      const swapped = (orientation >= 5) !== (turn % 2 === 1)
      const width = swapped ? 80 : 120, height = swapped ? 120 : 80
      const output = await renderPhotoTile(sharp(source), width, height, turn * 90)
      const metadata = await sharp(output).metadata()
      expect(metadata.width).toBe(width); expect(metadata.height).toBe(height)
      expect(metadata.orientation).toBe(1)
      expect(metadata.icc?.length).toBeGreaterThan(0)
      for (let i = 0; i < 4; i++) {
        const pixel = await sharp(output).extract({ left: Math.round(width * (i % 2 ? 0.75 : 0.25)),
          top: Math.round(height * (i < 2 ? 0.25 : 0.75)), width: 1, height: 1 }).removeAlpha().raw().toBuffer()
        colours[corners[i]].forEach((value, channel) => expect(Math.abs(pixel[channel] - value)).toBeLessThan(12))
      }
      corners = [corners[2], corners[0], corners[3], corners[1]]
    }
  })
}
