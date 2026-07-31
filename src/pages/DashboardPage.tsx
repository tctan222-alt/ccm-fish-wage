import { Link } from 'react-router-dom'

const ICE_VESSELS = ['978', '833', '2072', '9633', '4818', '2031', '1785', '5202']

export function DashboardPage() {
  return <main className="department-dashboard">
    <header><p className="eyebrow">CCM Fishery</p><h1>CCM 首页</h1><p>请选择部门继续。</p></header>
    <section className="department-card">
      <h2>鱼头鱼仔部</h2>
      <nav aria-label="鱼头鱼仔部入口" className="department-links">
        <Link to="/fish-head-purchase">鱼头购入</Link>
        <Link to="/fish-meal-purchase">鱼仔购入</Link>
        <Link to="/fish-head-wages">切鱼头工钱计算</Link>
      </nav>
    </section>
    <section className="department-card">
      <h2>冰工部门</h2>
      <nav aria-label="冰工船只" className="vessel-button-grid">
        {ICE_VESSELS.map(vessel => <Link key={vessel} to={`/ice-department/${vessel}`}>{vessel}</Link>)}
      </nav>
      <Link className="page-link" to="/ice-department">查看冰工部门</Link>
    </section>
    <section className="department-card muted-department">
      <h2>CCM 行政</h2><p>建设中</p><Link className="page-link" to="/ccm-admin">查看</Link>
    </section>
  </main>
}

export { ICE_VESSELS }
