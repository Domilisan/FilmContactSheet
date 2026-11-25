import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { captureDesktop } from './capture-desktop'

async function main() {
  await mkdir('.test-output', { recursive: true })
  const output = await mkdtemp(resolve('.test-output/high-sierra-'))
  const source = join(output, '拖入测试.tif')
  await sharp({ create: { width: 369, height: 248, channels: 3, background: '#798d68' } })
    .toColourspace('rgb16').withMetadata().tiff().toFile(source)
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
  env.PDIMPRESSION_TEST = '1'; delete env.ELECTRON_RUN_AS_NODE
  const appData = join(output, 'app-data')
  await mkdir(appData)
  const bootstrap = join(output, 'bootstrap.cjs')
  // Exercise the production first-launch path without touching the user's real app data.
  await writeFile(bootstrap, `require('electron').app.setPath('appData', ${JSON.stringify(appData)});\nrequire(${JSON.stringify(resolve('out/main/index.js'))});\n`)
  const desktop = await electron.launch({ args: [bootstrap], env })
  try {
    const runtime = await desktop.evaluate(({ app }) => ({
      electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
      platform: process.platform, arch: process.arch, name: app.getName(), userData: app.getPath('userData')
    }))
    expect(runtime.electron).toBe('26.6.10'); expect(runtime.node).toMatch(/^18\./)
    expect(runtime.chrome).toMatch(/^116\./); expect(runtime.arch).toBe('x64')
    expect(runtime.name).toBe('PD Impression High Sierra')
    expect(runtime.userData).toBe(join(appData, 'PD Impression High Sierra'))
    expect(sharp.versions.sharp).toBe('0.32.6'); expect(sharp.versions.vips).toBe('8.14.5')
    const page = await desktop.firstWindow()
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await page.getByRole('button', { name: '选择 135', exact: true }).click()
    // DOM.setFileInputFiles supplies a real native File, unlike a JS-created File
    // with no native path. Exercise the Electron 26 File.path preload bridge.
    await page.evaluate(() => {
      const input = document.createElement('input'); input.type = 'file'; input.id = 'native-drop-fixture'
      document.body.appendChild(input)
    })
    await page.locator('#native-drop-fixture').setInputFiles(source)
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#native-drop-fixture')!
      const dataTransfer = new DataTransfer(); dataTransfer.items.add(input.files![0])
      document.querySelector('.app')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
      input.remove()
    })
    await expect(page.locator('.photo-row')).toHaveCount(1, { timeout: 30000 })
    await expect(page.locator('.photo-row.failed')).toHaveCount(0)
    await expect(page.locator('.photo-row')).toContainText('拖入测试.tif')
    await page.getByRole('button', { name: '导出接触印象 ↗', exact: true }).click()
    await expect(page.getByLabel('高清输出宽度')).toHaveValue('8000')
    expect(errors).toEqual([])
    await captureDesktop(desktop, join(output, 'native-drop.png'))
    await writeFile(join(output, 'result.json'), JSON.stringify({ ...runtime, sharp: sharp.versions, checks: ['native File.path drop', '8000px default', 'no renderer require', 'runtime versions'] }, null, 2))
    console.log(`High Sierra runtime smoke passed on ${runtime.platform}: ${output}`)
  } finally {
    await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await desktop.close().catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
