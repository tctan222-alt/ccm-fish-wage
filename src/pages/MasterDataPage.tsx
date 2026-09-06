import { Link } from 'react-router-dom'
export function MasterDataPage(){
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>Master Data</h1><Link className="page-link" to="/">← Wage entry</Link></header>
    <nav className="master-data-entries" aria-label="Master data sections">
      <Link to="/partners"><strong>Business Partners</strong><span>Suppliers and customers</span></Link>
      <Link to="/workers"><strong>Workers</strong><span>Employees and wage selection</span></Link>
      <Link to="/vessels"><strong>Vessels</strong><span>Receiving vessels and default suppliers</span></Link>
      <Link to="/vessel-wage-templates"><strong>Vessel Wage Templates</strong><span>978 / 833 day and night wage rates</span></Link>
      <Link to="/purchase-categories"><strong>Purchase Categories</strong><span>Fish categories used on receiving receipts</span></Link>
      <Link to="/fish-species"><strong>鱼名管理</strong><span>现场称重使用的中文鱼名与顺序</span></Link>
      <Link to="/retail-sales/fish"><strong>门市鱼名与建议价</strong><span>中文 / 马来文、建议售价、启用状态</span></Link>
      <Link to="/purchases"><strong>Purchases & Receiving</strong><span>Receipts, supplier payables and monthly statements</span></Link>
    </nav>
  </main>
}
