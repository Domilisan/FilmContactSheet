import { describe, expect, test } from 'vitest'
import { addAssets, defaultTemplate, insertBlank, newProject, projectSchema, type Asset } from '../src/shared/model'
import { scanProfiles, projectProfile, rotationForProfile } from '../src/shared/scan-types'
import { exportErrors, fitProjectPage, layoutSheet, newScanProject, sheetSvg, rollHeader } from '../src/shared/layout'

const asset = (n: number): Asset => ({ id: String(n), path: `/test/strip-${n}.tif`, name: `${n}.tif`, size: 60000000,
  width: 2400, height: 1000, depth: 'ushort', hasIcc: true, space: 'srgb', rotation: 0, status: 'ready', preview: '' })

describe.each(scanProfiles)('$label scan template', profile => {
  test('full template fits the page and preserves the supplied aspect ratio', () => {
    const p = addAssets(newScanProject(defaultTemplate, profile.id), Array.from({ length: profile.columns * profile.rows }, (_, i) => asset(i)))
    p.notes = '第一行备注\n第二行备注\n第三行备注'
    const l = layoutSheet(p)
    expect(l.height / l.width).toBeCloseTo(Math.SQRT2)
    expect(l.frames).toHaveLength(p.slots.length)
    expect(l.rows).toBe(profile.rows)
    expect(l.frames[0].width / l.frames[0].height).toBeCloseTo(profile.ratioWidth / profile.ratioHeight, 10)
    expect(exportErrors(p)).toEqual([])
    for (const frame of l.frames) {
      expect(frame.x).toBeGreaterThanOrEqual(0)
      expect(frame.x + frame.width).toBeLessThanOrEqual(l.width)
      expect(frame.y + frame.height).toBeLessThan(l.notes.y)
    }
    const svg = sheetSvg(p)
    expect(svg.includes('rx="0.35"')).toBe(profile.family !== '120')
    // 装饰齿孔必须留在黑边内，不能穿过图片区域。
    const holes = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="0.35"/g)]
    for (const hole of holes) {
      const top = Number(hole[2]), bottom = top + Number(hole[4])
      expect(l.frames.some(frame => top < frame.y + frame.height && bottom > frame.y)).toBe(false)
    }
    expect(rollHeader(p).details).toContain(profile.mode === 'strip' ? 'STRIPS' : 'FRAMES')
    const label = ['67', '67-strip', '66', '66-strip', '645', '645-strip'].includes(profile.id) ? '120mm' : '135mm'
    expect(rollHeader(p).details.split(' / ')[0]).toBe(label)
    expect(svg).toContain(`>${label} / `)
  })
  test('save/open retains type and geometry; hiding empty rows leaves notes anchored', () => {
    const p = addAssets(newScanProject(defaultTemplate, profile.id), [asset(1)])
    const before = layoutSheet(p)
    const loaded = projectSchema.parse(JSON.parse(JSON.stringify(p)))
    expect(loaded.format).toBe(profile.id)
    expect(loaded.layoutVersion).toBe(2)
    expect(layoutSheet(loaded)).toEqual(before)
    loaded.template.hideEmpty = false
    expect(layoutSheet(loaded).notes).toEqual(before.notes)
    expect(layoutSheet(loaded).frames).toHaveLength(profile.rows * profile.columns)
    expect(before.frames).toHaveLength(profile.columns)
  })
})

test('legacy files without layoutVersion retain their original geometry', () => {
  const old = JSON.parse(JSON.stringify(newProject()))
  delete old.layoutVersion
  const loaded = projectSchema.parse(old)
  expect(loaded.layoutVersion).toBe(1)
  expect(projectProfile(loaded).frameWidth).toBe(36)
  expect(projectProfile(loaded).frameHeight).toBe(24)
  expect(layoutSheet(loaded).strips[0].width).toBe(228)
})

test('whole-strip imports retain one asset per row and grow without splitting', () => {
  const incoming = Array.from({ length: 9 }, (_, i) => asset(i))
  const p = fitProjectPage(addAssets(newScanProject(defaultTemplate, '135-strip'), incoming))
  expect(p.slots).toEqual(incoming)
  expect(p.overflow).toHaveLength(0)
  expect(layoutSheet(p).frames).toHaveLength(9)
  expect(layoutSheet(p).rows).toBe(9)
  expect(exportErrors(p)).toEqual([])
  expect(projectSchema.parse(JSON.parse(JSON.stringify(p))).slots).toEqual(incoming)
})

test('single-frame capacity depends on format, including half frames', () => {
  const half = newProject(defaultTemplate, 'half')
  expect(half.slots).toHaveLength(84)
  const p = addAssets(half, Array.from({ length: 85 }, (_, i) => asset(i)))
  expect(p.overflow).toHaveLength(1)
  expect(() => insertBlank(p, 0)).toThrow('84')
  expect(projectSchema.safeParse({ ...p, slots: p.slots.slice(0, 42) }).success).toBe(false)
})

test('portrait formats preserve upright portrait scans and rotate landscape scans to fit', () => {
  for (const id of ['half', '645'] as const) {
    const profile = projectProfile(newProject(defaultTemplate, id))
    expect(rotationForProfile({ width: 1830, height: 2480 }, profile)).toBe(0)
    expect(rotationForProfile({ width: 2480, height: 1830 }, profile)).toBe(90)
  }
})
