import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Vessel } from '../lib/purchasing'
import { loadActiveVessels } from '../services/purchaseMasterData'

interface Props { vesselLoader?: () => Promise<Vessel[]> }

export function IceDepartmentPage({ vesselLoader = loadActiveVessels }: Props) {
  const [vessels, setVessels] = useState<Vessel[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void vesselLoader().then(setVessels).catch(() => setError('无法载入船号。'))
  }, [vesselLoader])

  return <main><header><p className="eyebrow">CCM Fishery</p><h1>冰工部门</h1><p>请选择船只。</p></header>
    {error && <p className="error">{error}</p>}
    <nav className="vessel-button-grid" aria-label="冰工船只">{vessels.map(vessel => <Link key={vessel.id} to={`/ice-department/${vessel.id}`}>{vessel.vesselCode}</Link>)}</nav>
  </main>
}
