import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { addAssets, defaultTemplate, insertBlank, moveSlot, newProject, photoCount, removeAndShift,
  type Project, type Template, type TaskProgress, type TaskContext, type ImportResult } from '../../shared/model'
import { exportErrors, layoutSheet, sheetSvg, newScanProject, fitProjectPage, rollHeader } from '../../shared/layout'
import { projectProfile, ratioLabel, capacityLabel, rotationForProfile, type ScanType } from '../../shared/scan-types'
import { filmStockGroups, isPresetFilm, OTHER_FILM } from '../../shared/film-stocks'
import { scannerOptions, isPresetScanner, OTHER_SCANNER } from '../../shared/scanners'
import { fixedLogo } from '../../shared/branding'
import { DEFAULT_JPEG_QUALITY, defaultExportName, exportFilename } from '../../shared/export-settings'
import ProjectNavigation from './ProjectNavigation'
import ScanTypePicker from './ScanTypePicker'
import { measureHeaderOrderY } from './header-spacing'

type Tab = 'info' | 'template' | 'photo'
const photoDragType = 'application/x-pdimpression-photo'
const api = window.desktop
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '')
interface BackgroundTask extends TaskContext {
  title: string; kind: 'import' | 'export'
  state: 'preparing' | 'queued' | 'running' | 'canceling' | 'completed' | 'canceled' | 'failed'
  message: string; current: number; total: number; files: string[]; dismissAt?: number
}
const taskPending = (task: BackgroundTask) => ['preparing', 'queued', 'running', 'canceling'].includes(task.state)
const taskStatus = (task: BackgroundTask) => {
  const action = task.kind === 'import' ? '导入' : '导出'
  if (task.state === 'running') return `正在${action}`
  if (task.state === 'queued') return `等待${action}`
  if (task.state === 'preparing') return `准备${action}`
  if (task.state === 'canceling') return `正在取消${action}`
  if (task.state === 'canceled') return `${action}已取消`
  return task.message
}

interface ProjectSession {
  id: string; project: Project; path: string | null; saved: boolean
  selected: number | null; tab: Tab; zoom: number; undo: Project[]; redo: Project[]
  editingOtherFilm: boolean; editingOtherScanner: boolean; highWidth: number; acceptIcc: boolean
  notice: string; problem: string; exportName: string | null
}
const createSession = (project: Project, id: string, path: string | null = null): ProjectSession => ({
  id, project, path, saved: true, selected: null, tab: 'info', zoom: 1, undo: [], redo: [],
  editingOtherFilm: false, editingOtherScanner: false, highWidth: 8000, acceptIcc: false, exportName: null,
  notice: path ? '项目已打开并重新检查原图。' : '所有照片在本机处理，原图保持不变。', problem: ''
})
const projectTitle = (session: ProjectSession) => session.project.name.trim()
  || session.path?.split(/[\\/]/).pop()?.replace(/\.pdimpression$/i, '') || session.project.roll.trim() || '未命名项目'
const normalizedProjectPath = (value: string) => /^[a-z]:[\\/]/i.test(value) ? value.replace(/\\/g, '/').toLowerCase() : value

function Button({ children, onClick, disabled, primary, title, className = '' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; title?: string; className?: string
}) { return <button title={title} className={`${primary ? 'primary' : ''} ${className}`} onClick={onClick} disabled={disabled}>{children}</button> }
function NumberField({ label, value, onChange, min = 0, max = 200, step = 0.5 }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number
}) { return <label className="field"><span>{label}</span><div className="unit-input"><input type="number" aria-label={label} min={min} max={max} step={step} value={value}
  onChange={event => { const n = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n) }} /><small>mm</small></div></label> }

