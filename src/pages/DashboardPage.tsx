import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Vessel } from '../lib/purchasing'
import { loadActiveVessels } from '../services/purchaseMasterData'

interface Props { vesselLoader?: () => Promise<Vessel[]> }

export function DashboardPage({ vesselLoader = loadActiveVessels }: Props) {
  const [vessels, setVessels] = useState<Vessel[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setStatus('loading')
    void vesselLoader().then(items => { if (current) { setVessels(items); setStatus('ready') } }).catch(() => { if (current) setStatus('error') })
    return () => { current = false }
  }, [vesselLoader, attempt])
  return <main className="department-dashboard">
    <header><p className="eyebrow">CCM Fishery</p><h1>CCM 首页</h1><p>请选择部门继续。</p></header>
    <section className="department-card">
      <h2>鱼头鱼仔部</h2>
      <nav aria-label="鱼头鱼仔部入口" className="department-links">
        <Link to="/fish-head-purchase">鱼头购入</Link><Link to="/fish-head-settlement">鱼头结单</Link>
        <Link to="/fish-meal-purchase">鱼仔购入</Link><Link to="/fish-meal-settlement">鱼仔结单</Link>
        <Link to="/fish-head-wages">切鱼头工钱计算</Link>
      </nav>
    </section>
    <section className="department-card">
      <h2>冰工部门</h2>
      {status === 'loading' && <p role="status">正在载入船号… Loading vessels…</p>}
      {status === 'error' && <><p className="error" role="alert">无法载入船号，请检查网络后重试。 Unable to load vessels. Check your connection and retry.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试 Retry</button></>}
      {status === 'ready' && (vessels.length ? <nav aria-label="冰工船只" className="vessel-button-grid">{vessels.map(vessel => <Link key={vessel.id} to={`/ice-department/${vessel.id}`}>{vessel.vesselCode}</Link>)}</nav> : <p>没有启用中的船号。 No active vessels.</p>)}
      <Link className="page-link" to="/ice-department">查看冰工部门</Link>
    </section>
    <section className="department-card"><h2>门市销售</h2><Link className="page-link" to="/retail-sales">快速现金结算</Link></section>
    <section className="department-card muted-department"><h2>CCM 行政</h2><p>建设中</p><Link className="page-link" to="/ccm-admin">查看</Link></section>
    <section className="department-card master-data-dashboard"><Link className="primary-action" to="/master-data">主资料 Master Data</Link></section>
  </main>
}
