import { useState } from 'react'

const presets = ['次', '参', '味']
const selectionFor = (value: string) => !value ? '' : presets.includes(value) ? value : 'other'

/** Optional blank and arbitrary historical remarks remain supported. */
export function RetailLineRemarkField({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [choice, setChoice] = useState(() => ({ value, selection: selectionFor(value) }))
  // External resets/history loads infer a selection; our own typing preserves
  // Other even when the first character happens to equal a preset.
  if (choice.value !== value) setChoice({ value, selection: selectionFor(value) })
  const selection = choice.value === value ? choice.selection : selectionFor(value)
  function change(next: string, mode: string) {
    setChoice({ value: next, selection: mode }); onChange(next)
  }
  return <div className="retail-line-remark-field"><label>{label}<select aria-label={label} value={selection}
    onChange={event => change(event.target.value === 'other' ? '' : event.target.value, event.target.value)}>
    <option value="">无备注 None</option>{presets.map(text => <option value={text} key={text}>{text}</option>)}<option value="other">其他</option>
  </select></label>{selection === 'other' && <label>其他备注 Custom Remark<input aria-label={`${label} · 其他备注 Custom Remark`} maxLength={500}
    value={value} placeholder="输入本条鱼货备注 Enter this fish's remark" onChange={event => change(event.target.value, 'other')} /></label>}</div>
}
