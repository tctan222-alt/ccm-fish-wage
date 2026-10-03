import { Link, useLocation } from 'react-router-dom'

/** Mounted once inside the auth gate, outside all authenticated routes. */
export function HomeNavigation() {
  const { pathname } = useLocation()
  if (pathname === '/dashboard' || pathname === '/') return null
  return <nav className="home-navigation" aria-label="主页导航 Home Navigation"><Link to="/dashboard">← 主页 Home</Link></nav>
}
