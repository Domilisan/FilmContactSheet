import { useState } from 'react'

export interface ProjectItem { id: string; title: string; count: number; saved: boolean; path: string | null; unit: string; taskProgress?: string; taskActive?: boolean }
interface Props {
  items: ProjectItem[]
  activeId: string
  disabled: boolean
  mode: 'directory' | 'tabs'
  onSelect(id: string): void
  onRename(id: string, name: string): void
  onClose(id: string): void
  onNew(): void
}

// 项目目录与标签栏共用项目名称；双击名称进入编辑。
export default function ProjectNavigation({ items, activeId, disabled, mode, onSelect, onRename, onClose, onNew }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const commit = (id: string) => {
    if (draft.trim()) onRename(id, draft.trim())
    setEditing(null)
  }
  return <div className={mode === 'tabs' ? 'project-tabs' : 'project-directory-list'} role={mode === 'tabs' ? 'tablist' : 'list'} aria-label={mode === 'tabs' ? 'Contact sheet 项目标签' : '项目目录'}>
    {items.map(item => <div key={item.id} className={`project-item ${item.id === activeId ? 'active' : ''}`} role={mode === 'directory' ? 'listitem' : undefined}>
      {editing === item.id ? <input className="project-rename" aria-label="项目名称" autoFocus maxLength={120} value={draft}
        onFocus={e => e.target.select()} onChange={e => setDraft(e.target.value)} onBlur={() => commit(item.id)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(item.id) }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
        }}/>
        : <button className="project-select" disabled={disabled} role={mode === 'tabs' ? 'tab' : undefined}
          aria-selected={mode === 'tabs' ? item.id === activeId : undefined}
          title={`${item.title}${item.path ? `\n${item.path}` : ''}\n双击重命名`}
          onClick={() => onSelect(item.id)} onDoubleClick={() => { setDraft(item.title); setEditing(item.id) }}>
          <span className="project-label"><span className="project-title">{item.title}</span>{item.taskProgress && <small className="project-task-progress">{item.taskProgress}</small>}</span>
          {!item.saved && <span className="project-unsaved" aria-label="未保存">●</span>}
          {mode === 'directory' && <small>{item.count} {item.unit}</small>}
        </button>}
      {mode === 'tabs' && <button className="project-close" disabled={disabled || item.taskActive} aria-label={`关闭项目 ${item.title}`} title={item.taskActive ? '请先等待或取消该项目的后台任务' : '关闭项目'} onClick={() => onClose(item.id)}>×</button>}
    </div>)}
    {mode === 'tabs' && <button className="project-add" disabled={disabled} aria-label="新建项目标签" title="新建项目" onClick={onNew}>＋</button>}
  </div>
}
