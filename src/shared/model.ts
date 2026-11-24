import { z } from 'zod'
import { scanTypeIds, projectProfile, scanProfile, type ScanType } from './scan-types'

export const templateSchema = z.object({
  pageWidth: z.number().min(230).max(600),
  marginLeft: z.number().min(0).max(200),
  marginRight: z.number().min(0).max(200),
  marginTop: z.number().min(0).max(200),
  marginBottom: z.number().min(0).max(200),
  headerGap: z.number().min(0).max(100),
  stripGap: z.number().min(0).max(30),
  hideEmpty: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  brand: z.string().max(80),
  edgeText: z.boolean(),
  background: z.string().regex(/^#[0-9a-f]{6}$/i),
  showFilm: z.boolean(),
  showDate: z.boolean(),
  infoSize: z.number().min(1.5).max(5)
})
export type Template = z.infer<typeof templateSchema>
export const defaultTemplate: Template = {
  pageWidth: 250, marginLeft: 11, marginRight: 11, marginTop: 20,
  marginBottom: 12, headerGap: 8, stripGap: 0.5, hideEmpty: true,
  align: 'center', brand: 'PD DARKROOM', edgeText: true, background: '#ffffff',
  showFilm: true, showDate: true, infoSize: 2.7
}
export const assetSchema = z.object({
  id: z.string().max(80), path: z.string().min(1).max(4096), name: z.string().max(512),
  size: z.number().nonnegative(), width: z.number().nonnegative(), height: z.number().nonnegative(),
  depth: z.string(), hasIcc: z.boolean(), space: z.string(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  status: z.enum(['ready', 'error']), error: z.string().optional(),
  preview: z.string().max(4000000), warning: z.string().optional()
})
export type Asset = z.infer<typeof assetSchema>
export const projectSchema = z.object({
  version: z.literal(1), format: z.enum(scanTypeIds),
  layoutVersion: z.union([z.literal(1), z.literal(2)]).default(1),
  name: z.string().max(120).default(''),
  roll: z.string().max(120), film: z.string().max(120), date: z.string().max(32), notes: z.string().max(400),
  scanner: z.string().max(120).default(''),
  slots: z.array(assetSchema.nullable()).min(1).max(1000),
  overflow: z.array(assetSchema).max(500), template: templateSchema
}).superRefine((p, ctx) => {
  const profile = projectProfile(p), capacity = profile.columns * profile.rows
  if (p.layoutVersion === 1 && p.format !== '135') ctx.addIssue({ code: 'custom', message: '旧版项目只支持 135。', path: ['format'] })
  if (profile.mode === 'single' ? p.slots.length !== capacity : p.slots.length < profile.rows)
    ctx.addIssue({ code: 'custom', message: '项目画格数量与扫描类型不匹配。', path: ['slots'] })
})
export type Project = z.infer<typeof projectSchema>
export function newProject(template: Template = defaultTemplate, format: ScanType = '135'): Project {
  const profile = scanProfile(format)
  return { version: 1, format, layoutVersion: 2, name: '', roll: '', film: '', date: '', notes: '', scanner: '',
    slots: Array.from({ length: profile.columns * profile.rows }, () => null), overflow: [], template: structuredClone(template) }
}
export const photoCount = (p: Project) => p.slots.filter(Boolean).length
export function addAssets(project: Project, incoming: Asset[]): Project {
  const next = structuredClone(project)
  const existing = new Set([...next.slots, ...next.overflow].filter(Boolean).map(a => a!.path))
  for (const asset of incoming) {
    if (existing.has(asset.path)) continue
    existing.add(asset.path)
    const index = next.slots.indexOf(null)
    if (index >= 0) next.slots[index] = asset
    else if (projectProfile(next).mode === 'strip' && next.slots.length < 1000) next.slots.push(asset)
    else next.overflow.push(asset)
  }
  return next
}
export function insertBlank(project: Project, index: number): Project {
  if (project.slots.at(-1)) throw new Error(`最后一格已有照片，插入空位会超出 ${project.slots.length} 格。`)
  const next = structuredClone(project)
  next.slots.splice(index, 0, null)
  next.slots.pop()
  return next
}
export function removeAndShift(project: Project, index: number): Project {
  const next = structuredClone(project)
  next.slots.splice(index, 1)
  next.slots.push(next.overflow.shift() ?? null)
  return next
}
export function moveSlot(project: Project, from: number, to: number): Project {
  const next = structuredClone(project)
  const [asset] = next.slots.splice(from, 1)
  next.slots.splice(to, 0, asset)
  return next
}
export interface Progress { message: string; current: number; total: number }
export interface TaskContext { taskId: string; projectId: string }
export interface TaskProgress extends Progress, TaskContext { kind: 'import' | 'export'; state: 'queued' | 'running' }
export interface ImportResult { assets: Asset[]; skipped: number; duplicates: number }
export interface ExportOptions { widths: number[]; quality: number; acceptUntagged: boolean; filename?: string }
export interface ExportResult { files: string[]; canceled: boolean; errors: string[] }
export interface DesktopApi {
  chooseImport(kind: 'files' | 'folder', context?: TaskContext): Promise<ImportResult | null>
  importDropped(files: File[], context?: TaskContext): Promise<ImportResult>
  replacePhoto(): Promise<Asset | null>
  openProject(): Promise<{ project: Project; path: string } | null>
  saveProject(project: Project, saveAs: boolean, currentPath?: string | null, otherOpenPaths?: string[]): Promise<string | null>
  saveTemplate(template: Template): Promise<void>
  loadTemplate(): Promise<Template>
  exportProject(project: Project, options: ExportOptions, context?: TaskContext): Promise<ExportResult>
  cancelTask(taskId: string): Promise<void>
  reveal(path: string): Promise<void>
  dirty(value: boolean): void
  onProgress(callback: (progress: TaskProgress) => void): () => void
}
export interface HeaderMeasureInput { title: string; titleSize: number; order: string; details: string }
