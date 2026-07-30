import { Link } from 'react-router-dom'
export function MasterDataPage(){
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>Master Data</h1><Link className="page-link" to="/">← Wage entry</Link></header>
    <nav className="master-data-entries" aria-label="Master data sections">
      <Link to="/partners"><strong>Business Partners</strong><span>Suppliers and customers</span></Link>
      <Link to="/workers"><strong>Workers</strong><span>Employees and wage selection</span></Link>
    </nav>
  </main>
}
