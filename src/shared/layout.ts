import { photoCount, newProject, type Project, type Asset, type Template } from './model'
import { fixedLogo, filmOffsetY, filmFrameColor } from './branding'
import { projectProfile, type ScanType } from './scan-types'

// 导出图第三行（扫描仪等信息）的字号，单位为 mm。
export const detailsFontSize = 3.5
// 左侧保持 6mm 定位间隔；右侧固定首尾两行，中间行按实际字形居中。
const headerLineGap = 6
// 备注固定在当前模板最大行数下方；135 仍为第七行下方。
const noteStyle = { size: 3.5, gap: 3, lineHeight: 5, color: '#333333' }

export interface Rect { x: number; y: number; width: number; height: number }
export interface Frame extends Rect { index: number; asset: Asset | null }
export interface SheetLayout {
  width: number; height: number; rows: number; maxRows: number; hidden: number;
  strips: Rect[]; frames: Frame[]; errors: string[];
  headerY: number; contentX: number; headerHeight: number
  logo: Rect
  notes: { x: number; y: number; size: number; lineHeight: number; lines: string[] }
}

// 导出页头的三行卷信息。字号、行位置均使用毫米坐标。
export function rollHeader(p: Project) {
  const t = p.template
  const profile = projectProfile(p)
  // 成品仅显示胶卷类别；操作界面继续使用 6×6、6×7、XPan 等具体扫描类型。
  const filmFormatLabel = profile.family === '120' ? '120mm' : '135mm'
  const titleSize = t.infoSize + 5 // 第一行胶卷型号：默认 7.7mm，比普通卷信息大
  const orderY = headerLineGap
  const detailsY = orderY + headerLineGap
  return {
    title: p.film.trim() || '未填写胶卷型号',
    titleSize,
    order: p.roll.trim(), // 可以填写订单编号，也可以填写拍摄者
    orderY,
    details: [filmFormatLabel, `${photoCount(p)} ${profile.mode === 'strip' ? 'STRIPS' : 'FRAMES'}`, p.scanner.trim(),
      t.showDate && p.date].filter(Boolean).join(' / '),
    detailsY,
    detailsSize: Math.min(t.infoSize, 2)
  }
}

