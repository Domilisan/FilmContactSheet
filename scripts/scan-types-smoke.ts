import { captureDesktop } from './capture-desktop'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import sharp from 'sharp'
import { scanProfiles } from '../src/shared/scan-types'

async function main() {
  const output = resolve('.test-output/scan-types')
  await mkdir(output, { recursive: true })
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
  env.PDIMPRESSION_TEST = '1'
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(output, 'user-data')}`], env })
  try {
    const page = await desktop.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.locator('.scan-type-card')).toHaveCount(11)
    await expect(page.getByRole('heading', { name: '选择扫描类型', exact: true })).toBeVisible()
    await expect(page.getByText('每卷单独选择模板，再导入 TIFF 或 JPEG', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: '单张扫描', exact: true }).locator('.scan-type-card')).toHaveCount(6)
    await expect(page.getByRole('region', { name: '整条扫描', exact: true }).locator('.scan-type-card')).toHaveCount(5)
    const grouping = await page.locator('.scan-type-groups').evaluate(element => {
      const groups = Array.from(element.children).map(child => child.getBoundingClientRect())
      const offsets = Array.from(element.querySelectorAll('.scan-type-card')).map(card =>
        card.querySelector('.scan-card-heading')!.getBoundingClientRect().top - card.getBoundingClientRect().top)
      return { leftEnd: groups[0].right, rightStart: groups[1].left, offsets }
    })
    expect(grouping.rightStart).toBeGreaterThan(grouping.leftEnd)
    // Windows 显示缩放可能把 3px 边框取整到 2.4px，检查视觉间距统一。
    expect(Math.max(...grouping.offsets) - Math.min(...grouping.offsets)).toBeLessThan(0.1)
    expect(grouping.offsets.every(offset => offset >= 14 && offset <= 15.1)).toBe(true)
    await expect(page.locator('.project-tabs')).toHaveCount(0)
    await captureDesktop(desktop, join(output, '01-selector.png'))
    for (const [index, profile] of scanProfiles.entries()) {
      const w = Math.round(profile.ratioWidth * 100), h = Math.round(profile.ratioHeight * 100)
      const source = join(output, `${profile.id}.tif`)
      const svg = `<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#698e79"/><circle cx="${w * .25}" cy="${h * .5}" r="${Math.min(w, h) * .22}" fill="#f1d594"/><path d="M${w * .4} ${h} L${w * .75} ${h * .15} L${w} ${h}Z" fill="#394c40"/></svg>`
      await sharp(Buffer.from(svg)).toColourspace('rgb16').withMetadata().tiff().toFile(source)
      if (index) await page.getByLabel('新建项目标签').click()
      const picker = index ? page.getByRole('dialog', { name: '新建扫描项目' }) : page.locator('.scan-welcome')
      await picker.getByRole('button', { name: `选择 ${profile.label}`, exact: true }).click()
      await expect(page.getByLabel('扫描类型', { exact: true })).toHaveValue(profile.label)
      const tabs = page.locator('.project-tabs')
      await tabs.locator('[aria-selected="true"]').dblclick()
      await tabs.getByLabel('项目名称').fill(profile.label)
      await tabs.getByLabel('项目名称').press('Enter')
      await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, source)
      await page.getByRole('button', { name: '导入照片', exact: true }).click()
      await expect(page.locator('.photo-row')).toHaveCount(1)
      await expect(page.locator('.layout-warning')).toHaveCount(0)
      await expect(page.getByTestId('sheet').locator('image')).toHaveCount(2)
      const hasHoles = await page.getByTestId('sheet').locator('rect[rx="0.35"]').count()
      expect(hasHoles > 0).toBe(profile.family !== '120')
      await expect(page.locator('.status')).toContainText(`1 ${profile.mode === 'strip' ? '条' : '张'}`)
      if (['half', '67', '135-strip', '645-strip'].includes(profile.id))
        await captureDesktop(desktop, join(output, `${profile.id}.png`))
    }
    await expect(page.locator('.project-tabs [role="tab"]')).toHaveCount(11)
    // Switching must restore the chosen format, not use the latest global selection.
    await page.locator('.project-directory-list .project-select').filter({ has: page.locator('.project-title', { hasText: /^135$/ }) }).click()
    await expect(page.getByLabel('扫描类型', { exact: true })).toHaveValue('135')
    await page.locator('.project-directory-list .project-select').filter({ has: page.locator('.project-title', { hasText: /^6×4.5 整条$/ }) }).click()
    await expect(page.getByLabel('扫描类型', { exact: true })).toHaveValue('6×4.5 整条')
    await page.getByLabel('订单编号 / 拍摄者').fill('MULTIFORMAT')
    const projectFile = join(output, 'strip.pdimpression')
    await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, projectFile)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.status')).toContainText('已保存')
    const stored = JSON.parse(await readFile(projectFile, 'utf8'))
    expect(stored.format).toBe('645-strip')
    expect(stored.layoutVersion).toBe(2)
    await page.getByLabel('关闭项目 6×4.5 整条', { exact: true }).click()
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, projectFile)
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(page.getByLabel('扫描类型', { exact: true })).toHaveValue('6×4.5 整条')
    await expect(page.locator('.photo-row')).toHaveCount(1)
    await desktop.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    }, output)
    await page.getByRole('button', { name: '导出接触印象', exact: false }).click()
    await page.getByLabel('高清输出宽度').selectOption('6000')
    await page.getByRole('button', { name: '选择文件夹并导出', exact: false }).click()
    await expect(page.locator('.task-card').filter({ hasText: '导出完成' })).toBeVisible({ timeout: 120000 })
    expect((await stat(join(output, 'MULTIFORMAT_索引_高清_6000px.jpg'))).size).toBeLessThanOrEqual(25_000_000)
    expect(errors).toEqual([])
    console.log('Scan types smoke passed: 11 selections and TIFF imports, format-specific frames, tab switching, save/reopen, whole-strip export.')
  } catch (error) {
    await captureDesktop(desktop, join(output, 'failure.png')).catch(() => {})
    throw error
  } finally {
    await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await desktop.close().catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
