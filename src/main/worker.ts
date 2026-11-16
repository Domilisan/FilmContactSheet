import { inspectPhoto, exportSheet } from './imaging'
import { projectSchema } from '../shared/model'

const parent = (process as NodeJS.Process & { parentPort: {
  on(event: 'message', callback: (event: { data: any }) => void): void
  postMessage(message: unknown): void
} }).parentPort

parent.on('message', async ({ data }) => {
  try {
    if (data.kind === 'import') {
      const assets = []
      for (let i = 0; i < data.paths.length; i++) {
        const asset = await inspectPhoto(data.paths[i])
        assets.push(asset)
        parent.postMessage({ type: 'progress', progress: { message: `读取 ${asset.name}`, current: i + 1, total: data.paths.length } })
      }
      parent.postMessage({ type: 'done', result: assets })
    } else if (data.kind === 'export') {
      await exportSheet(projectSchema.parse(data.project), data.width, data.quality, data.destination, data.temporary,
        progress => parent.postMessage({ type: 'progress', progress }))
      parent.postMessage({ type: 'done', result: true })
    }
  } catch (error) { parent.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
})
