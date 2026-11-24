import { expect, test } from 'vitest'
import { defaultExportName, exportFilename } from '../src/shared/export-settings'

test('default filenames keep the order and resolution naming rule', () => {
  expect(exportFilename(defaultExportName('TEST-001', 6000))).toBe('TEST-001_索引_高清_6000px.jpg')
  expect(exportFilename(defaultExportName('', 8000))).toBe('未命名胶卷_索引_高清_8000px.jpg')
})
test('custom names support Chinese and do not duplicate JPEG extensions', () => {
  expect(exportFilename(' 冷静_胶卷索引 ')).toBe('冷静_胶卷索引.jpg')
  expect(exportFilename('旅行.JPG')).toBe('旅行.jpg')
  expect(exportFilename('旅行.jpeg')).toBe('旅行.jpg')
})
test.each(['', ' ', '.jpg', '..', '../photo', 'C:\\photo', 'a/b', 'a:b', 'a\n', 'CON', 'nul.jpg', 'COM1.backup', 'end.', 'x'.repeat(181)])('rejects unsafe or empty filename %j', value => {
  // Leading/trailing ordinary spaces are normalized, control characters remain invalid.
  expect(() => exportFilename(value)).toThrow()
})
