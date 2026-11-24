import { scanProfiles, ratioLabel, capacityLabel, type ScanType } from '../../shared/scan-types'

const scanRows: [ScanType, ScanType | null][] = [
  ['135', '135-strip'], ['half', null], ['645', '645-strip'],
  ['66', '66-strip'], ['67', '67-strip'], ['xpan', 'xpan-strip']
]

export default function ScanTypePicker({ disabled, onChoose }: { disabled: boolean; onChoose(type: ScanType): void }) {
  return <section className="scan-picker" aria-label="选择扫描类型">
    <h2>选择扫描类型</h2>
    <div className="scan-type-groups">
      {(['single', 'strip'] as const).map(mode => <section className="scan-type-group" key={mode} aria-label={mode === 'single' ? '单张扫描' : '整条扫描'}>
        <h3>{mode === 'single' ? '单张' : '整条'}</h3>
        <div className="scan-type-grid">
      {scanRows.map(([single, strip]) => {
        const id = mode === 'single' ? single : strip
        if (!id) return null
        const profile = scanProfiles.find(profile => profile.id === id)!
        return <button key={profile.id} className="scan-type-card"
        disabled={disabled} onClick={() => onChoose(profile.id)} aria-label={`选择 ${profile.label}`}>
        <span className="scan-card-heading"><strong>{profile.label}</strong><span>{profile.mode === 'strip' ? '整条' : '单张'}</span></span>
        <span className="scan-ratio">高 : 宽 = {ratioLabel(profile)}</span>
        <small>{capacityLabel(profile)}</small>
      </button>})}
        </div>
      </section>)}
    </div>
  </section>
}
