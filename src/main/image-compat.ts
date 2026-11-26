import sharp, { type Sharp } from 'sharp'
import { filmFrameColor } from '../shared/branding'

/** Sharp 0.32 cannot combine EXIF autorotation and a manual quarter-turn in one pipeline. */
export async function renderPhotoTile(input: Sharp, width: number, height: number, rotation: number,
  align: 'left' | 'center' = 'center'): Promise<Buffer> {
  const angle = ((rotation % 360) + 360) % 360
  if (![0, 90, 180, 270].includes(angle)) throw new Error('图片旋转角度必须是 90 度的倍数。')
  const swap = angle === 90 || angle === 270
  // Padding is applied before the manual rotation; anchor the edge that will become the final left edge.
  const position = align === 'left' ? (['left', 'bottom', 'right', 'top'] as const)[angle / 90] : 'centre'
  // Resize before materialising the intermediate, so its size is bounded by the output tile.
  // withMetadata in 0.32 converts to sRGB and embeds its profile; reset the orientation tag.
  const oriented = await input.rotate().pipelineColourspace('rgb16')
    .resize(swap ? height : width, swap ? width : height, { fit: 'contain', position, background: filmFrameColor })
    .withMetadata({ orientation: 1 }).png().toBuffer()
  if (angle === 0) return oriented
  return sharp(oriented).rotate(angle).withMetadata({ orientation: 1 }).png().toBuffer()
}
