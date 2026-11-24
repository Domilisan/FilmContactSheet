import { createHeaderSpacingMeasurer } from '../../shared/header-spacing'

export const measureHeaderOrderY = createHeaderSpacingMeasurer(async svg => {
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  return { data: context.getImageData(0, 0, canvas.width, canvas.height).data,
    info: { width: canvas.width, height: canvas.height, channels: 4 } }
})
