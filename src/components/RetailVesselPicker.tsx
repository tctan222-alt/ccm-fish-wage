import { useEffect, useState } from 'react'
import { loadActiveVessels } from '../services/purchaseMasterData'
import type { Vessel } from '../lib/purchasing'

export function useRetailVessels() {
  const [vessels, setVessels] = useState<Vessel[] | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setVessels(null); setError('')
    void loadActiveVessels().then(items => { if (current) setVessels(items) }).catch(() => { if (current) setError('船号载入失败，请重试。 Unable to load vessels. Please retry.') })
    return () => { current = false }
  }, [retry])
  return { vessels, error, retry: () => setRetry(value => value + 1) }
}

export function RetailVesselPicker({ vessels, error, retry, value, onChange, historical }: {
  vessels: Vessel[] | null; error: string; retry: () => void; value: string; onChange: (id: string) => void;
  historical?: { vesselId?: string; vesselCodeSnapshot?: string }
}) {
  return <div className="retail-vessel-picker"><label>船号 Vessel<select value={value} onChange={event => onChange(event.target.value)} disabled={vessels === null}>
    <option value="">{vessels === null ? '载入中 Loading…' : '选择船号 Select Vessel'}</option>
    {vessels?.map(item => <option key={item.id} value={item.id}>{item.vesselCode}</option>)}
    {historical?.vesselId && !vessels?.some(item => item.id === historical.vesselId) && <option value={historical.vesselId}>{historical.vesselCodeSnapshot || '—'}（原船号 Original）</option>}
  </select></label>{error && <><p role="alert" className="error">{error}</p><button type="button" onClick={retry}>重试船号 Retry Vessels</button></>}</div>
}
