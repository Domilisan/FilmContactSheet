import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import sharp from 'sharp'

async function main() {
  const output = resolve('.test-output/workspace')
  await mkdir(output, { recursive: true })
  const photo = join(output, 'sample.jpg')
  await sharp({ create: { width: 360, height: 240, channels: 3, background: '#789782' } }).withIccProfile('srgb').jpeg().toFile(photo)
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  env.PDIMPRESSION_TEST = '1'
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(output, 'user-data')}`], env })
  try {
    const page = await desktop.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const tabs = page.locator('.project-tabs')
    const expectEmpty = async () => {
      await expect(tabs).toHaveCount(0)
      await expect(page.locator('.project-directory-list .project-item')).toHaveCount(0)
      await expect(page.locator('.welcome-logo')).toBeVisible()
      await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
      await expect(page.locator('.status')).toContainText('未打开项目')
    }
    await expectEmpty()
    await page.screenshot({ path: join(output, 'empty-start.png') })
    // Canceling the initial import must not create a placeholder project.
    await desktop.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
    await page.getByRole('button', { name: '导入照片', exact: true }).click()
    await expect(page.getByRole('button', { name: '导入照片', exact: true })).toBeEnabled()
    await expectEmpty()
    await page.locator('.project-directory-heading').getByRole('button', { name: '＋ 新建' }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(1)
    await expect(tabs).toHaveCSS('height', '24px')
    await page.getByLabel('关闭项目 未命名项目 1', { exact: true }).click()
    await expectEmpty()
    const rename = async (name: string) => {
      await tabs.locator('[aria-selected="true"]').dblclick()
      await tabs.getByLabel('项目名称').fill(name)
      await tabs.getByLabel('项目名称').press('Enter')
    }
    const saveTo = async (file: string) => {
      await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, file)
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.locator('.status')).toContainText('已保存')
    }
    const fileA = join(output, 'A.pdimpression'), fileB = join(output, 'B.pdimpression')
    await desktop.evaluate(({ dialog }, photo) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [photo] }) }, photo)
    await page.getByRole('button', { name: '导入照片', exact: true }).click()
    await expect(page.locator('.photo-row')).toHaveCount(1)
    await expect(tabs.getByRole('tab')).toHaveCount(1)
    await rename('卷 A')
    await page.getByLabel('订单编号 / 拍摄者').fill('A-001')
    await page.locator('.zoom-tools').getByRole('button', { name: '＋', exact: true }).click()
    await saveTo(fileA)
    await page.getByLabel('新建项目标签').click()
    await expect(tabs.getByRole('tab')).toHaveCount(2)
    await rename('卷 B')
    await page.getByLabel('订单编号 / 拍摄者').fill('B-001')
    await saveTo(fileB)
    await tabs.getByRole('tab', { name: '卷 A', exact: true }).click()
    await expect(page.getByLabel('订单编号 / 拍摄者')).toHaveValue('A-001')
    await expect(page.locator('.photo-row')).toHaveCount(1)
    await expect(page.locator('.zoom-tools')).toContainText('125%')
    await page.getByLabel('订单编号 / 拍摄者').fill('A-002')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.status')).toContainText('已保存')
    expect(JSON.parse(await readFile(fileA, 'utf8')).roll).toBe('A-002')
    expect(JSON.parse(await readFile(fileB, 'utf8')).roll).toBe('B-001')
    expect(JSON.parse(await readFile(fileA, 'utf8')).name).toBe('卷 A')
    // Another open project's save file must not be overwritten through Save As.
    await page.getByRole('button', { name: '另存', exact: true }).click()
    await expect(page.locator('.notice.error')).toContainText('另一个已打开的项目')
    expect(JSON.parse(await readFile(fileB, 'utf8')).name).toBe('卷 B')
    await page.getByTitle('撤销 Ctrl/Cmd Z', { exact: true }).click()
    await expect(page.getByLabel('订单编号 / 拍摄者')).toHaveValue('A-001')
    await tabs.getByRole('tab', { name: '卷 B', exact: true }).click()
    await expect(page.getByLabel('订单编号 / 拍摄者')).toHaveValue('B-001')
    await expect(page.locator('.photo-row')).toHaveCount(0)
    await expect(page.locator('.zoom-tools')).toContainText('100%')
    // A is dirty while B is saved: closing the whole app must still warn.
    const warned = await desktop.evaluate(async ({ dialog, BrowserWindow }) => {
      let called = false
      dialog.showMessageBox = async () => { called = true; return { response: 0, checkboxChecked: false } }
      BrowserWindow.getAllWindows()[0].close()
      await new Promise(resolve => setTimeout(resolve, 100))
      return called
    })
    expect(warned).toBe(true)
    await page.screenshot({ path: join(output, 'multi-project.png') })
    // Reopening an already open file focuses its unsaved session without replacing it.
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, fileA)
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(page.locator('.notice')).toContainText('已切换到对应标签')
    await expect(tabs.getByRole('tab')).toHaveCount(2)
    await expect(page.getByLabel('订单编号 / 拍摄者')).toHaveValue('A-001')
    await page.getByLabel('关闭项目 卷 A', { exact: true }).click()
    const closeDialog = page.getByRole('dialog', { name: '关闭项目确认' })
    await closeDialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(2)
    await page.getByLabel('关闭项目 卷 A', { exact: true }).click()
    await closeDialog.getByRole('button', { name: '保存并关闭', exact: true }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(1)
    expect(JSON.parse(await readFile(fileA, 'utf8')).roll).toBe('A-001')
    // A closed project can be reopened from disk, including its image previews.
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(2)
    await expect(page.locator('.photo-row')).toHaveCount(1)
    await page.getByLabel('订单编号 / 拍摄者').fill('discard me')
    await page.getByLabel('关闭项目 卷 A', { exact: true }).click()
    await closeDialog.getByRole('button', { name: '不保存关闭', exact: true }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(1)
    expect(JSON.parse(await readFile(fileA, 'utf8')).roll).toBe('A-001')
    await page.getByLabel('关闭项目 卷 B', { exact: true }).click()
    await expectEmpty()
    await page.screenshot({ path: join(output, 'empty-after-close.png') })
    // Open from the empty state, then save and close the final dirty project.
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(1)
    await page.getByLabel('订单编号 / 拍摄者').fill('A-003')
    await page.getByLabel('关闭项目 卷 A', { exact: true }).click()
    await closeDialog.getByRole('button', { name: '保存并关闭', exact: true }).click()
    await expectEmpty()
    expect(JSON.parse(await readFile(fileA, 'utf8')).roll).toBe('A-003')
    expect(errors).toEqual([])
    console.log('Workspace smoke passed: tabs, rename, independent state/history/save paths, close protection and disk reopen.')
  } catch (error) {
    await desktop.windows()[0]?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await desktop.close().catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