export default function App() {
  // 无项目时只显示欢迎页面；这份空白数据不加入项目目录。
  const [project, setProject] = useState<Project>(() => newProject())
  const [activeId, setActiveId] = useState('')
  const [sessions, setSessions] = useState<ProjectSession[]>([])
  const [closingId, setClosingId] = useState<string | null>(null)
  const [showTypePicker, setShowTypePicker] = useState(false)
  const defaultTemplateRef = useRef(defaultTemplate)
  const [editingOtherFilm, setEditingOtherFilm] = useState(false)
  const [editingOtherScanner, setEditingOtherScanner] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('info')
  const [foregroundBusy, setBusy] = useState(false)
  const [progress, setProgress] = useState<TaskProgress | null>(null)
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([])
  const [tasksCollapsed, setTasksCollapsed] = useState(false)
  const tasksRef = useRef<BackgroundTask[]>([])
  const updateTasks = (update: (tasks: BackgroundTask[]) => BackgroundTask[]) => {
    tasksRef.current = update(tasksRef.current); setBackgroundTasks(tasksRef.current)
  }
  useEffect(() => {
    const deadlines = backgroundTasks.flatMap(task => task.dismissAt === undefined ? [] : [task.dismissAt])
    if (!deadlines.length) return
    const timer = window.setTimeout(() => {
      const now = Date.now()
      updateTasks(tasks => tasks.filter(task => task.dismissAt === undefined || task.dismissAt > now))
    }, Math.max(0, Math.min(...deadlines) - Date.now()))
    return () => window.clearTimeout(timer)
  }, [backgroundTasks])
  useEffect(() => {
    if (!backgroundTasks.length || backgroundTasks.some(taskPending)) return
    const timer = window.setTimeout(() => setTasksCollapsed(true), 4000)
    return () => window.clearTimeout(timer)
  }, [backgroundTasks])
  const importing = backgroundTasks.some(task => task.projectId === activeId && task.kind === 'import' && taskPending(task))
  const exporting = backgroundTasks.some(task => task.projectId === activeId && task.kind === 'export' && taskPending(task))
  const busy = foregroundBusy || importing
  const [notice, setNotice] = useState('所有照片在本机处理，原图保持不变。')
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState(true)
  const [path, setPath] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [dropActive, setDropActive] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [highWidth, setHighWidth] = useState(8000)
  const [exportName, setExportName] = useState<string | null>(null)
  const [acceptIcc, setAcceptIcc] = useState(false)
  const [historyCount, setHistoryCount] = useState(0)
  const undo = useRef<Project[]>([]), redo = useRef<Project[]>([])
  const dragIndex = useRef<number | null>(null)
  const projectRef = useRef(project)
  projectRef.current = project
  const layout = useMemo(() => layoutSheet(project), [project])
  const header = rollHeader(project)
  const headerKey = JSON.stringify([header.title, header.titleSize, header.order, header.details])
  const [headerSpacing, setHeaderSpacing] = useState<{ key: string; y: number } | null>(null)
  useEffect(() => {
    let current = true
    measureHeaderOrderY({ title: header.title, titleSize: header.titleSize, order: header.order, details: header.details })
      .then(y => { if (current) setHeaderSpacing({ key: headerKey, y }) })
      .catch(error => { if (current) setProblem(errorText(error)) })
    return () => { current = false }
  }, [headerKey])
  const orderY = headerSpacing?.key === headerKey ? headerSpacing.y : undefined
  const svg = useMemo(() => sheetSvg(project, { pictures: true, selected: selected ?? undefined, orderY }), [project, selected, orderY])
  const count = photoCount(project)
  const profile = projectProfile(project)
  const capacity = project.slots.length
  const unit = profile.mode === 'strip' ? '条' : '张'
  const selectedPhoto = selected === null ? null : project.slots[selected]
  const errors = exportErrors(project)
  const exportNameValue = exportName ?? defaultExportName(project.roll, highWidth)
  let filenamePreview = '', filenameError = ''
  try { filenamePreview = exportFilename(exportNameValue) } catch (error) { filenameError = errorText(error) }
  const untagged = project.slots.filter(a => a && !a.hasIcc && a.status === 'ready').length
  // 旧项目中的自定义名称自动归入“其他”，保留原有文本。
  const showOtherFilm = editingOtherFilm || (project.film !== '' && !isPresetFilm(project.film))
  const showOtherScanner = editingOtherScanner || (project.scanner !== '' && !isPresetScanner(project.scanner))
  const currentSession: ProjectSession = { id: activeId, project, path, saved, selected, tab, zoom,
    undo: undo.current, redo: redo.current, editingOtherFilm, editingOtherScanner, highWidth, acceptIcc, notice, problem, exportName }
  const allSessions = sessions.map(session => session.id === activeId ? currentSession : session)
  const sessionsRef = useRef(allSessions)
  const activeIdRef = useRef(activeId)
  sessionsRef.current = allSessions; activeIdRef.current = activeId
  const progressLabel = (id: string) => backgroundTasks.filter(task => task.projectId === id && taskPending(task)).map(task =>
    `${task.kind === 'import' ? '导入' : '导出'}${task.state === 'queued' ? '等待中' : task.state === 'canceling' ? '取消中' : task.total ? ` ${task.current}/${task.total}` : '准备中'}`).join(' · ')
  const projectItems = allSessions.map(session => ({ id: session.id, title: projectTitle(session),
    count: photoCount(session.project), saved: session.saved, path: session.path,
    unit: projectProfile(session.project).mode === 'strip' ? '条' : '张', taskProgress: progressLabel(session.id),
    taskActive: backgroundTasks.some(task => task.projectId === session.id && taskPending(task)) }))

  useEffect(() => {
    api.loadTemplate().then(template => { defaultTemplateRef.current = template }).catch(error => setProblem(errorText(error)))
    return api.onProgress(value => {
      if (!value.projectId) { setProgress(value); return }
      updateTasks(tasks => tasks.map(task => task.taskId === value.taskId && taskPending(task)
        ? { ...task, ...value, state: task.state === 'canceling' ? 'canceling' : value.state } : task))
    })
  }, [])
  useEffect(() => { api.dirty(allSessions.some(session => !session.saved)) }, [saved, sessions, activeId])
  useEffect(() => {
    const clearDrag = () => { dragIndex.current = null; setDropActive(false) }
    const cancelDrag = (event: KeyboardEvent) => { if (event.key === 'Escape') clearDrag() }
    window.addEventListener('dragend', clearDrag)
    window.addEventListener('blur', clearDrag)
    window.addEventListener('keydown', cancelDrag)
    return () => {
      window.removeEventListener('dragend', clearDrag)
      window.removeEventListener('blur', clearDrag)
      window.removeEventListener('keydown', cancelDrag)
    }
  }, [])

  // Background completions always update their originating session, including inactive tabs.
  const updateSession = (id: string, update: (session: ProjectSession) => ProjectSession) => {
    const previous = sessionsRef.current.find(session => session.id === id)
    if (!previous) return
    const next = update(previous)
    const updated = sessionsRef.current.map(session => session.id === id ? next : session)
    sessionsRef.current = updated; setSessions(updated)
    if (activeIdRef.current === id) {
      projectRef.current = next.project; setProject(next.project); setPath(next.path); setSaved(next.saved)
      setNotice(next.notice); setProblem(next.problem); setAcceptIcc(next.acceptIcc)
      undo.current = next.undo; redo.current = next.redo; setHistoryCount(n => n + 1)
    }
  }
  const change = (next: Project) => {
    if (busy || !activeId) return
    updateSession(activeId, session => ({ ...session, project: next, saved: false,
      undo: [...session.undo, session.project].slice(-40), redo: [] }))
  }
  const templateChange = <K extends keyof Template>(key: K, value: Template[K]) => change({ ...project, template: { ...project.template, [key]: value } })
  const fieldChange = (key: 'roll' | 'film' | 'date' | 'notes' | 'scanner', value: string) => change({ ...project, [key]: value })
  const doUndo = () => {
    updateSession(activeId, session => {
      const previous = session.undo.at(-1)
      return previous ? { ...session, project: previous, undo: session.undo.slice(0, -1), redo: [...session.redo, session.project], saved: false } : session
    })
    setEditingOtherFilm(false); setEditingOtherScanner(false)
  }
  const doRedo = () => {
    updateSession(activeId, session => {
      const next = session.redo.at(-1)
      return next ? { ...session, project: next, redo: session.redo.slice(0, -1), undo: [...session.undo, session.project], saved: false } : session
    })
    setEditingOtherFilm(false); setEditingOtherScanner(false)
  }
  const restoreSession = (session: ProjectSession) => {
    activeIdRef.current = session.id
    setActiveId(session.id); setProject(session.project); projectRef.current = session.project
    setPath(session.path); setSaved(session.saved); setSelected(session.selected); setTab(session.tab); setZoom(session.zoom)
    setEditingOtherFilm(session.editingOtherFilm); setEditingOtherScanner(session.editingOtherScanner)
    setHighWidth(session.highWidth); setAcceptIcc(session.acceptIcc)
    setExportName(session.exportName)
    setNotice(session.notice); setProblem(session.problem); setShowExport(false); setShowTypePicker(false); setDropActive(false)
    undo.current = session.undo; redo.current = session.redo; setHistoryCount(n => n + 1)
  }
  const selectSession = (id: string) => {
    if (foregroundBusy || closingId || id === activeIdRef.current) return
    const target = sessionsRef.current.find(session => session.id === id)
    if (target) { setSessions(sessionsRef.current); restoreSession(target) }
  }
  const renameSession = (id: string, name: string) => {
    if (foregroundBusy || !name.trim()) return
    updateSession(id, session => ({ ...session, project: { ...session.project, name }, saved: false,
      undo: [...session.undo, session.project].slice(-40), redo: [] }))
  }
  const removeSession = (id: string) => {
    if (tasksRef.current.some(task => task.projectId === id && taskPending(task))) return
    const remaining = sessionsRef.current.filter(session => session.id !== id)
    sessionsRef.current = remaining
    if (!remaining.length) {
      setSessions([])
      restoreSession(createSession(newProject(defaultTemplateRef.current), ''))
    } else {
      setSessions(remaining)
      if (id === activeId) restoreSession(remaining[Math.min(Math.max(0, allSessions.findIndex(s => s.id === id) - 1), remaining.length - 1)])
    }
    setClosingId(null)
  }
  const closeSession = (id: string) => {
    if (foregroundBusy || tasksRef.current.some(task => task.projectId === id && taskPending(task))) return
    const session = sessionsRef.current.find(item => item.id === id)
    if (!session) return
    if (!session.saved) setClosingId(id)
    else removeSession(id)
  }
  const task = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (foregroundBusy) return
    setBusy(true); setProblem(''); setProgress(null)
    try { return await fn() }
    catch (error) { const message = errorText(error); if (message.includes('任务已取消')) setNotice('任务已取消，现有项目保持不变。'); else setProblem(message) }
    finally { setBusy(false); setProgress(null) }
  }
  const beginBackground = (kind: 'import' | 'export'): BackgroundTask | null => {
    const session = sessionsRef.current.find(session => session.id === activeIdRef.current)
    if (!session || tasksRef.current.some(task => task.projectId === session.id && task.kind === kind && taskPending(task))) return null
    const next: BackgroundTask = { taskId: crypto.randomUUID(), projectId: session.id, title: projectTitle(session), kind,
      state: 'preparing', message: kind === 'import' ? '选择导入文件…' : '选择输出文件夹…', current: 0, total: 0, files: [] }
    updateTasks(tasks => [...tasks, next]); setTasksCollapsed(false); return next
  }
  const finishBackground = (id: string, patch: Partial<BackgroundTask>) => updateTasks(tasks => tasks.map(task => {
    if (task.taskId !== id) return task
    const next = { ...task, ...patch }
    if (next.state === 'canceled' || (next.kind === 'import' && next.state === 'completed')) {
      next.dismissAt ??= Date.now() + 2000
    }
    return next
  }))
  const importBackground = async (choose: (context: TaskContext) => Promise<ImportResult | null>) => {
    const pending = beginBackground('import')
    if (!pending) return
    try {
      const result = await choose({ taskId: pending.taskId, projectId: pending.projectId })
      if (!result) { finishBackground(pending.taskId, { state: 'canceled', message: '已取消导入' }); return }
      let message = '导入完成'
      updateSession(pending.projectId, session => {
        const before = session.project, profile = projectProfile(before), unit = profile.mode === 'strip' ? '条' : '张'
        let next = addAssets(before, result.assets.map(asset => ({ ...asset, rotation: rotationForProfile(asset, profile) })))
        if (next.slots.length !== before.slots.length) next = fitProjectPage(next)
        const added = photoCount(next) + next.overflow.length - photoCount(before) - before.overflow.length
        const failures = result.assets.filter(asset => asset.status === 'error').length
        message = `导入完成 · ${added} ${unit}${failures ? `，${failures} 个文件读取失败` : ''}${next.overflow.length ? `，超量 ${next.overflow.length} ${unit}` : ''}`
        return { ...session, project: next, saved: false, undo: [...session.undo, before].slice(-40), redo: [], acceptIcc: false,
          notice: `导入 ${added} ${unit}；忽略 ${result.skipped} 个非照片项目；重复 ${result.duplicates + result.assets.length - added} ${unit}。`,
          problem: next.overflow.length ? `已超出 ${next.slots.length} 格容量 ${next.overflow.length} ${unit}，请处理左侧超量文件后再导出。` : '' }
      })
      finishBackground(pending.taskId, { state: 'completed', message })
    } catch (error) {
      const message = errorText(error), canceled = message.includes('任务已取消')
      finishBackground(pending.taskId, { state: canceled ? 'canceled' : 'failed', message })
    }
  }
  const importPhotos = async (kind: 'files' | 'folder') => {
    if (!activeId) { setShowTypePicker(true); return }
    await importBackground(context => api.chooseImport(kind, context))
  }
  const save = async (saveAs = false) => {
    if (!activeId) return false
    const id = activeIdRef.current, snapshot = projectRef.current
    const otherPaths = sessionsRef.current.filter(session => session.id !== id && session.path).map(session => session.path!)
    const filename = await task(() => api.saveProject(snapshot, saveAs, path, otherPaths))
    if (filename) { updateSession(id, session => ({ ...session, path: filename, saved: session.project === snapshot, notice: '项目已保存。项目引用原图，请保留原图文件。' })); return true }
    return false
  }
  const open = async () => {
    const opened = await task(() => api.openProject())
    if (!opened) return
    const existing = sessionsRef.current.find(session => session.path && normalizedProjectPath(session.path) === normalizedProjectPath(opened.path))
    if (existing) { setSessions(sessionsRef.current); restoreSession(existing); setProblem(''); setNotice('项目已打开，已切换到对应标签。'); return }
    const next = createSession(opened.project, crypto.randomUUID(), opened.path)
    sessionsRef.current = [...sessionsRef.current, next]; setSessions(sessionsRef.current); restoreSession(next)
  }
  const fresh = () => { if (!foregroundBusy) setShowTypePicker(true) }
  const chooseType = async (format: ScanType) => {
    const template = await task(() => api.loadTemplate())
    if (!template) return
    defaultTemplateRef.current = template
    // 只检查当前打开项目的名称，关闭或重命名后即可复用空出的编号。
    const usedNames = new Set(sessionsRef.current.map(projectTitle))
    let number = 1
    while (usedNames.has(`未命名项目 ${number}`)) number++
    const next = createSession({ ...newScanProject(template, format), name: `未命名项目 ${number}` }, crypto.randomUUID())
    sessionsRef.current = [...sessionsRef.current, next]; setSessions(sessionsRef.current); restoreSession(next)
  }
  const saveAndClose = async () => {
    const session = sessionsRef.current.find(item => item.id === closingId)
    if (!session) return
    const otherPaths = sessionsRef.current.filter(item => item.id !== session.id && item.path).map(item => item.path!)
    const filename = await task(() => api.saveProject(session.project, false, session.path, otherPaths))
    if (filename) removeSession(session.id)
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || busy || closingId || showTypePicker) return
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void save(event.shiftKey) }
      if (event.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) {
        event.preventDefault(); event.shiftKey ? doRedo() : doUndo()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const editPhoto = (action: 'left' | 'right' | 'blank' | 'remove' | 'insert') => {
    if (selected === null) return
    try {
      if (action === 'remove') return change(removeAndShift(project, selected))
      if (action === 'insert') return change(insertBlank(project, selected))
      const next = { ...project, slots: [...project.slots] }
      if (action === 'blank') next.slots[selected] = null
      else if (next.slots[selected]) next.slots[selected] = { ...next.slots[selected]!, rotation: ((next.slots[selected]!.rotation + (action === 'left' ? 270 : 90)) % 360) as 0 | 90 | 180 | 270 }
      change(next)
    } catch (error) { setProblem(errorText(error)) }
  }
  const replace = async () => {
    if (selected === null) return
    const asset = await task(() => api.replacePhoto())
    if (asset) {
      const next = { ...project, slots: [...project.slots] }; next.slots[selected] = { ...asset, rotation: rotationForProfile(asset, profile) }
      undo.current.push(project); redo.current = []; setProject(next); setSaved(false); setAcceptIcc(false)
    }
  }
  const drop = async (event: DragEvent) => {
    event.preventDefault(); setDropActive(false)
    if (dragIndex.current !== null || event.dataTransfer.types.includes(photoDragType)) { dragIndex.current = null; return }
    if (!event.dataTransfer.files.length || busy || showTypePicker || closingId) return
    if (!activeId) { setNotice('请先选择扫描类型，再拖入照片或整条扫描文件。'); return }
    const files = Array.from(event.dataTransfer.files)
    await importBackground(context => api.importDropped(files, context))
  }
  const runExport = async () => {
    if (filenameError || importing) return
    const pending = beginBackground('export')
    if (!pending) return
    const snapshot = structuredClone(projectRef.current)
    const options = { widths: [highWidth], quality: DEFAULT_JPEG_QUALITY, acceptUntagged: acceptIcc, filename: exportNameValue }
    setShowExport(false)
    try {
      const result = await api.exportProject(snapshot, options, { taskId: pending.taskId, projectId: pending.projectId })
      const message = result.canceled ? '导出已取消' : result.errors.length ? result.errors.join('\n') : '导出完成'
      finishBackground(pending.taskId, { state: result.canceled ? 'canceled' : result.errors.length ? 'failed' : 'completed', message, files: result.files })
      updateSession(pending.projectId, session => ({ ...session, notice: result.files.length ? `已导出 ${result.files.length} 个文件。` : session.notice }))
    } catch (error) {
      const message = errorText(error)
      finishBackground(pending.taskId, { state: message.includes('任务已取消') ? 'canceled' : 'failed', message })
    }
  }
  const cancelBackground = async (pending: BackgroundTask) => {
    finishBackground(pending.taskId, { state: 'canceling', message: '正在取消…' })
    try { await api.cancelTask(pending.taskId) }
    catch (error) { finishBackground(pending.taskId, { state: 'failed', message: errorText(error) }) }
  }

  return <div className={`app ${dropActive ? 'file-hover' : ''}`} onDragOver={event => {
    event.preventDefault()
    setDropActive(dragIndex.current === null && !event.dataTransfer.types.includes(photoDragType)
      && event.dataTransfer.types.includes('Files') && !busy && !showTypePicker && !closingId)
  }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false) }} onDrop={drop}>
    <header className="toolbar">
      <div className="identity"><img className="brand-icon" src={fixedLogo.data} alt="PD Darkroom Logo"/><div><strong>PD Impression</strong><small>暗房胶卷索引</small></div></div>
      <div className="tools"><Button disabled={foregroundBusy} onClick={() => void fresh()}>＋ 新建</Button><Button disabled={foregroundBusy} onClick={() => void open()}>打开项目</Button>
        <Button disabled={busy} onClick={() => void importPhotos('files')}>导入照片</Button><Button disabled={busy || !activeId} onClick={() => void save()}>保存</Button>
        <Button disabled={busy || !activeId} onClick={() => void save(true)} title="另存项目">另存</Button>
        <span className="separator"/><Button title="撤销 Ctrl/Cmd Z" disabled={busy || !undo.current.length} onClick={doUndo}>↶</Button><Button title="重做" disabled={busy || !redo.current.length} onClick={doRedo}>↷</Button>
      </div>
      <div className="toolbar-end"><span className="offline"><i/> 本地离线</span><Button primary disabled={busy || exporting || !count} onClick={() => { setShowExport(true) }}>导出接触印象 ↗</Button></div>
    </header>
    <main className="workspace">
      <aside className="library">
        <section className="project-directory">
          <div className="project-directory-heading"><h2>项目目录 <span className="badge">{sessions.length}</span></h2><button className="text-button" disabled={foregroundBusy} onClick={() => void fresh()}>＋ 新建</button></div>
          <ProjectNavigation items={projectItems} activeId={activeId} disabled={foregroundBusy || Boolean(closingId)} mode="directory"
            onSelect={selectSession} onRename={renameSession} onClose={closeSession} onNew={() => void fresh()}/>
        </section>
        <div className="panel-heading"><h2>{profile.mode === 'strip' ? '本卷扫描条' : '本卷照片'} <span className="badge">{count}</span></h2><button className="text-button" disabled={busy} onClick={() => void importPhotos('folder')}>导入文件夹</button></div>
        <div className="sort-bar"><span>文件名自然排序</span><button className="text-button" disabled={busy || !count} onClick={() => {
          const sorted = project.slots.filter(a => a !== null).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
          change({ ...project, slots: [...sorted, ...Array.from({ length: capacity - sorted.length }, () => null)] })
        }}>重新排序 ↓</button></div>
        <div className="photo-list">
          {!count && <div className="list-empty"><span>▧</span><p>一卷的故事<br/>从第一张照片开始</p></div>}
          {project.slots.map((asset, index) => (asset || selected === index || (count > 0 && index <= project.slots.findLastIndex(Boolean))) &&
            <button className={`photo-row ${selected === index ? 'active' : ''} ${asset?.status === 'error' ? 'failed' : ''}`} key={asset?.id ?? `empty-${index}`}
              draggable={!busy && Boolean(asset)} onDragStart={event => {
                dragIndex.current = index; setDropActive(false)
                event.dataTransfer.clearData()
                event.dataTransfer.setData(photoDragType, String(index))
                event.dataTransfer.effectAllowed = 'move'
              }} onDragEnd={() => { dragIndex.current = null; setDropActive(false) }}
              onDragOver={event => event.preventDefault()} onDrop={event => { if (dragIndex.current !== null) { event.preventDefault(); event.stopPropagation(); change(moveSlot(project, dragIndex.current, index)); setSelected(index); dragIndex.current = null; setDropActive(false) } }}
              onClick={() => setSelected(index)}>
              <span className="thumb">{asset?.preview ? <img src={asset.preview} alt="" draggable={false}/> : <span>{asset?.status === 'error' ? '!' : '—'}</span>}</span>
              <span className="photo-meta"><span><b>{String(index + 1).padStart(2, '0')}</b> {asset?.name ?? '空位'}</span><small>{asset ? asset.status === 'error' ? '读取失败 · 选中查看' : `${asset.name.match(/\.(tiff?)$/i) ? 'TIFF' : 'JPEG'} · ${(asset.size / 1e6).toFixed(1)} MB` : '保留黑色胶片'}</small></span>
            </button>)}
          {project.overflow.length > 0 && <div className="overflow"><strong>超出容量 {project.overflow.length} {unit}</strong><p>这些文件尚未放入成品，请处理后导出。</p>{project.overflow.map(a => <div key={a.id}><span>{a.name}</span><button onClick={() => change({ ...project, overflow: project.overflow.filter(x => x.id !== a.id) })}>移除</button></div>)}</div>}
        </div>
      </aside>
      <section className="preview-panel">
        {sessions.length > 0 && <ProjectNavigation items={projectItems} activeId={activeId} disabled={foregroundBusy || Boolean(closingId)} mode="tabs"
          onSelect={selectSession} onRename={renameSession} onClose={closeSession} onNew={() => void fresh()}/>}
        <div className="preview-heading"><div><h2>成品预览</h2><small>{activeId ? `${profile.label} / ${capacity} ${profile.mode === 'strip' ? 'STRIPS' : 'FRAMES'}` : '选择扫描类型后开始'}</small></div><div className="zoom-tools"><Button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>−</Button><span>{Math.round(zoom * 100)}%</span><Button onClick={() => setZoom(z => Math.min(5, z + 0.25))}>＋</Button><Button onClick={() => setZoom(1)}>适合窗口</Button></div></div>
        <div className="canvas-scroll">
          {!activeId ? <div className="scan-welcome">
            <img className="welcome-logo" src={fixedLogo.data} alt="PD Darkroom Logo"/>
            <ScanTypePicker disabled={foregroundBusy} onChoose={type => void chooseType(type)}/>
          </div> : !count && !project.overflow.length ? <div className="welcome">
            <img className="welcome-logo" src={fixedLogo.data} alt="PD Darkroom Logo"/>
            <p>{profile.mode === 'strip' ? '将整条扫描 TIFF 或文件夹拖到这里，每份文件完整保留' : '将扫描照片或文件夹拖到这里'}<br/>支持 TIFF 和 JPEG，全程在本机处理</p>
            <div className="welcome-actions"><Button primary disabled={busy} onClick={() => void importPhotos('files')}>选择照片</Button><Button disabled={busy} onClick={() => void importPhotos('folder')}>选择文件夹</Button></div>
            <small>{profile.label} · {capacityLabel(profile)}<br/>{project.layoutVersion === 1 ? '原版 135 模板' : `高 : 宽 = ${ratioLabel(profile)} · 按扫描比例排版`}</small>
          </div>
            : <div className="paper-wrap" style={{ width: `${Math.round(490 * zoom)}px` }}>
              <div className="paper" data-testid="sheet" onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect()
                const x = (event.clientX - rect.left) / rect.width * layout.width, y = (event.clientY - rect.top) / rect.height * layout.height
                const hit = layout.frames.find(f => x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height)
                if (hit) setSelected(hit.index)
              }} dangerouslySetInnerHTML={{ __html: svg }}/>
              <div className="paper-caption"><span>{layout.width.toFixed(0)} × {layout.height.toFixed(1)} mm</span><span>{layout.hidden > 0 ? `已隐藏末尾 ${layout.hidden} 条空白胶片` : `完整显示 ${layout.maxRows} 条胶片`}</span></div>
            </div>}
        </div>
        {layout.errors.length > 0 && count > 0 && <div className="layout-warning">{layout.errors.join(' ')}</div>}
      </section>
      <aside className="settings">
        <nav className="tabs">{([['info', '本卷信息'], ['template', '暗房模板'], ['photo', '照片']] as const).map(([value, label]) => <button className={tab === value ? 'selected' : ''} key={value} onClick={() => setTab(value)}>{label}</button>)}</nav>
        <fieldset disabled={busy || !activeId} className="settings-scroll">
          {tab === 'info' && <>
            <section className="settings-group"><div className="section-label">ROLL DETAILS<span>01</span></div><h3>本卷信息</h3>
              <label className="stack-field">扫描类型<input readOnly value={activeId ? `${profile.label}${project.layoutVersion === 1 ? ' · 原版模板' : ''}` : '请先选择扫描类型'}/></label>
              {activeId && <p className="help">{project.layoutVersion === 1 ? '原版 135 · 36×24mm 画格' : `扫描比例（高 : 宽）${ratioLabel(profile)}`}<br/>{profile.mode === 'strip' ? '每个文件是一整条；不切分、不推算照片张数。' : `${capacity} 格 · 完整保留照片，不拉伸、不裁切。`}</p>}
              <label className="stack-field">订单编号 / 拍摄者<input value={project.roll} maxLength={120} placeholder="例如 PD-001 或拍摄者姓名" onChange={e => fieldChange('roll', e.target.value)}/></label>
              <label className="stack-field">
                胶卷型号
                <select aria-label="胶卷型号" value={showOtherFilm ? OTHER_FILM : project.film} onChange={e => {
                  const other = e.target.value === OTHER_FILM
                  setEditingOtherFilm(other)
                  fieldChange('film', other ? '' : e.target.value)
                }}>
                  <option value="">请选择胶卷型号</option>
                  {filmStockGroups.map(group => <optgroup key={group.brand} label={group.brand}>
                    {group.films.map(film => <option key={film} value={film}>{film}</option>)}
                  </optgroup>)}
                  <option value={OTHER_FILM}>其他（手动填写）</option>
                </select>
              </label>
              {showOtherFilm && <label className="stack-field">
                自定义胶卷型号
                <input value={project.film} maxLength={120} placeholder="请输入品牌和型号" onChange={e => fieldChange('film', e.target.value)}/>
              </label>}
              <label className="stack-field">冲扫日期<input type="date" value={project.date} onChange={e => fieldChange('date', e.target.value)}/></label>
              <label className="stack-field">
                扫描仪
                <select aria-label="扫描仪" value={showOtherScanner ? OTHER_SCANNER : project.scanner} onChange={e => {
                  const other = e.target.value === OTHER_SCANNER
                  setEditingOtherScanner(other)
                  fieldChange('scanner', other ? '' : e.target.value)
                }}>
                  <option value="">请选择扫描仪（选填）</option>
                  {scannerOptions.map(scanner => <option key={scanner.value} value={scanner.value}>{scanner.label}</option>)}
                  <option value={OTHER_SCANNER}>其他（手动填写）</option>
                </select>
              </label>
              {showOtherScanner && <label className="stack-field">
                自定义扫描仪
                <input value={project.scanner} maxLength={120} placeholder="请输入扫描仪品牌和型号" onChange={e => {
                  setEditingOtherScanner(true)
                  fieldChange('scanner', e.target.value)
                }}/>
              </label>}
              <label className="stack-field">备注<textarea aria-label="备注" rows={3} maxLength={200} placeholder="选填，显示在模板最后一行下方" value={project.notes} onChange={e => fieldChange('notes', e.target.value)}/></label>
            </section><section className="settings-group summary"><h3>本卷概览</h3><div><span>{profile.mode === 'strip' ? '扫描条' : '照片'}</span><strong>{count} {unit}</strong></div><div><span>空位</span><strong>{activeId ? capacity - count : 0} 格</strong></div><div><span>显示胶片</span><strong>{count ? layout.rows : 0} 条</strong></div><p>所有编辑仅记录在项目中，<br/>原始扫描文件保持不变。</p></section>
            {selectedPhoto && <section className="settings-group"><h3>已选中 · {String(selected! + 1).padStart(2, '0')}</h3><p className="selected-name">{selectedPhoto.name}</p><div className="button-grid"><Button onClick={() => editPhoto('left')}>↶ 左转</Button><Button onClick={() => editPhoto('right')}>↷ 右转</Button></div><button className="text-button" onClick={() => setTab('photo')}>查看照片操作 →</button></section>}
          </>}
          {tab === 'template' && <>
            <section className="settings-group"><div className="section-label">PAGE & SPACING<span>01</span></div><h3>页面与留白</h3>
              <div className="field"><span>页面比例</span><strong className="fixed-value">A 系列 · 1:√2</strong></div>
              <NumberField label="页面宽度" value={project.template.pageWidth} min={230} max={600} step={5} onChange={v => templateChange('pageWidth', v)}/>
              <small className="help">高度联动为 {(project.template.pageWidth * Math.SQRT2).toFixed(1)}mm，胶片保持原尺寸。</small>
              {(['marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'headerGap'] as const).map((key, i) => <NumberField key={key} label={['左页边距', '右页边距', '顶部留白', '底部留白', '信息区与胶片间距'][i]} value={project.template[key]} max={key === 'headerGap' ? 100 : 200} onChange={v => templateChange(key, v)}/>)}
            </section>
            <section className="settings-group"><div className="section-label">FILM STRIPS<span>02</span></div><h3>胶片排列</h3><NumberField label="条间白缝" value={project.template.stripGap} max={30} step={0.1} onChange={v => templateChange('stripGap', v)}/>
              <label className="field"><span>水平对齐</span><select value={project.template.align} onChange={e => templateChange('align', e.target.value as Template['align'])}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
              <div className="locked">✓ 保持胶片真实比例 <span>固定</span></div>
              <label className="check"><input type="checkbox" checked={project.template.hideEmpty} onChange={e => templateChange('hideEmpty', e.target.checked)}/>隐藏末尾整条空白胶片</label><p className="help">仅隐藏整条空白，保留未满行的黑格。页面尺寸不会改变。</p>
            </section>
            <section className="settings-group"><div className="section-label">IDENTITY<span>03</span></div><h3>Logo 与品牌</h3><label className="stack-field">暗房名称<input maxLength={80} value={project.template.brand} onChange={e => templateChange('brand', e.target.value)}/></label>
              <label className="check"><input type="checkbox" checked={project.template.edgeText} onChange={e => templateChange('edgeText', e.target.checked)}/>在黑色片边显示暗房名称</label>
              <label className="field"><span>页面背景</span><input type="color" value={project.template.background} onChange={e => templateChange('background', e.target.value)}/></label>
              <NumberField label="卷信息字号" min={1.5} max={5} step={0.1} value={project.template.infoSize} onChange={v => templateChange('infoSize', v)}/>
              <label className="check"><input type="checkbox" checked={project.template.showDate} onChange={e => templateChange('showDate', e.target.checked)}/>显示冲扫日期</label>
            </section><div className="settings-actions"><Button onClick={() => change(project.layoutVersion === 1 ? { ...project, template: structuredClone(defaultTemplate) } : fitProjectPage({ ...project, template: structuredClone(defaultTemplate) }))}>恢复默认</Button><Button onClick={() => { void api.saveTemplate(project.template).then(() => setNotice('默认模板已保存；已有项目不会随之改变。')).catch(e => setProblem(errorText(e))) }}>保存为默认模板</Button></div>
          </>}
          {tab === 'photo' && <section className="settings-group"><div className="section-label">FRAME INSPECTOR<span>03</span></div><h3>{selected === null ? '选择一张照片' : `索引 ${String(selected + 1).padStart(2, '0')}`}</h3>
            {selected === null ? <p className="help">点击左侧列表或中央画格，查看信息并调整照片。</p> : <>
              {selectedPhoto?.preview && <img className="inspector-image" src={selectedPhoto.preview} alt={selectedPhoto.name}/>}
              <p className="selected-name">{selectedPhoto?.name ?? '黑色空位'}</p>
              {selectedPhoto && <><p className="help">{selectedPhoto.width} × {selectedPhoto.height} px · {selectedPhoto.depth}<br/>{selectedPhoto.hasIcc ? '已读取 ICC 色彩配置' : '无嵌入 ICC 配置'}<br/>旋转 {selectedPhoto.rotation}°</p>{selectedPhoto.error && <p className="error-inline">{selectedPhoto.error}</p>}{selectedPhoto.warning && <p className="warning-inline">{selectedPhoto.warning}</p>}</>}
              <div className="button-grid"><Button disabled={!selectedPhoto} onClick={() => editPhoto('left')}>↶ 左转</Button><Button disabled={!selectedPhoto} onClick={() => editPhoto('right')}>↷ 右转</Button>
                <Button onClick={() => void replace()}>替换 / 定位</Button><Button disabled={!selectedPhoto} onClick={() => editPhoto('blank')}>设为空位</Button><Button onClick={() => editPhoto('insert')}>前面插空位</Button><Button disabled={!selectedPhoto} onClick={() => editPhoto('remove')}>移除并前移</Button></div><p className="help">所有操作都可撤销，不会删除原图。</p>
            </>}
          </section>}
        </fieldset>
      </aside>
    </main>
    <div className="task-panel">
      {(notice || problem || backgroundTasks.length > 0) && <div className={`notice ${problem ? 'error' : ''} ${backgroundTasks.length > 0 && !tasksCollapsed ? 'tasks-expanded' : ''}`}>
        <span role="status" title={problem || notice}>{problem || notice}</span>{problem && <button onClick={() => setProblem('')}>关闭</button>}
      {backgroundTasks.length > 0 && !tasksCollapsed && <div className="task-list" id="background-task-list" role="region" aria-label="后台任务">{[...backgroundTasks].reverse().map(task => <section
        className={`task-card ${task.state}`} key={task.taskId} data-task-id={task.taskId} data-project-id={task.projectId} data-state={task.state}>
        <button className="text-button task-project" title={task.title} disabled={foregroundBusy || !allSessions.some(session => session.id === task.projectId)} onClick={() => selectSession(task.projectId)}>{task.title}</button>
        <span className="task-card-status" role="status" title={task.message}>{taskStatus(task)}</span>
        {taskPending(task) && task.total > 0 && <small>{task.current} / {task.total}</small>}
        {task.files.map(file => <button key={file} className="text-button task-output" title={file} onClick={() => {
          void api.reveal(file).then(() => updateTasks(tasks => tasks.filter(item => item.taskId !== task.taskId)))
            .catch(error => setProblem(errorText(error)))
        }}>打开文件夹</button>)}
          {taskPending(task) ? <button className="text-button" disabled={task.state === 'canceling'} onClick={() => void cancelBackground(task)}>取消任务</button>
            : <button className="text-button" aria-label={`移除任务提示 ${task.title}`} onClick={() => updateTasks(tasks => tasks.filter(item => item.taskId !== task.taskId))}>×</button>}
      </section>)}</div>}
        {backgroundTasks.length > 0 && <div className="task-panel-heading">
          <strong>后台任务 · {backgroundTasks.filter(taskPending).length} 个进行中</strong>
          <button className="text-button" aria-expanded={!tasksCollapsed} aria-controls="background-task-list" onClick={() => setTasksCollapsed(value => !value)}>{tasksCollapsed ? '展开任务' : '收起任务'}</button>
        </div>}
      </div>}
    </div>
    <footer className="status"><span>{activeId ? <>{profile.label} <i/> {count} {unit} <i/> {capacity - count} 个空位 <i/> 容量 {capacity} 格</> : '请先选择扫描类型'}</span><span title={path ?? ''}>{!activeId ? '未打开项目' : saved ? (path ? '已保存' : '新项目') : '未保存'} · 本地处理</span></footer>
    {dropActive && <div className="drop-overlay">{activeId ? '松开以导入扫描文件' : '请先选择扫描类型'}<span>TIFF / JPEG · 原图保持不变</span></div>}
    {foregroundBusy && <div className="busy"><div><span className="spinner"/><strong>{progress?.message ?? '正在准备…'}</strong><span>{progress ? `${progress.current} / ${progress.total}` : ''}</span>{progress && <Button onClick={() => void api.cancelTask(progress.taskId)}>取消任务</Button>}</div><progress value={progress?.current ?? 0} max={progress?.total || 1}/></div>}
    {showExport && <div className="modal-backdrop"><section className="modal" role="dialog" aria-label="导出索引图"><div className="modal-heading"><div><small>EXPORT CONTACT SHEET</small><h2>导出索引图</h2></div><Button disabled={busy} onClick={() => setShowExport(false)}>✕</Button></div>
      <p className="help">从 TIFF 原图生成 · sRGB JPEG · 单张不超过 25MB</p>
      <label className="stack-field">导出文件名<input value={exportNameValue} maxLength={185} disabled={busy}
        aria-invalid={Boolean(filenameError)} placeholder="例如 0001接触印象"
        onChange={event => { setExportName(event.target.value) }}/></label>
      <div className="export-filename-help"><small className="help">{filenameError || `将保存为：${filenamePreview}`}</small>
        <button className="text-button" disabled={busy || exportName === null} onClick={() => { setExportName(null) }}>恢复默认命名</button></div>
      <div className="export-option"><div><strong>高清交付版</strong><small>优先保留现有画质，超出 25MB 时自动优化</small></div><select aria-label="高清输出宽度" value={highWidth} onChange={e => setHighWidth(Number(e.target.value))}><option value={6000}>6000 px 宽</option><option value={8000}>8000 px 宽</option><option value={10000}>10000 px 宽</option></select></div>
      <div className="export-spec"><span>整图 {highWidth} × {Math.round(highWidth * Math.SQRT2)} px</span><span>{profile.mode === 'strip' ? '每条' : '每格'}约 {Math.round(profile.frameWidth / layout.width * highWidth)} × {Math.round(profile.frameHeight / layout.width * highWidth)} px</span></div>
      <p className="help">页面 {layout.width} × {layout.height.toFixed(1)}mm，保持 A 系列比例。{project.layoutVersion === 1 ? '原尺寸打印需要 100%，适配 A4 会缩小。' : '画格使用扫描长宽比；页面毫米数是打印尺寸，不是底片实测尺寸。'}</p>
      {!project.roll && exportName === null && <p className="warning-inline">未填写订单编号或拍摄者，可在上方修改导出文件名。</p>}
      {untagged > 0 && <label className="check warning-inline"><input type="checkbox" checked={acceptIcc} onChange={e => setAcceptIcc(e.target.checked)}/>确认将 {untagged} 张无 ICC 图片按 sRGB／灰度解释</label>}
      {errors.map(e => <p className="error-inline" key={e}>{e}</p>)}
      <div className="modal-actions"><Button disabled={foregroundBusy} onClick={() => setShowExport(false)}>关闭</Button><Button primary disabled={busy || exporting || Boolean(filenameError) || errors.length > 0 || (untagged > 0 && !acceptIcc)} onClick={() => void runExport()}>选择文件夹并导出 ↗</Button></div>
    </section></div>}
    {closingId && <div className="modal-backdrop"><section className="modal" role="dialog" aria-label="关闭项目确认">
      <div className="modal-heading"><h2>保存修改后关闭？</h2></div>
      <p>“{projectItems.find(item => item.id === closingId)?.title}”有尚未保存的修改。</p>
      <p className="help">关闭标签不会删除已保存的项目文件或原始照片。</p>
      {problem && <p className="error-inline">{problem}</p>}
      <div className="modal-actions">
        <Button disabled={foregroundBusy} onClick={() => setClosingId(null)}>取消</Button>
        <Button disabled={foregroundBusy} onClick={() => removeSession(closingId)}>不保存关闭</Button>
        <Button primary disabled={foregroundBusy} onClick={() => void saveAndClose()}>保存并关闭</Button>
      </div>
    </section></div>}
    {showTypePicker && <div className="modal-backdrop"><section className="modal scan-picker-modal" role="dialog" aria-label="新建扫描项目">
      <div className="scan-picker-close"><Button disabled={foregroundBusy} onClick={() => setShowTypePicker(false)}>取消</Button></div>
      <ScanTypePicker disabled={foregroundBusy} onChoose={type => void chooseType(type)}/>
      {problem && <p className="error-inline">{problem}</p>}
    </section></div>}
    <span className="sr-only">{historyCount}</span>
  </div>
}
