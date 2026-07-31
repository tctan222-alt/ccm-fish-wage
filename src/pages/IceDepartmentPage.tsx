import { Link } from 'react-router-dom'
import { ICE_VESSELS } from './DashboardPage'

export function IceDepartmentPage() {
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>冰工部门</h1><p>请选择船只。</p></header>
    <nav className="vessel-button-grid" aria-label="冰工船只">{ICE_VESSELS.map(vessel=><Link key={vessel} to={`/ice-department/${vessel}`}>{vessel}</Link>)}</nav>
  </main>
}
