import logoData from 'virtual:pdimpression-logo'

// 固定暗房 Logo：图片源文件为 pics/logo.jpg，固定在页面右下角的页边距内。
export const fixedLogo = {
  data: logoData,
  width: 30 // mm；右侧与底部分别跟随右页边距、底部留白
} as const

// 所有胶片条、画格和编号整体向上移动 20mm（比上一版再上移 10mm）。
export const filmOffsetY = -20
