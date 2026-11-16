import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess, type UtilityProcess } from 'electron'
import { readFile, writeFile, readdir, stat, mkdir, rename, rm } from 'node:fs/promises'
import { join, dirname, resolve, isAbsolute, relative, extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { projectSchema, templateSchema, defaultTemplate, type Asset, type Project, type ExportResult } from '../shared/model'
import { exportErrors } from '../shared/layout'

let window: BrowserWindow
let activeTask: { child: UtilityProcess; reject: (error: Error) => void; temporary?: string } | null = null
let dirty = false
let canClose = false
const imagePattern = /\.(tiff?|jpe?g)$/i
const stateDir = () => join(app.getPath('userData'), 'state')
const isCanceled = (error: unknown) => error instanceof Error && error.message === '任务已取消。'
const comparablePath = (file: string) => process.platform === 'win32' ? resolve(file).toLowerCase() : resolve(file)
const isSourcePath = (project: Project, file: string) => [...project.slots, ...project.overflow].some(a => a && comparablePath(a.path) === comparablePath(file))

function runTask<T>(job: Record<string, unknown>): Promise<T> {
  if (activeTask) return Promise.reject(new Error('已有图片任务正在处理。'))
  return new Promise((resolveResult, reject) => {
    const child = utilityProcess.fork(join(__dirname, 'worker.js'), [], { serviceName: 'PD Impression Images', stdio: 'pipe' })
    const task = { child, reject, temporary: job.temporary as string | undefined }
    activeTask = task
    let settled = false
    const finish = (result: T | undefined, error?: Error) => {
      if (settled) return
      settled = true
      if (activeTask === task) activeTask = null
      child.kill()
      if (error) reject(error)
      else resolveResult(result as T)
    }
    task.reject = error => finish(undefined, error)
    child.on('message', message => {
      if (message.type === 'progress') window?.webContents.send('task:progress', message.progress)
      if (message.type === 'done') finish(message.result)
      if (message.type === 'error') finish(undefined, new Error(message.message))
    })
    child.on('exit', code => { if (!settled) finish(undefined, new Error(`图片处理进程退出（${code}），请重试。`)) })
    child.once('spawn', () => child.postMessage(job))
    child.stderr?.on('data', data => console.error('[images]', data.toString()))
  })
}
async function cancelTask() {
  if (!activeTask) return
  const task = activeTask
  const exited = new Promise<void>(resolveExit => {
    const timer = setTimeout(resolveExit, 3000)
    task.child.once('exit', () => { clearTimeout(timer); resolveExit() })
  })
  task.reject(new Error('任务已取消。'))
  await exited
  if (task.temporary) await rm(task.temporary, { force: true }).catch(() => {})
}
async function importPaths(raw: string[]): Promise<{ assets: Asset[]; skipped: number; duplicates: number }> {
  const paths = z.array(z.string().max(4096)).max(1000).parse(raw)
  const candidates: string[] = []
  let skipped = 0
  for (const input of paths) {
    const absolute = resolve(input)
    let info
    try { info = await stat(absolute) } catch { candidates.push(absolute); continue }
    if (info.isDirectory()) {
      for (const entry of await readdir(absolute, { withFileTypes: true })) {
        if (entry.isFile() && imagePattern.test(entry.name)) candidates.push(join(absolute, entry.name))
        else skipped++
      }
    } else if (info.isFile() && imagePattern.test(absolute)) candidates.push(absolute)
    else skipped++
  }
  const unique = [...new Set(candidates)]
  unique.sort((a, b) => basename(a).localeCompare(basename(b), 'zh-CN', { numeric: true }) || a.localeCompare(b))
  if (unique.length > 542) throw new Error('一次最多导入 542 个文件，请选择单卷照片。')
  const assets = unique.length ? await runTask<Asset[]>({ kind: 'import', paths: unique }) : []
  return { assets, skipped, duplicates: candidates.length - unique.length }
}
async function atomicJson(file: string, value: unknown) {
  const temp = join(dirname(file), `.pdimpression-${randomUUID()}.tmp`)
  try { await writeFile(temp, JSON.stringify(value, null, 2), 'utf8'); await rename(temp, file) }
  finally { await rm(temp, { force: true }).catch(() => {}) }
}
async function loadTemplate() {
  try { return templateSchema.parse(JSON.parse(await readFile(join(stateDir(), 'template.json'), 'utf8'))) }
  catch { return structuredClone(defaultTemplate) }
}

function registerHandlers() {
  const handle = (name: string, fn: (...args: any[]) => unknown) => ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效调用来源。')
    return fn(...args)
  })
  handle('photos:choose', async (kind: 'files' | 'folder') => {
    const choice = await dialog.showOpenDialog(window, { title: '导入一卷扫描照片',
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
      filters: [{ name: 'TIFF / JPEG', extensions: ['tif', 'tiff', 'jpg', 'jpeg'] }] })
    return choice.canceled ? null : importPaths(choice.filePaths)
  })
  handle('photos:drop', (paths: string[]) => importPaths(paths))
  handle('photos:replace', async () => {
    const choice = await dialog.showOpenDialog(window, { title: '替换或重新定位照片', properties: ['openFile'], filters: [{ name: '照片', extensions: ['tif', 'tiff', 'jpg', 'jpeg'] }] })
    if (choice.canceled) return null
    return (await importPaths(choice.filePaths)).assets[0] ?? null
  })
  handle('project:save', async (raw: unknown, saveAs: boolean, currentPath: unknown = null, otherOpenPaths: unknown = []) => {
    const project = projectSchema.parse(raw)
    let target = z.string().max(4096).refine(isAbsolute).nullable().parse(currentPath)
    const reservedPaths = z.array(z.string().max(4096).refine(isAbsolute)).max(500).parse(otherOpenPaths)
    if (!target || saveAs) {
      const choice = await dialog.showSaveDialog(window, { title: '保存项目（不包含原始照片）', defaultPath: target ?? `${(project.name || project.roll || '新胶卷').replace(/[<>:"/\\|?*]/g, '_')}.pdimpression`, filters: [{ name: 'PD Impression 项目', extensions: ['pdimpression'] }] })
      if (choice.canceled || !choice.filePath) return null
      target = choice.filePath
    }
    const stored = structuredClone(project)
    if (reservedPaths.some(file => comparablePath(file) === comparablePath(target!))) throw new Error('该文件属于另一个已打开的项目，请使用不同文件名，避免覆盖。')
    if (isSourcePath(project, target)) throw new Error('项目不能保存到原图路径，请选择另一个文件。')
    for (const a of [...stored.slots, ...stored.overflow]) if (a) {
      a.preview = ''
      a.path = relative(dirname(target), a.path) || a.path
    }
    await atomicJson(target, stored)
    return target
  })
  handle('project:open', async () => {
    const choice = await dialog.showOpenDialog(window, { title: '打开项目', properties: ['openFile'], filters: [{ name: 'PD Impression 项目', extensions: ['pdimpression'] }] })
    if (choice.canceled) return null
    const file = choice.filePaths[0]
    if ((await stat(file)).size > 20_000_000) throw new Error('项目文件过大或格式异常。')
    const project = projectSchema.parse(JSON.parse(await readFile(file, 'utf8')))
    const all = [...project.slots, ...project.overflow].filter((a): a is Asset => Boolean(a))
    const paths = all.map(a => isAbsolute(a.path) ? a.path : resolve(dirname(file), a.path))
    const refreshed = paths.length ? await runTask<Asset[]>({ kind: 'import', paths }) : []
    all.forEach((a, index) => Object.assign(a, refreshed[index], { id: a.id, rotation: a.rotation }))
    return { project, path: file }
  })
  handle('project:new', () => {})
  handle('template:load', loadTemplate)
  handle('template:save', async (raw: unknown) => {
    await mkdir(stateDir(), { recursive: true })
    await atomicJson(join(stateDir(), 'template.json'), templateSchema.parse(raw))
  })
  handle('sheet:export', async (raw: unknown, options: unknown): Promise<ExportResult> => {
    const project = projectSchema.parse(raw)
    const opts = z.object({ widths: z.array(z.union([z.literal(6000), z.literal(8000), z.literal(10000)])).length(1), quality: z.number().int().min(70).max(100), acceptUntagged: z.boolean() }).parse(options)
    const errors = exportErrors(project)
    if (errors.length) throw new Error(errors.join('\n'))
    if (!opts.acceptUntagged && project.slots.some(a => a && !a.hasIcc)) throw new Error('请先确认无 ICC 图片按 sRGB／灰度解释。')
    const selected = await dialog.showOpenDialog(window, { title: '选择索引图输出文件夹', properties: ['openDirectory', 'createDirectory'] })
    const result: ExportResult = { files: [], canceled: selected.canceled, errors: [] }
    if (selected.canceled) return result
    const stem = (project.roll.trim() || '未命名胶卷').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || '胶卷'
    for (const width of [...new Set(opts.widths)]) {
      const label = '高清'
      const destination = join(selected.filePaths[0], `${stem}_索引_${label}_${width}px.jpg`)
      try {
        if (isSourcePath(project, destination)) throw new Error('输出文件与原图路径相同，请更换目录或卷号，原图不能被覆盖。')
        if (await stat(destination).then(() => true).catch(() => false)) {
          const response = await dialog.showMessageBox(window, { type: 'question', message: `${basename(destination)} 已存在`, detail: '是否覆盖该成品？', buttons: ['取消', '覆盖'], defaultId: 0, cancelId: 0 })
          if (response.response !== 1) { result.canceled = true; break }
        }
        const temporary = join(dirname(destination), `.pdimpression-${randomUUID()}.jpg`)
        await runTask({ kind: 'export', project, width, quality: opts.quality, destination, temporary })
        result.files.push(destination)
      } catch (error) {
        if (isCanceled(error)) { result.canceled = true; break }
        result.errors.push(`${label}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return result
  })
  handle('task:cancel', cancelTask)
  handle('file:reveal', (file: string) => { if (typeof file === 'string' && isAbsolute(file)) shell.showItemInFolder(file) })
  ipcMain.on('project:dirty', (event, value) => { if (event.sender === window.webContents) dirty = Boolean(value) })
}

app.whenReady().then(() => {
  window = new BrowserWindow({ width: 1500, height: 980, minWidth: 1120, minHeight: 740,
    title: 'PD Impression', backgroundColor: '#f4f3ef', show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  window.setMenuBarVisibility(false)
  registerHandlers()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.once('ready-to-show', () => { if (process.env.PDIMPRESSION_TEST !== '1') window.show() })
  window.on('close', event => {
    if (canClose) return
    if (dirty || activeTask) {
      event.preventDefault()
      void dialog.showMessageBox(window, { type: 'question', message: activeTask ? '图片任务仍在进行，确定退出吗？' : '有尚未保存的修改', detail: '选择“返回”后可在工具栏保存项目。退出会放弃未保存修改。', buttons: ['返回', '放弃并退出'], defaultId: 0, cancelId: 0 }).then(async choice => {
        if (choice.response === 1) { await cancelTask(); canClose = true; window.close() }
      })
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
