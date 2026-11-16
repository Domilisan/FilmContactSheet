import { photoCount, type Project, type Asset } from './model'
import { fixedLogo, filmOffsetY } from './branding'

// 导出图第三行（扫描仪等信息）的字号，单位为 mm。
const detailsFontSize = 3.5
// 备注：字号、距第七行胶片底边的留白、行距（mm），以及文字颜色。
const noteStyle = { size: 3.5, gap: 3, lineHeight: 5, color: '#333333' }

export interface Rect { x: number; y: number; width: number; height: number }
export interface Frame extends Rect { index: number; asset: Asset | null }
export interface SheetLayout {
  width: number; height: number; rows: number; hidden: number;
  strips: Rect[]; frames: Frame[]; errors: string[];
  headerY: number; contentX: number; headerHeight: number
  logo: Rect
  notes: { x: number; y: number; size: number; lineHeight: number; lines: string[] }
}

// 导出页头的三行卷信息。字号、行位置均使用毫米坐标。
export function rollHeader(p: Project) {
  const t = p.template
  const titleSize = t.infoSize + 5 // 第一行胶卷型号：默认 4mm，比普通卷信息大
  const orderY = 6 // 第二行距页头基准的位置
  const detailsY = orderY + 6 // 第三行距页头基准的位置
  return {
    title: p.film.trim() || '未填写胶卷型号',
    titleSize,
    order: p.roll.trim(), // 可以填写订单编号，也可以填写拍摄者
    orderY,
    details: ['135', `${photoCount(p)} FRAMES`, p.scanner.trim(),
      t.showDate && p.date].filter(Boolean).join(' / '),
    detailsY,
    detailsSize: Math.min(t.infoSize, 2)
  }
}

