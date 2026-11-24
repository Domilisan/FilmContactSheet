import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import sharp from 'sharp'
await mkdir('.test-output', { recursive: true })
const output = await mkdtemp(resolve('.test-output/packaged-'))
const source = join(output, 'scan-16bit.tif')
await sharp({ create: { width: 2400, height: 2400, channels: 3, background: '#789782' } }).toColourspace('rgb16').withIccProfile('srgb').tiff({ compression: 'none' }).toFile(source)
const original = await readFile(source)
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
env.PDIMPRESSION_TEST = '1'
delete env.ELECTRON_RUN_AS_NODE
const desktop = await electron.launch({ executablePath: resolve(process.argv[2] || (process.platform === 'darwin' ? 'release/mac/PD Impression.app/Contents/MacOS/PD Impression' : 'release/win-unpacked/PD Impression.exe')), args: [`--user-data-dir=${join(output, 'user-data')}`], env, timeout: 60000 })
try {
  const page = await desktop.firstWindow()
  page.setDefaultTimeout(20000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const runtime = await desktop.evaluate(({ app, nativeImage }) => ({ packaged: app.isPackaged, version: app.getVersion(), platform: process.platform, arch: process.arch, icon: !nativeImage.createFromPath(`${app.getAppPath()}/build/icon.png`).isEmpty() }))
  expect(runtime.packaged).toBe(true); expect(runtime.icon).toBe(true)
  expect(runtime.platform).toBe(process.platform); expect(runtime.arch).toBe('x64')
  await page.getByRole('button', { name: '选择 6×6', exact: true }).click()
  await desktop.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }) }, source)
  await page.getByRole('button', { name: '导入照片', exact: true }).click()
  await expect(page.locator('.photo-row')).toHaveCount(1, { timeout: 120000 })
  await expect(page.locator('.photo-row.failed')).toHaveCount(0)
  await page.getByLabel('订单编号 / 拍摄者').fill('PACKAGED-001')
  await page.getByLabel('备注', { exact: true }).fill('安装包验证')
  const savedPath = join(output, 'packaged.pdimpression')
  await desktop.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, savedPath)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.status')).toContainText('已保存')
  const saved = JSON.parse(await readFile(savedPath, 'utf8'))
  expect(saved.format).toBe('66'); expect(saved.notes).toBe('安装包验证')
  await page.getByRole('button', { name: '导出接触印象 ↗', exact: true }).click()
  await page.getByLabel('导出文件名', { exact: true }).fill('0001接触印象')
  await page.getByLabel('高清输出宽度').selectOption('6000')
  await desktop.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, output)
  await page.getByRole('button', { name: '选择文件夹并导出 ↗', exact: true }).click()
  await expect(page.locator('.task-card.completed').filter({ hasText: '导出完成' })).toBeVisible({ timeout: 120000 })
  const exported = join(output, '0001接触印象.jpg')
  expect((await sharp(exported).metadata()).width).toBe(6000)
  expect((await stat(exported)).size).toBeLessThanOrEqual(25_000_000)
  expect((await readFile(source)).equals(original)).toBe(true)
  expect(errors).toEqual([])
  await page.screenshot({ path: join(output, 'packaged-success.png') })
  await page.getByRole('button', { name: /关闭项目/ }).last().click()
  await expect(page.locator('.welcome-logo')).toBeVisible()
  await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, savedPath)
  await page.getByRole('button', { name: '打开项目', exact: true }).click()
  await expect(page.locator('.photo-row')).toHaveCount(1, { timeout: 120000 })
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('安装包验证')
  const report = { ...runtime, output, sourceBytes: original.length, exported, checks: ['launch', 'icon', '16-bit TIFF import', 'save', 'reopen', 'custom-name JPEG export', 'original unchanged'] }
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  await desktop.windows()[0]?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await desktop.close().catch(() => {})
}


