// 暗房提供的是“高 : 宽”的扫描比例，没有长度单位。
// frameHeight 等数值只用于输出页面排版，不代表底片实测尺寸。
export const scanTypeIds = ['135', '135-strip', 'half', '67', '67-strip', '66', '66-strip', 'xpan', 'xpan-strip', '645', '645-strip'] as const
export type ScanType = typeof scanTypeIds[number]
export interface ScanProfile {
  id: ScanType; label: string; family: string; mode: 'single' | 'strip'
  ratioHeight: number; ratioWidth: number; perforated: boolean
  columns: number; rows: number; frameHeight: number; frameWidth: number
  side: number; edge: number; gap: number; stripWidth: number; stripHeight: number
}
function single(id: ScanType, label: string, family: string, ratioHeight: number, ratioWidth: number,
  columns: number, rows: number, compact: boolean): ScanProfile {
  const frameHeight = compact ? 24 : 56
  const frameWidth = frameHeight * ratioWidth / ratioHeight
  const side = compact ? 1 : 2, edge = compact ? 5.5 : 3.6
  const gap = id === 'half' ? 1 : compact ? 2 : 3
  // 120 使用无齿孔黑色片边；画格尺寸独立于边框样式。
  return { id, label, family, mode: 'single', ratioHeight, ratioWidth, perforated: family !== '120', columns, rows,
    frameHeight, frameWidth, side, edge, gap,
    stripWidth: side * 2 + frameWidth * columns + gap * (columns - 1), stripHeight: frameHeight + edge * 2 }
}
function strip(base: ScanProfile, id: ScanType, ratioHeight: number, ratioWidth: number): ScanProfile {
  const frameWidth = base.stripWidth - base.side * 2
  const frameHeight = frameWidth * ratioHeight / ratioWidth
  return { ...base, id, label: `${base.label} 整条`, mode: 'strip', ratioHeight, ratioWidth,
    columns: 1, frameWidth, frameHeight, stripHeight: frameHeight + base.edge * 2 }
}
const full = single('135', '135', '135', 2.48, 3.69, 6, 7, true)
const sixSeven = single('67', '6×7', '120', 5.64, 7.11, 3, 4, false)
const sixSix = single('66', '6×6', '120', 5.64, 5.64, 3, 4, false)
const panorama = single('xpan', 'XPan', 'XPan', 2.42, 6.59, 3, 7, true)
const sixFourFive = single('645', '6×4.5', '120', 5.6, 4.16, 4, 4, false)
export const scanProfiles: ScanProfile[] = [
  full, strip(full, '135-strip', 2.48, 22.59),
  single('half', '135半格', '135', 2.48, 1.83, 12, 7, true),
  sixSeven, strip(sixSeven, '67-strip', 5.64, 22.15),
  sixSix, strip(sixSix, '66-strip', 5.64, 18.15),
  panorama, strip(panorama, 'xpan-strip', 2.42, 19.77),
  sixFourFive, strip(sixFourFive, '645-strip', 5.6, 19.22)
]
export const scanProfile = (id: ScanType) => scanProfiles.find(profile => profile.id === id)!
const legacy135: ScanProfile = { ...full, frameWidth: 36, frameHeight: 24, stripWidth: 228, stripHeight: 35 }
export const projectProfile = (p: { format: ScanType; layoutVersion: number }) => p.layoutVersion === 1 ? legacy135 : scanProfile(p.format)
export const ratioLabel = (p: ScanProfile) => `${p.ratioHeight} : ${p.ratioWidth}`
export const capacityLabel = (p: ScanProfile) => p.mode === 'strip' ? `整条保留 · 默认 ${p.rows} 条，可随导入增加` : `${p.columns * p.rows} 格 · ${p.columns} 张 × ${p.rows} 行`

// 只选择朝向，不裁切、不拉伸。半格、6×4.5 的默认画格为竖向。
export function rotationForProfile(asset: { width: number; height: number }, profile: ScanProfile): 0 | 90 {
  if (!asset.width || !asset.height || profile.frameWidth === profile.frameHeight) return 0
  return (asset.width > asset.height) === (profile.frameWidth > profile.frameHeight) ? 0 : 90
}
