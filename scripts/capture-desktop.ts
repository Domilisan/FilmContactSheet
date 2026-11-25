import type { ElectronApplication } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// Chromium 116's DevTools screenshot can stall for a hidden window. Electron's
// native capture API explicitly supports capturing while keeping the window hidden.
export async function captureDesktop(desktop: ElectronApplication, path: string): Promise<void> {
  const png = await desktop.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    if (image.isEmpty()) throw new Error('Empty desktop screenshot')
    return image.toPNG().toString('base64')
  })
  await writeFile(path, Buffer.from(png, 'base64'))
}
