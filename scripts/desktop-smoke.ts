import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import sharp from 'sharp'

async function main() {
  const output = resolve('.test-output')
  const scans = join(output, 'scans')
  await mkdir(scans, { recursive: true })
  const files: string[] = []
  const colors = ['#6b876e', '#608494', '#a8996b', '#b47d68', '#769177', '#869bad']
  for (let n = 1; n <= 38; n++) {
    const file = join(scans, `${String(n).padStart(3, '0')}.tif`)
    // One ~80 MiB uncompressed 16-bit RGBA TIFF, plus small labelled color fixtures.
    const large = n === 1
    const w = large ? 4096 : (n === 3 ? 240 : 360), h = large ? 2560 : (n === 3 ? 360 : 240)
    const svg = `<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="${colors[(n - 1) % colors.length]}"/><circle cx="${w * .7}" cy="${h * .3}" r="${w * .12}" fill="#e4d3ab"/><path d="M0 ${h} L${w * .4} ${h * .4} L${w} ${h}Z" fill="#394c40"/><text x="${w * .1}" y="${h * .7}" font-family="Arial" font-size="${w * .12}" fill="white">${n}</text></svg>`
    await sharp(Buffer.from(svg)).toColourspace('rgb16').withIccProfile('srgb').tiff({ compression: large ? 'none' : 'lzw' }).toFile(file)
    files.push(file)
  }
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  env.PDIMPRESSION_TEST = '1'
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(output, 'user-data')}`], env, timeout: 60000 })
  try {
    const page = await desktop.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.locator('.welcome-logo')).toBeVisible()
    await expect(page.locator('.welcome-logo')).toHaveCSS('mix-blend-mode', 'multiply')
    await expect(page.locator('.library-footer, .preview-footer')).toHaveCount(0)
    await page.screenshot({ path: join(output, '01-empty.png') })
    await desktop.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, files.slice(0, 36))
    await page.getByRole('button', { name: '导入照片', exact: true }).click()
    await expect(page.locator('.photo-row')).toHaveCount(36, { timeout: 120000 })
    await expect(page.getByTestId('sheet')).toBeVisible()
    for (let i = 0; i < 4; i++) await page.locator('.zoom-tools').getByRole('button', { name: '＋', exact: true }).click()
    const scrollArea = page.locator('.canvas-scroll')
    const scrollState = await scrollArea.evaluate(element => {
      const style = getComputedStyle(element, '::-webkit-scrollbar')
      element.scrollLeft = 100
      element.scrollTop = 120
      return { horizontal: element.scrollLeft, vertical: element.scrollTop, width: style.width, height: style.height }
    })
    expect(scrollState.horizontal).toBeGreaterThan(0)
    expect(scrollState.vertical).toBeGreaterThan(0)
    expect(scrollState.width).toBe('18px')
    expect(scrollState.height).toBe('18px')
    await page.screenshot({ path: join(output, '04-zoom-scrollbars.png') })
    await page.locator('.zoom-tools').getByRole('button', { name: '适合窗口', exact: true }).click()
    await expect(page.locator('.paper-caption')).toContainText('已隐藏末尾 1 条')
    await page.getByLabel('订单编号 / 拍摄者').fill('TEST-001')
    const filmSelect = page.getByLabel('胶卷型号', { exact: true })
    await expect(page.getByLabel('自定义胶卷型号', { exact: true })).toHaveCount(0)
    await filmSelect.selectOption('Kodak Gold 200')
    await expect(page.getByTestId('sheet')).toContainText('Kodak Gold 200')
    await filmSelect.selectOption('CineStill 800T')
    await expect(page.getByLabel('自定义胶卷型号', { exact: true })).toHaveCount(0)
    await filmSelect.selectOption({ label: '其他（手动填写）' })
    await page.getByLabel('自定义胶卷型号', { exact: true }).fill('TIFF validation')
    const scannerSelect = page.getByLabel('扫描仪', { exact: true })
    await expect(page.getByLabel('自定义扫描仪', { exact: true })).toHaveCount(0)
    await scannerSelect.selectOption({ label: '诺日士 SA1700' })
    await expect(page.getByTestId('sheet')).toContainText('Noritsu SA1700')
    await scannerSelect.selectOption({ label: '哈苏 X5' })
    await expect(page.getByTestId('sheet')).toContainText('Hasselblad X5')
    await expect(page.getByLabel('自定义扫描仪', { exact: true })).toHaveCount(0)
    await scannerSelect.selectOption('')
    await expect(page.getByTestId('sheet')).not.toContainText('Hasselblad X5')
    await scannerSelect.selectOption({ label: '其他（手动填写）' })
    await page.getByLabel('自定义扫描仪', { exact: true }).fill('Noritsu HS-1800')
    await expect(page.getByTestId('sheet')).toContainText('Noritsu HS-1800')
    await page.getByRole('button', { name: '暗房模板', exact: true }).click()
    await expect(page.getByRole('button', { name: /导入 Logo|更换 Logo|移除 Logo/ })).toHaveCount(0)
    await expect(page.getByLabel('Logo 位置', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('sheet').locator('image').first()).toHaveAttribute('href', /^data:image\/jpeg;base64,/)
    await expect(page.getByTestId('sheet').locator('image').first()).toHaveAttribute('width', '30')
    await expect(page.getByLabel('条间白缝', { exact: true })).toHaveValue('0.5')
    await page.getByLabel('隐藏末尾整条空白胶片', { exact: true }).uncheck()
    await expect(page.locator('.paper-caption')).toContainText('完整显示 7 条')
    await page.getByLabel('隐藏末尾整条空白胶片', { exact: true }).check()
    await page.locator('.photo-row').nth(3).click()
    await page.screenshot({ path: join(output, '02-workspace.png') })
    const projectFile = join(output, 'TEST-001.pdimpression')
    await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, projectFile)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.status')).toContainText('已保存')
    const stored = JSON.parse(await readFile(projectFile, 'utf8'))
    expect(stored.slots[0].preview).toBe('')
    expect(stored.scanner).toBe('Noritsu HS-1800')
    expect(stored.film).toBe('TIFF validation')
    expect(stored.slots[0].path).not.toMatch(/^[A-Z]:/)
    await desktop.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) }, output)
    await page.getByRole('button', { name: '导出接触印象', exact: false }).click()
    await expect(page.locator('.export-option')).toHaveCount(1)
    await expect(page.getByText('便捷预览版', { exact: true })).toHaveCount(0)
    await page.locator('.export-option select').selectOption('6000')
    await page.getByRole('button', { name: '选择文件夹并导出', exact: false }).click()
    await expect(page.locator('.export-result')).toBeVisible({ timeout: 120000 })
    await expect(page.locator('.export-result')).toContainText('导出完成')
    const result = join(output, 'TEST-001_索引_高清_6000px.jpg')
    const metadata = await sharp(result).metadata()
    expect((await stat(result)).size).toBeLessThanOrEqual(25_000_000)
    expect(metadata.width).toBe(6000)
    expect(metadata.height).toBe(Math.round(6000 * Math.SQRT2))
    expect(metadata.icc?.length).toBeGreaterThan(0)
    await page.screenshot({ path: join(output, '03-export.png') })
    await page.locator('.modal-actions').getByRole('button', { name: '关闭', exact: true }).click()
    await desktop.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, files.slice(36))
    await page.getByRole('button', { name: '导入照片', exact: true }).click()
    await expect(page.locator('.photo-row')).toHaveCount(38, { timeout: 60000 })
    await expect(page.locator('.paper-caption')).toContainText('完整显示 7 条')
    // Save 38 and reload the saved project through native dialog to validate rehydration.
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.status')).toContainText('已保存')
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, projectFile)
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(page.locator('.notice')).toContainText('项目已打开', { timeout: 120000 })
    await page.getByRole('button', { name: '本卷信息', exact: true }).click()
    await expect(page.getByLabel('胶卷型号', { exact: true })).toHaveValue('__other_film__')
    await expect(page.getByLabel('自定义胶卷型号', { exact: true })).toHaveValue('TIFF validation')
    await expect(page.getByLabel('扫描仪', { exact: true })).toHaveValue('__other_scanner__')
    await expect(page.getByLabel('自定义扫描仪', { exact: true })).toHaveValue('Noritsu HS-1800')
    await expect(page.getByTestId('sheet')).toContainText('Noritsu HS-1800')
    await expect(page.locator('.photo-row')).toHaveCount(38)
    expect(errors).toEqual([])
    await writeFile(join(output, 'smoke-result.json'), JSON.stringify({ passed: true, inputCount: 38, largeTiffBytes: (await readFile(files[0])).length, export: { width: metadata.width, height: metadata.height, icc: Boolean(metadata.icc) }, browserErrors: errors }, null, 2))
    console.log('Desktop smoke passed: TIFF import, physical layout, save/open, original-source export, 36/38-row rules.')
  } catch (error) {
    const page = desktop.windows()[0]
    if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await desktop.close().catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
