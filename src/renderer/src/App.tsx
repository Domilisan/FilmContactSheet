import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { addAssets, defaultTemplate, insertBlank, moveSlot, newProject, photoCount, removeAndShift,
  type Project, type Template, type Progress, type ImportResult, type ExportResult } from '../../shared/model'
import { exportErrors, layoutSheet, sheetSvg } from '../../shared/layout'
import { filmStockGroups, isPresetFilm, OTHER_FILM } from '../../shared/film-stocks'
import { scannerOptions, isPresetScanner, OTHER_SCANNER } from '../../shared/scanners'
import { fixedLogo } from '../../shared/branding'
import { DEFAULT_JPEG_QUALITY } from '../../shared/export-settings'
import ProjectNavigation from './ProjectNavigation'

type Tab = 'info' | 'template' | 'photo'
const api = window.desktop
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '')

interface ProjectSession {
  id: string; project: Project; path: string | null; saved: boolean
  selected: number | null; tab: Tab; zoom: number; undo: Project[]; redo: Project[]
  editingOtherFilm: boolean; editingOtherScanner: boolean; highWidth: number; acceptIcc: boolean
  notice: string; problem: string
}
const createSession = (project: Project, id: string, path: string | null = null): ProjectSession => ({
  id, project, path, saved: true, selected: null, tab: 'info', zoom: 1, undo: [], redo: [],
  editingOtherFilm: false, editingOtherScanner: false, highWidth: 8000, acceptIcc: false,
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
  const projectNumber = useRef(0)
  const defaultTemplateRef = useRef(defaultTemplate)
  const [editingOtherFilm, setEditingOtherFilm] = useState(false)
  const [editingOtherScanner, setEditingOtherScanner] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('info')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [notice, setNotice] = useState('所有照片在本机处理，原图保持不变。')
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState(true)
  const [path, setPath] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [dropActive, setDropActive] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [highWidth, setHighWidth] = useState(8000)
  const [acceptIcc, setAcceptIcc] = useState(false)
  const [historyCount, setHistoryCount] = useState(0)
  const undo = useRef<Project[]>([]), redo = useRef<Project[]>([])
  const dragIndex = useRef<number | null>(null)
  const projectRef = useRef(project)
  projectRef.current = project
  const layout = useMemo(() => layoutSheet(project), [project])
  const svg = useMemo(() => sheetSvg(project, { pictures: true, selected: selected ?? undefined }), [project, selected])
  const count = photoCount(project)
  const selectedPhoto = selected === null ? null : project.slots[selected]
  const errors = exportErrors(project)
  const untagged = project.slots.filter(a => a && !a.hasIcc && a.status === 'ready').length
  // 旧项目中的自定义名称自动归入“其他”，保留原有文本。
  const showOtherFilm = editingOtherFilm || (project.film !== '' && !isPresetFilm(project.film))
  const showOtherScanner = editingOtherScanner || (project.scanner !== '' && !isPresetScanner(project.scanner))
  const currentSession: ProjectSession = { id: activeId, project, path, saved, selected, tab, zoom,
    undo: undo.current, redo: redo.current, editingOtherFilm, editingOtherScanner, highWidth, acceptIcc, notice, problem }
  const allSessions = sessions.map(session => session.id === activeId ? currentSession : session)
  const projectItems = allSessions.map(session => ({ id: session.id, title: projectTitle(session),
    count: photoCount(session.project), saved: session.saved, path: session.path }))

  useEffect(() => {
    api.loadTemplate().then(template => { defaultTemplateRef.current = template; setProject(p => ({ ...p, template })) }).catch(error => setProblem(errorText(error)))
    return api.onProgress(setProgress)
  }, [])
  useEffect(() => { api.dirty(allSessions.some(session => !session.saved)) }, [saved, sessions, activeId])

  const change = (next: Project) => {
    if (busy || !activeId) return
    undo.current.push(projectRef.current)
    if (undo.current.length > 40) undo.current.shift()
    redo.current = []
    setProject(next); setSaved(false); setHistoryCount(n => n + 1)
  }
  const templateChange = <K extends keyof Template>(key: K, value: Template[K]) => change({ ...project, template: { ...project.template, [key]: value } })
  const fieldChange = (key: 'roll' | 'film' | 'date' | 'notes' | 'scanner', value: string) => change({ ...project, [key]: value })
  const doUndo = () => {
    const previous = undo.current.pop()
    if (previous) { redo.current.push(project); setProject(previous); setEditingOtherFilm(false); setEditingOtherScanner(false); setSaved(false); setHistoryCount(n => n + 1) }
  }
  const doRedo = () => {
    const next = redo.current.pop()
    if (next) { undo.current.push(project); setProject(next); setEditingOtherFilm(false); setEditingOtherScanner(false); setSaved(false); setHistoryCount(n => n + 1) }
  }
  const restoreSession = (session: ProjectSession) => {
    setActiveId(session.id); setProject(session.project); projectRef.current = session.project
    setPath(session.path); setSaved(session.saved); setSelected(session.selected); setTab(session.tab); setZoom(session.zoom)
    setEditingOtherFilm(session.editingOtherFilm); setEditingOtherScanner(session.editingOtherScanner)
    setHighWidth(session.highWidth); setAcceptIcc(session.acceptIcc)
    setNotice(session.notice); setProblem(session.problem); setShowExport(false); setExportResult(null); setDropActive(false)
    undo.current = session.undo; redo.current = session.redo; setHistoryCount(n => n + 1)
  }
  const selectSession = (id: string) => {
    if (busy || closingId || id === activeId) return
    const target = allSessions.find(session => session.id === id)
    if (target) { setSessions(allSessions); restoreSession(target) }
  }
  const renameSession = (id: string, name: string) => {
    if (busy || !name.trim()) return
    if (id === activeId) { if (project.name !== name) change({ ...project, name }); return }
    setSessions(allSessions.map(session => session.id === id
      ? { ...session, project: { ...session.project, name }, saved: false,
        undo: [...session.undo, session.project].slice(-40), redo: [] } : session))
  }
  const removeSession = (id: string) => {
    const remaining = allSessions.filter(session => session.id !== id)
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
    if (busy) return
    const session = allSessions.find(item => item.id === id)
    if (!session) return
    if (!session.saved) setClosingId(id)
    else removeSession(id)
  }
  const task = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy) return
    setBusy(true); setProblem(''); setProgress(null)
    try { return await fn() }
    catch (error) { const message = errorText(error); if (message.includes('任务已取消')) setNotice('任务已取消，现有项目保持不变。'); else setProblem(message) }
    finally { setBusy(false); setProgress(null) }
  }
  const applyImport = (result: ImportResult | null | undefined) => {
    if (!result) return
    // 取消导入或没有照片时保持空工作区；真正导入照片后才创建项目。
    if (!activeId && !result.assets.length) return
    const before = projectRef.current
    const next = addAssets(before, result.assets)
    if (!activeId) {
      next.name = `未命名项目 ${++projectNumber.current}`
      const session = createSession(next, crypto.randomUUID())
      setSessions([session]); restoreSession(session)
    }
    const added = photoCount(next) + next.overflow.length - photoCount(before) - before.overflow.length
    // task() has finished, but the current render may still contain busy=true.
    undo.current.push(before); redo.current = []
    setProject(next); setSaved(false); setHistoryCount(n => n + 1); setAcceptIcc(false)
    setNotice(`导入 ${added} 张；忽略 ${result.skipped} 个非照片项目；重复 ${result.duplicates + result.assets.length - added} 张。`)
    if (next.overflow.length) setProblem(`已超出 42 格容量 ${next.overflow.length} 张，请处理左侧超量文件后再导出。`)
  }
  const importPhotos = async (kind: 'files' | 'folder') => applyImport(await task(() => api.chooseImport(kind)))
  const save = async (saveAs = false) => {
    if (!activeId) return false
    const otherPaths = allSessions.filter(session => session.id !== activeId && session.path).map(session => session.path!)
    const filename = await task(() => api.saveProject(projectRef.current, saveAs, path, otherPaths))
    if (filename) { setPath(filename); setSaved(true); setNotice('项目已保存。项目引用原图，请保留原图文件。'); return true }
    return false
  }
  const open = async () => {
    const opened = await task(() => api.openProject())
    if (!opened) return
    const existing = allSessions.find(session => session.path && normalizedProjectPath(session.path) === normalizedProjectPath(opened.path))
    if (existing) { setSessions(allSessions); restoreSession(existing); setProblem(''); setNotice('项目已打开，已切换到对应标签。'); return }
    const next = createSession(opened.project, crypto.randomUUID(), opened.path)
    setSessions([...allSessions, next]); restoreSession(next)
  }
  const fresh = async () => {
    const template = await task(() => api.loadTemplate())
    if (!template) return
    defaultTemplateRef.current = template
    const next = createSession({ ...newProject(template), name: `未命名项目 ${++projectNumber.current}` }, crypto.randomUUID())
    setSessions([...allSessions, next]); restoreSession(next)
  }
  const saveAndClose = async () => {
    const session = allSessions.find(item => item.id === closingId)
    if (!session) return
    const otherPaths = allSessions.filter(item => item.id !== session.id && item.path).map(item => item.path!)
    const filename = await task(() => api.saveProject(session.project, false, session.path, otherPaths))
    if (filename) removeSession(session.id)
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || busy || closingId) return
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
      const next = { ...project, slots: [...project.slots] }; next.slots[selected] = asset
      undo.current.push(project); redo.current = []; setProject(next); setSaved(false); setAcceptIcc(false)
    }
  }
  const drop = async (event: DragEvent) => {
    event.preventDefault(); setDropActive(false)
    if (!event.dataTransfer.files.length || busy) return
    applyImport(await task(() => api.importDropped(Array.from(event.dataTransfer.files))))
  }
  const runExport = async () => {
    const result = await task(() => api.exportProject(project, { widths: [highWidth], quality: DEFAULT_JPEG_QUALITY, acceptUntagged: acceptIcc }))
    if (result) { setExportResult(result); if (result.files.length) setNotice(`已导出 ${result.files.length} 个文件。`) }
  }

  return <div className={`app ${dropActive ? 'file-hover' : ''}`} onDragOver={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) setDropActive(true) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false) }} onDrop={drop}>
    <header className="toolbar">
      <div className="identity"><img className="brand-icon" src={fixedLogo.data} alt="PD Darkroom Logo"/><div><strong>PD Impression</strong><small>暗房胶卷索引</small></div></div>
      <div className="tools"><Button disabled={busy} onClick={() => void fresh()}>＋ 新建</Button><Button disabled={busy} onClick={() => void open()}>打开项目</Button>
        <Button disabled={busy} onClick={() => void importPhotos('files')}>导入照片</Button><Button disabled={busy || !activeId} onClick={() => void save()}>保存</Button>
        <Button disabled={busy || !activeId} onClick={() => void save(true)} title="另存项目">另存</Button>
        <span className="separator"/><Button title="撤销 Ctrl/Cmd Z" disabled={busy || !undo.current.length} onClick={doUndo}>↶</Button><Button title="重做" disabled={busy || !redo.current.length} onClick={doRedo}>↷</Button>
      </div>
      <div className="toolbar-end"><span className="offline"><i/> 本地离线</span><Button primary disabled={busy || !count} onClick={() => { setExportResult(null); setShowExport(true) }}>导出接触印象 ↗</Button></div>
    </header>
    <main className="workspace">
      <aside className="library">
        <section className="project-directory">
          <div className="project-directory-heading"><h2>项目目录 <span className="badge">{sessions.length}</span></h2><button className="text-button" disabled={busy} onClick={() => void fresh()}>＋ 新建</button></div>
          <ProjectNavigation items={projectItems} activeId={activeId} disabled={busy || Boolean(closingId)} mode="directory"
            onSelect={selectSession} onRename={renameSession} onClose={closeSession} onNew={() => void fresh()}/>
        </section>
        <div className="panel-heading"><h2>本卷照片 <span className="badge">{count}</span></h2><button className="text-button" disabled={busy} onClick={() => void importPhotos('folder')}>导入文件夹</button></div>
        <div className="sort-bar"><span>文件名自然排序</span><button className="text-button" disabled={busy || !count} onClick={() => {
          const sorted = project.slots.filter(a => a !== null).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
          change({ ...project, slots: [...sorted, ...Array.from({ length: 42 - sorted.length }, () => null)] })
        }}>重新排序 ↓</button></div>
        <div className="photo-list">
          {!count && <div className="list-empty"><span>▧</span><p>一卷的故事<br/>从第一张照片开始</p></div>}
          {project.slots.map((asset, index) => (asset || selected === index || (count > 0 && index <= project.slots.findLastIndex(Boolean))) &&
            <button className={`photo-row ${selected === index ? 'active' : ''} ${asset?.status === 'error' ? 'failed' : ''}`} key={asset?.id ?? `empty-${index}`}
              draggable={!busy && Boolean(asset)} onDragStart={() => { dragIndex.current = index }} onDragEnd={() => { dragIndex.current = null }}
              onDragOver={event => event.preventDefault()} onDrop={event => { if (dragIndex.current !== null) { event.preventDefault(); event.stopPropagation(); change(moveSlot(project, dragIndex.current, index)); setSelected(index); dragIndex.current = null } }}
              onClick={() => setSelected(index)}>
              <span className="thumb">{asset?.preview ? <img src={asset.preview} alt=""/> : <span>{asset?.status === 'error' ? '!' : '—'}</span>}</span>
              <span className="photo-meta"><span><b>{String(index + 1).padStart(2, '0')}</b> {asset?.name ?? '空位'}</span><small>{asset ? asset.status === 'error' ? '读取失败 · 选中查看' : `${asset.name.match(/\.(tiff?)$/i) ? 'TIFF' : 'JPEG'} · ${(asset.size / 1e6).toFixed(1)} MB` : '保留黑色胶片'}</small></span>
            </button>)}
          {project.overflow.length > 0 && <div className="overflow"><strong>超出容量 {project.overflow.length} 张</strong><p>这些文件尚未放入成品，请处理后导出。</p>{project.overflow.map(a => <div key={a.id}><span>{a.name}</span><button onClick={() => change({ ...project, overflow: project.overflow.filter(x => x.id !== a.id) })}>移除</button></div>)}</div>}
        </div>
      </aside>
      <section className="preview-panel">
        {sessions.length > 0 && <ProjectNavigation items={projectItems} activeId={activeId} disabled={busy || Boolean(closingId)} mode="tabs"
          onSelect={selectSession} onRename={renameSession} onClose={closeSession} onNew={() => void fresh()}/>}
        <div className="preview-heading"><div><h2>成品预览</h2><small>135 / 42 FRAMES</small></div><div className="zoom-tools"><Button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>−</Button><span>{Math.round(zoom * 100)}%</span><Button onClick={() => setZoom(z => Math.min(3, z + 0.25))}>＋</Button><Button onClick={() => setZoom(1)}>适合窗口</Button></div></div>
        <div className="canvas-scroll">
          {!count && !project.overflow.length ? <div className="welcome">
            <img className="welcome-logo" src={fixedLogo.data} alt="PD Darkroom Logo"/>
            <p>将扫描照片或文件夹拖到这里<br/>支持 TIFF 和 JPEG，全程在本机处理</p>
            <div className="welcome-actions"><Button primary disabled={busy} onClick={() => void importPhotos('files')}>选择照片</Button><Button disabled={busy} onClick={() => void importPhotos('folder')}>选择文件夹</Button></div>
            <small>135 · 42 格模板 · 真实胶片比例</small>
          </div>
            : <div className="paper-wrap" style={{ width: `${Math.round(490 * zoom)}px` }}>
              <div className="paper" data-testid="sheet" onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect()
                const x = (event.clientX - rect.left) / rect.width * layout.width, y = (event.clientY - rect.top) / rect.height * layout.height
                const hit = layout.frames.find(f => x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height)
                if (hit) setSelected(hit.index)
              }} dangerouslySetInnerHTML={{ __html: svg }}/>
              <div className="paper-caption"><span>{layout.width.toFixed(0)} × {layout.height.toFixed(1)} mm</span><span>{layout.hidden > 0 ? `已隐藏末尾 ${layout.hidden} 条空白胶片` : '完整显示 7 条胶片'}</span></div>
            </div>}
        </div>
        {layout.errors.length > 0 && count > 0 && <div className="layout-warning">{layout.errors.join(' ')}</div>}
      </section>
      <aside className="settings">
        <nav className="tabs">{([['info', '本卷信息'], ['template', '暗房模板'], ['photo', '照片']] as const).map(([value, label]) => <button className={tab === value ? 'selected' : ''} key={value} onClick={() => setTab(value)}>{label}</button>)}</nav>
        <fieldset disabled={busy || !activeId} className="settings-scroll">
          {tab === 'info' && <>
            <section className="settings-group"><div className="section-label">ROLL DETAILS<span>01</span></div><h3>本卷信息</h3>
              <label className="stack-field">画幅<select value="135" onChange={() => {}}><option value="135">135 全画幅 · 42 格</option><option disabled>120 模板 · 待后续接入</option></select></label>
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
              <label className="stack-field">备注<textarea rows={3} maxLength={200} placeholder="选填，显示在页面底部" value={project.notes} onChange={e => fieldChange('notes', e.target.value)}/></label>
            </section><section className="settings-group summary"><h3>本卷概览</h3><div><span>照片</span><strong>{count} 张</strong></div><div><span>空位</span><strong>{42 - count} 格</strong></div><div><span>显示胶片</span><strong>{count ? layout.rows : 0} 条</strong></div><p>所有编辑仅记录在项目中，<br/>原始扫描文件保持不变。</p></section>
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
            </section><div className="settings-actions"><Button onClick={() => change({ ...project, template: structuredClone(defaultTemplate) })}>恢复默认</Button><Button onClick={() => { void api.saveTemplate(project.template).then(() => setNotice('默认模板已保存；已有项目不会随之改变。')).catch(e => setProblem(errorText(e))) }}>保存为默认模板</Button></div>
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
    {(notice || problem) && <div className={`notice ${problem ? 'error' : ''}`} role="status"><span>{problem || notice}</span>{problem && <button onClick={() => setProblem('')}>关闭</button>}</div>}
    <footer className="status"><span>135 <i/> {count} 张照片 <i/> {42 - count} 个空位 <i/> 容量 42 格</span><span title={path ?? ''}>{!activeId ? '未打开项目' : saved ? (path ? '已保存' : '新项目') : '未保存'} · 本地处理</span></footer>
    {dropActive && <div className="drop-overlay">松开以导入一卷照片<span>TIFF / JPEG · 原图保持不变</span></div>}
    {busy && <div className="busy"><div><span className="spinner"/><strong>{progress?.message ?? '正在准备…'}</strong><span>{progress ? `${progress.current} / ${progress.total}` : ''}</span><Button onClick={() => void api.cancelTask()}>取消任务</Button></div><progress value={progress?.current ?? 0} max={progress?.total || 1}/></div>}
    {showExport && <div className="modal-backdrop"><section className="modal" role="dialog" aria-label="导出索引图"><div className="modal-heading"><div><small>EXPORT CONTACT SHEET</small><h2>导出索引图</h2></div><Button disabled={busy} onClick={() => setShowExport(false)}>✕</Button></div>
      <p className="help">从 TIFF 原图生成 · sRGB JPEG · 单张不超过 25MB</p>
      <div className="export-option"><div><strong>高清交付版</strong><small>优先保留现有画质，超出 25MB 时自动优化</small></div><select aria-label="高清输出宽度" value={highWidth} onChange={e => setHighWidth(Number(e.target.value))}><option value={6000}>6000 px 宽</option><option value={8000}>8000 px 宽</option><option value={10000}>10000 px 宽</option></select></div>
      <div className="export-spec"><span>整图 {highWidth} × {Math.round(highWidth * Math.SQRT2)} px</span><span>每格约 {Math.round(36 / layout.width * highWidth)} × {Math.round(24 / layout.width * highWidth)} px</span></div>
      <p className="help">页面 {layout.width} × {layout.height.toFixed(1)}mm。原尺寸打印需要 100%，适配 A4 会缩小。输出档位为开发初始值，实际 TIFF 性能尚待验证。</p>
      {!project.roll && <p className="warning-inline">未填写订单编号或拍摄者，文件名将使用“未命名胶卷”。</p>}
      {untagged > 0 && <label className="check warning-inline"><input type="checkbox" checked={acceptIcc} onChange={e => setAcceptIcc(e.target.checked)}/>确认将 {untagged} 张无 ICC 图片按 sRGB／灰度解释</label>}
      {errors.map(e => <p className="error-inline" key={e}>{e}</p>)}
      {exportResult && <div className="export-result"><strong>{exportResult.canceled ? '导出已取消' : exportResult.errors.length ? '部分或全部导出失败' : '导出完成'}</strong>{exportResult.files.map(file => <button key={file} className="text-button" onClick={() => void api.reveal(file)}>打开所在文件夹 · {file.split(/[\\/]/).pop()}</button>)}{exportResult.errors.map(e => <p className="error-inline" key={e}>{e}</p>)}</div>}
      <div className="modal-actions"><Button disabled={busy} onClick={() => setShowExport(false)}>关闭</Button><Button primary disabled={busy || errors.length > 0 || (untagged > 0 && !acceptIcc)} onClick={() => void runExport()}>选择文件夹并导出 ↗</Button></div>
    </section></div>}
    {closingId && <div className="modal-backdrop"><section className="modal" role="dialog" aria-label="关闭项目确认">
      <div className="modal-heading"><h2>保存修改后关闭？</h2></div>
      <p>“{projectItems.find(item => item.id === closingId)?.title}”有尚未保存的修改。</p>
      <p className="help">关闭标签不会删除已保存的项目文件或原始照片。</p>
      {problem && <p className="error-inline">{problem}</p>}
      <div className="modal-actions">
        <Button disabled={busy} onClick={() => setClosingId(null)}>取消</Button>
        <Button disabled={busy} onClick={() => removeSession(closingId)}>不保存关闭</Button>
        <Button primary disabled={busy} onClick={() => void saveAndClose()}>保存并关闭</Button>
      </div>
    </section></div>}
    <span className="sr-only">{historyCount}</span>
  </div>
}