export function layoutSheet(p: Project): SheetLayout {
  const t = p.template
  const profile = projectProfile(p)
  const header = rollHeader(p)
  const width = t.pageWidth, height = width * Math.SQRT2
  const last = p.slots.findLastIndex(Boolean)
  const maxRows = Math.ceil(p.slots.length / profile.columns)
  const rows = t.hideEmpty ? Math.max(1, Math.ceil((last + 1) / profile.columns)) : maxRows
  const contentWidth = width - t.marginLeft - t.marginRight
  // 保留已有页头高度，移动 Logo 时胶片位置不随之改变。
  const headerHeight = Math.max(30, t.infoSize * 3.5, header.detailsY + header.detailsSize + 1)
  const logo = { x: width - t.marginRight - fixedLogo.width, y: height - t.marginBottom - fixedLogo.width-4,
    width: fixedLogo.width, height: fixedLogo.width }
  const x = t.marginLeft + (t.align === 'left' ? 0 : t.align === 'right' ? contentWidth - profile.stripWidth : (contentWidth - profile.stripWidth) / 2)
  const y = t.marginTop + headerHeight + t.headerGap + filmOffsetY
  const strips = Array.from({ length: rows }, (_, row) => ({ x, y: y + row * (profile.stripHeight + t.stripGap), width: profile.stripWidth, height: profile.stripHeight }))
  const frames = strips.flatMap((strip, row) => Array.from({ length: profile.columns }, (_, col) => ({
    x: strip.x + profile.side + col * (profile.frameWidth + profile.gap), y: strip.y + profile.edge,
    width: profile.frameWidth, height: profile.frameHeight,
    index: row * profile.columns + col, asset: p.slots[row * profile.columns + col]
  })))
  const errors: string[] = []
  if (contentWidth < profile.stripWidth - 0.00001) errors.push(`左右页边距过大：版心至少需要 ${profile.stripWidth.toFixed(1)}mm 宽。请扩大页面或减小页边距。`)
  if (y + rows * profile.stripHeight + (rows - 1) * t.stripGap > height - t.marginBottom)
    errors.push('胶片或备注超出页面底部，请扩大页面或减小留白。')
  if (y + rows * profile.stripHeight + (rows - 1) * t.stripGap > logo.y)
    errors.push('胶片与右下角 Logo 区域重叠，请扩大页面或减小条间白缝、顶部留白。')
  const estimatedWidth = (value: string, size: number) => Array.from(value).reduce((sum, c) => sum + (/[^\x00-\xff]/.test(c) ? size : size * 0.62), 0)
  if (estimatedWidth(t.brand, 3.8) > contentWidth / 2 - 4)
    errors.push('暗房名称过长，与信息区域可能重叠。请缩短名称或扩大页面。')
  const infoWidth = contentWidth / 2 - 4
  if (estimatedWidth(header.title, header.titleSize) > infoWidth)
    errors.push('胶卷型号标题过长，请缩短型号、减小卷信息字号或扩大页面。')
  if (estimatedWidth(header.order, t.infoSize) > infoWidth)
    errors.push('订单编号或拍摄者过长，请缩短内容、减小字号或扩大页面。')
  if (estimatedWidth(header.details, header.detailsSize) > infoWidth)
    errors.push('扫描仪或日期信息过长，请缩短内容或隐藏日期。')
  const noteWidth = Math.max(1, Math.min(profile.stripWidth, contentWidth))
  const noteLines = p.notes.split('\n').flatMap(line => {
    const lines = ['']
    for (const char of line) {
      if (lines.at(-1) && estimatedWidth(lines.at(-1)! + char, noteStyle.size) > noteWidth) lines.push('')
      lines[lines.length - 1] += char
    }
    return lines
  })
  // 固定以模板完整行数的底边为基准，隐藏空行不改变备注位置。
  const notes = { x, y: y + maxRows * profile.stripHeight + (maxRows - 1) * t.stripGap + noteStyle.gap + noteStyle.size,
    size: noteStyle.size, lineHeight: noteStyle.lineHeight, lines: noteLines }
  if (p.notes) {
    if (noteLines.length > 3) errors.push('备注最多显示三行，请减少换行或缩短备注，内容不会自动截断。')
    const noteBottom = notes.y + (noteLines.length - 1) * notes.lineHeight + notes.size * 0.25
    if (noteBottom > height - t.marginBottom)
      errors.push('备注超出页面底部，请扩大页面或减小顶部留白、条间白缝。')
    if (noteLines.some((line, i) => {
      const baseline = notes.y + i * notes.lineHeight
      return line && baseline + notes.size * 0.25 > logo.y && baseline - notes.size < logo.y + logo.height
        && x + estimatedWidth(line, notes.size) > logo.x && x < logo.x + logo.width
    })) errors.push('备注与右下角 Logo 重叠，请缩短备注或调整页面留白。')
  }
  return { width, height, rows, maxRows, hidden: maxRows - rows, strips, frames, errors, headerY: t.marginTop, contentX: t.marginLeft, headerHeight, logo, notes }
}