export function layoutSheet(p: Project): SheetLayout {
  const t = p.template
  const header = rollHeader(p)
  const width = t.pageWidth, height = width * Math.SQRT2
  const last = p.slots.findLastIndex(Boolean)
  const rows = t.hideEmpty ? Math.max(1, Math.ceil((last + 1) / 6)) : 7
  const contentWidth = width - t.marginLeft - t.marginRight
  // 保留已有页头高度，移动 Logo 时胶片位置不随之改变。
  const headerHeight = Math.max(30, t.infoSize * 3.5, header.detailsY + header.detailsSize + 1)
  const logo = { x: width - t.marginRight - fixedLogo.width, y: height - t.marginBottom - fixedLogo.width-4,
    width: fixedLogo.width, height: fixedLogo.width }
  const x = t.marginLeft + (t.align === 'left' ? 0 : t.align === 'right' ? contentWidth - 228 : (contentWidth - 228) / 2)
  const y = t.marginTop + headerHeight + t.headerGap + filmOffsetY
  const strips = Array.from({ length: rows }, (_, row) => ({ x, y: y + row * (35 + t.stripGap), width: 228, height: 35 }))
  const frames = strips.flatMap((strip, row) => Array.from({ length: 6 }, (_, col) => ({
    x: strip.x + 1 + col * 38, y: strip.y + 5.5, width: 36, height: 24,
    index: row * 6 + col, asset: p.slots[row * 6 + col]
  })))
  const errors: string[] = []
  if (contentWidth < 228 - 0.00001) errors.push('左右页边距过大：版心至少需要 228mm 宽。请扩大页面或减小页边距。')
  if (y + rows * 35 + (rows - 1) * t.stripGap > height - t.marginBottom)
    errors.push('胶片或备注超出页面底部，请扩大页面或减小留白。')
  if (y + rows * 35 + (rows - 1) * t.stripGap > logo.y)
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
  const noteWidth = Math.max(1, Math.min(228, contentWidth))
  const noteLines = p.notes.split('\n').flatMap(line => {
    const lines = ['']
    for (const char of line) {
      if (lines.at(-1) && estimatedWidth(lines.at(-1)! + char, noteStyle.size) > noteWidth) lines.push('')
      lines[lines.length - 1] += char
    }
    return lines
  })
  // 固定以完整七行胶片的底边为基准，隐藏空行不改变备注位置。
  const notes = { x, y: y + 7 * 35 + 6 * t.stripGap + noteStyle.gap + noteStyle.size,
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
  return { width, height, rows, hidden: 7 - rows, strips, frames, errors, headerY: t.marginTop, contentX: t.marginLeft, headerHeight, logo, notes }
}
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
export function sheetSvg(p: Project, options: { pictures?: boolean; selected?: number; backgroundOnly?: boolean } = {}): string {
  const l = layoutSheet(p), t = p.template
  const body: string[] = [`<rect width="${l.width}" height="${l.height}" fill="${t.background}"/>`]
  const right = l.width - t.marginRight
  if (!options.backgroundOnly) {
    body.push(`<image href="${fixedLogo.data}" x="${l.logo.x}" y="${l.logo.y}" width="${l.logo.width}" height="${l.logo.height}" preserveAspectRatio="xMidYMid meet"/>`)
    const brandX = l.contentX
    const header = rollHeader(p)
    // 左右两列共用行中心，字号不同时也按同一水平线居中对齐。
    const firstLineY = l.headerY
    const secondLineY = l.headerY + header.orderY
    body.push(text(brandX, firstLineY, t.brand, 3.8, 'dominant-baseline="middle" font-weight="700"'))
    body.push(text(brandX, secondLineY, 'Film Contact Sheet', 4.0, 'dominant-baseline="middle" letter-spacing="0.45" fill="#666666"'))
    const infoRight = right
    // 第一行：胶卷型号，加大、加粗。保持原卷信息区的右对齐位置。
    body.push(text(infoRight, firstLineY, header.title, header.titleSize, 'dominant-baseline="middle" text-anchor="end" font-weight="700"'))
    // 第二行：订单编号或拍摄者，未填写时留空。
    if (header.order) body.push(text(infoRight, secondLineY, header.order, 5, 'dominant-baseline="middle" text-anchor="end" font-weight="400"'))
    // 第三行：画幅、张数、扫描仪，日期放在最后。
    body.push(text(infoRight, l.headerY + header.detailsY, header.details, detailsFontSize, 'text-anchor="end" fill="#666666"'))
  }
  for (const strip of l.strips) {
    body.push(`<rect x="${strip.x}" y="${strip.y}" width="228" height="35" fill="#171715"/>`)
    for (let i = 0; i < 48; i++) for (const dy of [1.65, 30.55])
      body.push(`<rect x="${strip.x + 1.385 + i * 4.75}" y="${strip.y + dy}" width="1.98" height="2.79" rx="0.35" fill="${t.background}"/>`)
    if (!options.backgroundOnly && t.edgeText) for (const dx of [9, 162])
      body.push(text(strip.x + dx, strip.y + 1.25, 'pd Darkroom', 1.3, 'fill="#ffd878" font-weight="700"'))
  }
  for (const f of l.frames) {
    const a = f.asset
    if (!a) continue
    if (options.pictures && a.preview) {
      const rotated = a.rotation === 90 || a.rotation === 270
      const fit = Math.min(f.width / (rotated ? a.height : a.width), f.height / (rotated ? a.width : a.height))
      const w = a.width * fit, h = a.height * fit
      body.push(`<g transform="translate(${f.x + 18} ${f.y + 12}) rotate(${a.rotation})"><image href="${a.preview}" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}"/></g>`)
    }
    if (!options.backgroundOnly) body.push(text(f.x + 1, f.y + 29.1, String(f.index + 1).padStart(2, '0'), 1.35, 'fill="#ffd878" font-weight="700"'))
    if (a.status === 'error' && options.pictures) body.push(`<rect x="${f.x}" y="${f.y}" width="36" height="24" fill="#522b2b"/>${text(f.x + 18, f.y + 13, '!', 6, 'fill="#ffffff" text-anchor="middle"')}`)
    if (options.selected === f.index) body.push(`<rect x="${f.x}" y="${f.y}" width="36" height="24" fill="none" stroke="#dd913b" stroke-width="0.8"/>`)
  }
  if (!options.backgroundOnly && p.notes) {
    const note = l.notes
    note.lines.slice(0, 3).forEach((line, i) => body.push(text(note.x, note.y + i * note.lineHeight, line, note.size, `fill="${noteStyle.color}"`)))
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}mm" height="${l.height}mm" viewBox="0 0 ${l.width} ${l.height}"><g font-family="Arial, Microsoft YaHei, sans-serif" fill="#242422">${body.join('')}</g></svg>`
}
