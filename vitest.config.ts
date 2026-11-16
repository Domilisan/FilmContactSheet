import { defineConfig } from 'vitest/config'
import { fixedLogoPlugin } from './build/fixed-logo-plugin'
export default defineConfig({ plugins: [fixedLogoPlugin()], test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 } })