// 新模板、整条数量增加时扩大 A 系列比例的页面，预留三行备注与 Logo。
// 调整的是输出页面尺寸，并非把扫描比例当成实测毫米尺寸。
export function fitProjectPage(project: Project): Project {
  const l = layoutSheet(project), t = project.template, profile = projectProfile(project)
  const minimumHeight = l.notes.y + 2 * l.notes.lineHeight + l.notes.size + 4 + fixedLogo.width + 4 + t.marginBottom
  const minimumWidth = Math.ceil(Math.max(profile.stripWidth + t.marginLeft + t.marginRight, minimumHeight / Math.SQRT2))
  return { ...project, template: { ...t, pageWidth: Math.min(600, Math.max(t.pageWidth, minimumWidth)) } }
}
export const newScanProject = (template: Template, format: ScanType) => fitProjectPage(newProject(template, format))
export function exportErrors(p: Project): string[] {
  return [...layoutSheet(p).errors,
    ...(photoCount(p) === 0 ? ['请先导入照片。'] : []),
    ...(p.overflow.length ? [`超出容量 ${p.overflow.length} 张，请移除超量文件或另建一卷。`] : []),
    ...(p.slots.some(a => a?.status === 'error') ? ['存在读取失败或缺失照片，请替换或明确移除。'] : [])]
}
export const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
const text = (x: number, y: number, value: string, size: number, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${xml(value)}</text>`

/** This SVG carries identical geometry in the editor and final Sharp composite. */
export function sheetSvg(p: Project, options: { pictures?: boolean; selected?: number; backgroundOnly?: boolean; orderY?: number } = {}): string {
  const l = layoutSheet(p), t = p.template, profile = projectProfile(p)
  // 无齿孔片边文字加大，上下分别以各自黑边中心定位。
  const edgeTextStyle = `fill="#ffd878" font-weight="${profile.perforated ? 700 : 400}"${profile.perforated ? '' : ' dominant-baseline="central"'}`
  const body: string[] = [`<rect width="${l.width}" height="${l.height}" fill="${t.background}"/>`]
  const right = l.width - t.marginRight
  if (!options.backgroundOnly) {
    body.push(`<image href="${fixedLogo.data}" x="${l.logo.x}" y="${l.logo.y}" width="${l.logo.width}" height="${l.logo.height}" preserveAspectRatio="xMidYMid meet"/>`)
    const brandX = l.contentX
    const header = rollHeader(p)
    // 左侧品牌和右侧标题保持既有位置。
    const firstLineY = l.headerY
    const secondLineY = l.headerY + headerLineGap
    body.push(text(brandX, firstLineY, t.brand, 3.8, 'dominant-baseline="middle" font-weight="700"'))
    body.push(text(brandX, secondLineY, 'Film Contact Sheet', 4.0, 'dominant-baseline="middle" letter-spacing="0.45" fill="#666666"'))
    const infoRight = right
    // 第一行：胶卷型号，加大、加粗。保持原卷信息区的右对齐位置。
    body.push(text(infoRight, firstLineY, header.title, header.titleSize, 'dominant-baseline="middle" text-anchor="end" font-weight="700"'))
    // 第二行：订单编号或拍摄者，未填写时留空。
    if (header.order) body.push(text(infoRight, l.headerY + (options.orderY ?? header.orderY), header.order, 5, 'dominant-baseline="middle" text-anchor="end" font-weight="400"'))
    // 第三行：画幅、张数、扫描仪，日期放在最后。
    body.push(text(infoRight, l.headerY + header.detailsY, header.details, detailsFontSize, 'dominant-baseline="middle" text-anchor="end" fill="#666666"'))
  }
  for (const strip of l.strips) {
    body.push(`<rect x="${strip.x}" y="${strip.y}" width="${strip.width}" height="${strip.height}" fill="${filmFrameColor}"/>`)
    // 按黑边空间限制齿孔尺寸，避开照片、品牌文字与编号；120 不绘制齿孔。
    const holeHeight = Math.min(2.79, profile.edge - 2.3)
    const holeWidth = 1.98 * holeHeight / 2.79
    const bottomHoles = profile.edge >= 5.5 ? strip.height - 4.45 : strip.height - profile.edge + 0.4
    if (profile.perforated) for (let i = 0; i < Math.floor(strip.width / 4.75); i++) for (const dy of [1.65, bottomHoles])
      body.push(`<rect x="${strip.x + 1.385 + i * 4.75 + (1.98 - holeWidth) / 2}" y="${strip.y + dy}" width="${holeWidth}" height="${holeHeight}" rx="0.35" fill="${t.background}"/>`)
    if (!options.backgroundOnly && t.edgeText) for (const dx of [9, strip.width - 66])
      body.push(text(strip.x + dx, strip.y + (profile.perforated ? 1.25 : profile.edge / 2), 'pd Darkroom',
        profile.perforated ? 1.3 : 2.2, edgeTextStyle))
  }
  for (const f of l.frames) {
    const a = f.asset
    if (!a) continue
    if (options.pictures && a.preview) {
      const rotated = a.rotation === 90 || a.rotation === 270
      const fit = Math.min(f.width / (rotated ? a.height : a.width), f.height / (rotated ? a.width : a.height))
      const w = a.width * fit, h = a.height * fit
      const centerX = f.x + (profile.mode === 'strip' ? (rotated ? h : w) : f.width) / 2
      body.push(`<g transform="translate(${centerX} ${f.y + f.height / 2}) rotate(${a.rotation})"><image href="${a.preview}" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}"/></g>`)
    }
    if (!options.backgroundOnly) body.push(text(f.x + 1, f.y + f.height + (profile.perforated ? profile.edge - 0.4 : profile.edge / 2),
      String(f.index + 1).padStart(2, '0'), profile.perforated ? 1.35 : 2.2, edgeTextStyle))
    if (a.status === 'error' && options.pictures) body.push(`<rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" fill="#522b2b"/>${text(f.x + f.width / 2, f.y + f.height / 2 + 1, '!', 6, 'fill="#ffffff" text-anchor="middle"')}`)
    if (options.selected === f.index) body.push(`<rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" fill="none" stroke="#dd913b" stroke-width="0.8"/>`)
  }
  if (!options.backgroundOnly && p.notes) {
    const note = l.notes
    note.lines.slice(0, 3).forEach((line, i) => body.push(text(note.x, note.y + i * note.lineHeight, line, note.size, `fill="${noteStyle.color}"`)))
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}mm" height="${l.height}mm" viewBox="0 0 ${l.width} ${l.height}"><g font-family="Arial, Microsoft YaHei, sans-serif" fill="#242422">${body.join('')}</g></svg>`
}
