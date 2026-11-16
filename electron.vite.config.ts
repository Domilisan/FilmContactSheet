import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fixedLogoPlugin } from './build/fixed-logo-plugin'

export default defineConfig({
  main: {
    plugins: [fixedLogoPlugin(), externalizeDepsPlugin()],
    build: { rollupOptions: { input: {
      index: resolve('src/main/index.ts'),
      worker: resolve('src/main/worker.ts')
    } } }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [fixedLogoPlugin(), react()] }
})
