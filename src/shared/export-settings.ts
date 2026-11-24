// 单张高清索引的文件大小上限：25MB（25,000,000 字节）。
export const MAX_EXPORT_BYTES = 25_000_000
export const DEFAULT_JPEG_QUALITY = 94

export function defaultExportName(roll: string, width: number): string {
  const stem = (roll.trim() || '未命名胶卷').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || '胶卷'
  return `${stem}_索引_高清_${width}px`
}

// 只接受文件名，不允许通过命名字段改变输出目录。
export function exportFilename(name: string): string {
  const stem = name.trim().replace(/\.jpe?g$/i, '')
  if (!stem) throw new Error('请填写导出文件名。')
  if (stem.length > 180) throw new Error('文件名最多 180 个字符。')
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) throw new Error('文件名不能包含 < > : " / \\ | ? * 或控制字符。')
  if (/[. ]$/.test(stem)) throw new Error('文件名不能以句点或空格结尾。')
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) throw new Error('这个名称是系统保留名称，请换一个文件名。')
  return `${stem}.jpg`
}
