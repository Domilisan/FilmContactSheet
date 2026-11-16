import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

// 开发与构建时直接读取这张图，内嵌到界面和图片处理进程，离线打包后仍可使用。
export function fixedLogoPlugin(): Plugin {
  const id = '\0virtual:pdimpression-logo'
  const logoPath = resolve('pics/logo.jpg')
  return {
    name: 'pdimpression-fixed-logo',
    resolveId(source) { if (source === 'virtual:pdimpression-logo') return id },
    load(source) {
      if (source !== id) return
      this.addWatchFile(logoPath)
      const data = `data:image/jpeg;base64,${readFileSync(logoPath).toString('base64')}`
      return `export default ${JSON.stringify(data)}`
    },
    handleHotUpdate(context) {
      if (resolve(context.file) !== logoPath) return
      const module = context.server.moduleGraph.getModuleById(id)
      if (module) return [module]
    }
  }
}
