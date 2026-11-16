// 扫描仪下拉选项，按暗房提供的设备清单填写。
// label 是菜单中的中文名称；value 是保存到项目和显示在导出图片中的名称。
// 增加设备时，在数组里增加一行即可。
export const scannerOptions = [
  { label: '诺日士 SA1700', value: 'Noritsu SA1700' },
  { label: '哈苏 X5', value: 'Hasselblad X5' }
] as const

const knownScanners = new Set<string>(scannerOptions.map(scanner => scanner.value))
export const isPresetScanner = (scanner: string) => knownScanners.has(scanner)
export const OTHER_SCANNER = '__other_scanner__'
