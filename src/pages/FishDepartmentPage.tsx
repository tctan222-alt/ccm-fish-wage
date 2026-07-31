import { Link } from 'react-router-dom'

export function FishDepartmentPage() {
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>鱼头鱼仔部</h1></header>
    <nav className="department-links" aria-label="鱼头鱼仔部入口">
      <Link to="/fish-head-purchase">鱼头购入</Link><Link to="/fish-meal-purchase">鱼仔购入</Link><Link to="/fish-head-wages">切鱼头工钱计算</Link>
    </nav>
  </main>
}
