import sharp from 'sharp'
import { createHeaderSpacingMeasurer } from '../shared/header-spacing'

export const measureHeaderOrderY = createHeaderSpacingMeasurer(svg =>
  sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
