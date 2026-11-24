import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import sharp from 'sharp'

async function main() {
  await mkdir('.test-output', { recursive: true })
  const output = await mkdtemp(resolve('.test-output/multitask-'))
  const files = Object.fromEntries(['A', 'B', 'C'].map(name => [name, join(output, `${name}.tif`)]))
  for (const file of Object.values(files)) await sharp({ create: { width: 369, height: 248, channels: 3, background: '#768f78' } }).withIccProfile('srgb').tiff().toFile(file)
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
  env.PDIMPRESSION_TEST = '1'; delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(output, 'user-data')}`], env })
  try {
    const page = await desktop.firstWindow(); page.setDefaultTimeout(15000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    // Gate worker input in the isolated test process for deterministic interleaving.
    // Production code has no artificial sleeps or test-only task behavior.
    await desktop.evaluate(({ utilityProcess }) => {
      const state = globalThis as any
      state.heldJobs = []
      const fork = utilityProcess.fork.bind(utilityProcess)
      utilityProcess.fork = ((...args: Parameters<typeof fork>) => {
        const child = fork(...args), post = child.postMessage.bind(child)
        child.postMessage = (job: any) => { state.heldJobs.push({ job, post, child }) }
        return child
      }) as typeof utilityProcess.fork
    })
    const release = async (name: string, kind: 'import' | 'export') => {
      await expect.poll(() => desktop.evaluate((_, { name, kind }) => (globalThis as any).heldJobs.some((item: any) =>
        item.job.kind === kind && (kind === 'import' ? item.job.paths.some((p: string) => p.endsWith(`${name}.tif`)) : item.job.project.name === `卷 ${name}`)), { name, kind })).toBe(true)
      await desktop.evaluate((_, { name, kind }) => {
        const held = (globalThis as any).heldJobs
        const index = held.findIndex((item: any) => item.job.kind === kind && (kind === 'import' ? item.job.paths.some((p: string) => p.endsWith(`${name}.tif`)) : item.job.project.name === `卷 ${name}`))
        const [item] = held.splice(index, 1); item.post(item.job)
      }, { name, kind })
    }
    const choose = async (paths: string[]) => desktop.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, paths)
    const create = async (name: string, format: string, first = false) => {
      if (!first) await page.getByLabel('新建项目标签').click()
      const picker = first ? page.locator('.scan-welcome') : page.getByRole('dialog', { name: '新建扫描项目' })
      await picker.getByRole('button', { name: `选择 ${format}`, exact: true }).click()
      await expect(page.getByRole('dialog', { name: '新建扫描项目' })).toHaveCount(0)
      await expect(page.getByLabel('扫描类型', { exact: true })).toHaveValue(format)
      await page.locator('.project-tabs [aria-selected="true"]').dblclick()
      await page.getByLabel('项目名称', { exact: true }).fill(`卷 ${name}`)
      await page.getByLabel('项目名称', { exact: true }).press('Enter')
    }
    const select = async (name: string) => page.locator('.project-tabs .project-select').filter({ has: page.locator('.project-title', { hasText: `卷 ${name}` }) }).click()
    const newestTask = async (previous: string[]) => {
      // Finished imports can expire while a new task is being started.
      await expect.poll(async () => {
        const ids = await page.locator('.task-card').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-task-id')!))
        return ids.some(id => !previous.includes(id))
      }).toBe(true)
      const id = await page.locator('.task-card').first().getAttribute('data-task-id')
      return page.locator(`.task-card[data-task-id="${id}"]`)
    }
    const startImport = async (name: string) => {
      await choose([files[name]])
      const count = await page.locator('.task-card').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-task-id')!))
      await page.getByRole('button', { name: '导入照片', exact: true }).click()
      return newestTask(count)
    }
    const startExport = async (name: string) => {
      await choose([output])
      await page.getByRole('button', { name: '导出接触印象 ↗', exact: true }).click()
      await page.getByLabel('高清输出宽度').selectOption('6000')
      await page.getByLabel('导出文件名', { exact: true }).fill(`export-${name}`)
      const count = await page.locator('.task-card').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-task-id')!))
      await page.getByRole('button', { name: '选择文件夹并导出 ↗', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '导出索引图' })).toHaveCount(0)
      return newestTask(count)
    }

    await create('A', '135', true)
    const a = await startImport('A'); await expect(a).toHaveAttribute('data-state', 'running')
    await expect(page.getByLabel('新建项目标签')).toBeEnabled()
    await expect(page.getByLabel('关闭项目 卷 A')).toBeDisabled()
    await create('B', '6×6')
    const b = await startImport('B'); await expect(b).toHaveAttribute('data-state', 'running')
    await create('C', 'XPan')
    const c = await startImport('C'); await expect(c).toHaveAttribute('data-state', 'queued')
    await expect(page.locator('.busy')).toHaveCount(0)
    await expect(page.locator('.project-directory-list .project-task-progress')).toHaveCount(3)
    await page.screenshot({ path: join(output, '01-concurrent-imports.png') })

    // B finishes while C is selected: C must stay empty, and A must remain in flight.
    await release('B', 'import'); await expect(b).toHaveAttribute('data-state', 'completed')
    await expect(c).toHaveAttribute('data-state', 'running')
    await expect(page.locator('.photo-row')).toHaveCount(0)
    await expect(a).toHaveAttribute('data-state', 'running')
    await select('B'); await expect(page.locator('.photo-row')).toHaveCount(1)
    await expect(page.locator('.photo-row')).toContainText('B.tif')
    await page.getByLabel('备注', { exact: true }).fill('导出前备注')
    await a.getByRole('button', { name: '取消任务' }).click()
    await expect(a).toHaveAttribute('data-state', 'canceled')
    // Discard the gate for the canceled worker; it must never be released.
    await desktop.evaluate(() => { (globalThis as any).heldJobs = (globalThis as any).heldJobs.filter((item: any) => !item.job.paths?.some((p: string) => p.endsWith('A.tif'))) })
    await release('C', 'import'); await expect(c).toHaveAttribute('data-state', 'completed')
    await expect(page.locator('.photo-row')).toContainText('B.tif')
    await select('A'); await expect(page.locator('.photo-row')).toHaveCount(0)
    await select('C'); await expect(page.locator('.photo-row')).toContainText('C.tif')

    await select('B')
    const exportB = await startExport('B'); await expect(exportB).toHaveAttribute('data-state', 'running')
    await page.getByLabel('备注', { exact: true }).fill('导出过程中继续编辑')
    await expect.poll(() => desktop.evaluate(() => (globalThis as any).heldJobs.find((item: any) => item.job.kind === 'export')?.job.project.notes)).toBe('导出前备注')
    await select('C')
    const exportC = await startExport('C'); await expect(exportC).toHaveAttribute('data-state', 'queued')
    await select('A')
    const a2 = await startImport('A'); await expect(a2).toHaveAttribute('data-state', 'running')
    await page.screenshot({ path: join(output, '02-export-and-import.png') })
    await exportC.getByRole('button', { name: '取消任务' }).click()
    await expect(exportC).toHaveAttribute('data-state', 'canceled')
    await expect(exportB).toHaveAttribute('data-state', 'running')
    await release('A', 'import'); await expect(a2).toHaveAttribute('data-state', 'completed')
    await expect(page.locator('.photo-row')).toContainText('A.tif')
    await release('B', 'export'); await expect(exportB).toHaveAttribute('data-state', 'completed', { timeout: 120000 })
    expect((await stat(join(output, 'export-B.jpg'))).size).toBeGreaterThan(0)
    expect(await stat(join(output, 'export-C.jpg')).then(() => true).catch(() => false)).toBe(false)
    await expect(page.locator('.photo-row')).toContainText('A.tif')

    // Finishing B's export must not revert edits made after the snapshot.
    await select('B'); await expect(page.getByLabel('备注', { exact: true })).toHaveValue('导出过程中继续编辑')
    const projectFile = join(output, 'B.pdimpression')
    await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, projectFile)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.status')).toContainText('已保存')
    const saved = JSON.parse(await readFile(projectFile, 'utf8'))
    expect(saved.format).toBe('66'); expect(saved.notes).toBe('导出过程中继续编辑')
    expect(saved.slots.filter(Boolean).map((asset: any) => basename(asset.path))).toEqual(['B.tif'])
    // Running export cancellation must remove its own incomplete file only.
    await select('C')
    const exportC2 = await startExport('C'); await expect(exportC2).toHaveAttribute('data-state', 'running')
    await expect.poll(() => desktop.evaluate(() => Boolean((globalThis as any).heldJobs.find((item: any) => item.job.kind === 'export' && item.job.project.name === '卷 C')))).toBe(true)
    const temporary = await desktop.evaluate(() => (globalThis as any).heldJobs.find((item: any) => item.job.kind === 'export' && item.job.project.name === '卷 C').job.temporary as string)
    expect(temporary.startsWith(output)).toBe(true)
    await writeFile(temporary, 'incomplete test output')
    await exportC2.getByRole('button', { name: '取消任务' }).click()
    await expect(exportC2).toHaveAttribute('data-state', 'canceled')
    expect(await stat(temporary).then(() => true).catch(() => false)).toBe(false)
    expect((await stat(join(output, 'export-B.jpg'))).size).toBeGreaterThan(0)
    // A failed worker must not corrupt a completed import in the same or another project.
    await select('A')
    const failedA = await startImport('A'); await expect(failedA).toHaveAttribute('data-state', 'running')
    await expect.poll(() => desktop.evaluate(() => Boolean((globalThis as any).heldJobs.find((item: any) => item.job.kind === 'import' && item.job.paths.some((p: string) => p.endsWith('A.tif')))))).toBe(true)
    await desktop.evaluate(() => (globalThis as any).heldJobs.find((item: any) => item.job.kind === 'import' && item.job.paths.some((p: string) => p.endsWith('A.tif'))).child.kill())
    await expect(failedA).toHaveAttribute('data-state', 'failed')
    await expect(page.locator('.photo-row')).toContainText('A.tif')
    await select('B'); await expect(page.locator('.photo-row')).toContainText('B.tif')
    expect((await readdir(output)).filter(name => name.startsWith('.pdimpression-'))).toEqual([])
    expect(errors).toEqual([])
    await page.screenshot({ path: join(output, '03-completed.png') })
    console.log(`Multitask smoke passed: concurrent imports, bounded queue, project isolation, queued/running cancellation, temporary cleanup, worker failure, snapshot export and edits retained. ${output}`)
  } catch (error) {
    await desktop.windows()[0]?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await desktop.close().catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
