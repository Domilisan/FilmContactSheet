import { describe, expect, test } from 'vitest'
import { newProject, addAssets, insertBlank, removeAndShift, projectSchema, type Asset } from '../src/shared/model'
import { exportErrors, layoutSheet, sheetSvg, rollHeader } from '../src/shared/layout'
import { fixedLogo } from '../src/shared/branding'
import { readFileSync } from 'node:fs'

const asset = (n: number): Asset => ({ id: String(n), path: `/test/${n}.tif`, name: `${n}.tif`,
  width: 3600, height: 2400, size: 60_000_000, depth: 'ushort', space: 'srgb', hasIcc: true,
  rotation: 0, preview: '', status: 'ready' })
const roll = (n: number) => addAssets(newProject(), Array.from({ length: n }, (_, i) => asset(i + 1)))

describe('135 physical layout', () => {
  test('older projects without a workspace name remain readable', () => {
    const legacy = JSON.parse(JSON.stringify(roll(1)))
    delete legacy.name
    expect(projectSchema.parse(legacy).name).toBe('')
    expect(projectSchema.parse({ ...legacy, name: '旅行卷 01' }).name).toBe('旅行卷 01')
  })
  test('fixed logo uses pics/logo.jpg and legacy logo settings cannot move or replace it', () => {
    const p = roll(36)
    const legacy = JSON.parse(JSON.stringify(p))
    Object.assign(legacy.template, { logo: 'data:image/png;base64,old', logoWidth: 60, logoPosition: 'right' })
    const loaded = projectSchema.parse(legacy)
    expect(loaded.template).not.toHaveProperty('logo')
    expect(fixedLogo.data).toBe(`data:image/jpeg;base64,${readFileSync('pics/logo.jpg').toString('base64')}`)
    const layout = layoutSheet(loaded)
    expect(layout.logo.x).toBe(209)
    expect(layout.logo.y + layout.logo.height).toBeCloseTo(layout.height - 12 - 4)
    expect(sheetSvg(loaded)).toContain(`href="${fixedLogo.data}" x="209" y="${layout.logo.y}" width="30" height="30"`)
    expect(layoutSheet(loaded).strips).toEqual(layoutSheet(p).strips)
    const before = p.template.marginTop + Math.max(30, p.template.infoSize * 3.5, rollHeader(p).detailsY + rollHeader(p).detailsSize + 1) + p.template.headerGap
    expect(layoutSheet(p).strips[0].y).toBe(before - 20)
    expect(layoutSheet(p).strips[0].y).toBe(38)
    expect(layoutSheet(p).frames[0].y).toBe(before - 20 + 5.5)
  })
  test('bottom-right logo follows page margins and blocks overlapping film strips', () => {
    const p = roll(42)
    p.template.pageWidth = 280
    p.template.marginRight = 16
    p.template.marginBottom = 18
    const l = layoutSheet(p)
    expect(l.logo.x + l.logo.width).toBe(264)
    expect(l.logo.y + l.logo.height).toBeCloseTo(l.height - 18 - 4)
    expect(exportErrors(p)).toEqual([])
    p.template.stripGap = 12
    expect(exportErrors(p).some(e => e.includes('右下角 Logo'))).toBe(true)
  })
  test('old projects open without scanner and new scanner values survive saving', () => {
    const legacy = JSON.parse(JSON.stringify(roll(1)))
    delete legacy.scanner
    const loaded = projectSchema.parse(legacy)
    expect(loaded.scanner).toBe('')
    loaded.scanner = 'Noritsu HS-1800'
    expect(projectSchema.parse(JSON.parse(JSON.stringify(loaded))).scanner).toBe('Noritsu HS-1800')
  })
  test('three-line header escapes user text, fits before film and validates long scanner names', () => {
    const p = roll(38)
    p.film = 'Kodak Gold 200'; p.roll = 'PD-001 / 王小明'; p.scanner = 'HS-1800 <Lab>'; p.date = '2026-11-16'
    const header = rollHeader(p), layout = layoutSheet(p)
    expect(header.title).toBe(p.film)
    expect(header.order).toBe(p.roll)
    expect(header.details).toContain('HS-1800 <Lab>')
    expect(header.details.endsWith(p.date)).toBe(true)
    expect(header.details).not.toContain(p.film)
    expect(header.orderY).toBeGreaterThan(0)
    expect(header.detailsY - header.orderY).toBeGreaterThan(p.template.infoSize)
    expect(layout.headerY + header.detailsY + header.detailsSize).toBeLessThan(layout.strips[0].y)
    expect(exportErrors(p)).toEqual([])
    expect(sheetSvg(p)).toContain('HS-1800 &lt;Lab&gt;')
    p.scanner = '扫描仪'.repeat(40)
    expect(exportErrors(p).some(e => e.includes('扫描仪') && e.includes('信息过长'))).toBe(true)
  })
  test('36 photos hide one row without changing page or image dimensions', () => {
    const p = roll(36), before = layoutSheet(p)
    expect(before.rows).toBe(6)
    expect(before.hidden).toBe(1)
    expect(before.frames).toHaveLength(36)
    expect(before.frames[0].width).toBe(36)
    expect(before.frames[0].height).toBe(24)
    expect(before.strips[5].y + 35 - before.strips[0].y).toBe(212.5)
    p.template.hideEmpty = false
    const after = layoutSheet(p)
    expect(after.rows).toBe(7)
    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
    expect(after.strips[6].y + 35 - after.strips[0].y).toBe(248)
  })
  test('notes stay below the seventh strip when empty strips are hidden', () => {
    const p = roll(36)
    p.notes = '冲扫备注\n第二行备注'
    p.scanner = 'Hasselblad X5'
    const hidden = layoutSheet(p)
    p.template.hideEmpty = false
    const full = layoutSheet(p)
    expect(hidden.notes).toEqual(full.notes)
    expect(full.notes.y - full.notes.size).toBe(full.strips[6].y + 35 + 3)
    expect(exportErrors(p)).toEqual([])
    const svg = sheetSvg(p)
    expect(svg).toContain('font-size="3.5" fill="#333333">冲扫备注</text>')
    expect(full.notes.lineHeight).toBe(5)
    p.template.stripGap += 1
    expect(layoutSheet(p).notes.y).toBe(full.notes.y + 6)
  })
  test('larger notes wrap within the film width and report overflow', () => {
    const p = roll(36)
    p.notes = '字'.repeat(70)
    const layout = layoutSheet(p)
    expect(layout.notes.lines).toHaveLength(2)
    expect(layout.notes.lines.join('')).toBe(p.notes)
    expect(layout.notes.lines.every(line => line.length * layout.notes.size <= 228)).toBe(true)
    p.template.marginTop = 100
    expect(exportErrors(p).some(error => error.includes('备注超出页面底部'))).toBe(true)
  })
  test('38 photos preserve the partially filled last strip', () => {
    const l = layoutSheet(roll(38))
    expect(l.rows).toBe(7)
    expect(l.frames.filter(f => f.asset)).toHaveLength(38)
    expect(l.frames.slice(-4).every(f => !f.asset)).toBe(true)
  })
  test('an inserted empty strip in the middle is never collapsed', () => {
    const p = roll(12)
    p.slots.splice(6, 0, ...Array.from({ length: 6 }, () => null))
    p.slots.length = 42
    expect(layoutSheet(p).rows).toBe(3)
  })
  test('43 photos are retained and block export', () => {
    const p = roll(43)
    expect(p.overflow).toHaveLength(1)
    expect(exportErrors(p).some(e => e.includes('超出容量'))).toBe(true)
    const shifted = removeAndShift(p, 0)
    expect(shifted.slots[41]?.name).toBe('43.tif')
    expect(shifted.overflow).toHaveLength(0)
  })
  test('insert blank consumes a trailing empty slot and refuses to drop photos', () => {
    const p = insertBlank(roll(36), 3)
    expect(p.slots).toHaveLength(42)
    expect(p.slots[3]).toBeNull()
    expect(p.slots[4]?.name).toBe('4.tif')
    expect(() => insertBlank(roll(42), 0)).toThrow()
  })
  test('invalid margins or height block export instead of shrinking the film', () => {
    const p = roll(42)
    p.template.marginLeft = 40
    expect(exportErrors(p).length).toBeGreaterThan(0)
    expect(layoutSheet(p).frames[0].width).toBe(36)
    p.template.marginLeft = 11; p.template.stripGap = 25
    expect(exportErrors(p).some(e => e.includes('底部'))).toBe(true)
  })
  test('empty input blocks export; HTML is escaped in SVG text', () => {
    expect(exportErrors(newProject()).length).toBeGreaterThan(0)
    const p = roll(1); p.template.brand = '<script>&evil'
    expect(sheetSvg(p)).not.toContain('<script>')
    expect(sheetSvg(p)).toContain('&lt;script&gt;&amp;evil')
  })
})
