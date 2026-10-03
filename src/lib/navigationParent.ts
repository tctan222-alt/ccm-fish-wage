export function fallbackFor(pathname: string) {
  const parts = pathname.split('/').filter(Boolean)
  const [module, id, child] = parts
  if (module === 'retail-sales') {
    if (id === 'history' && parts.length > 3) return `/retail-sales/history/${child}`
    if (id === 'history' && child) return '/retail-sales/history'
    if (id) return '/retail-sales'
  }
  if (module === 'fish-head-settlement' || module === 'fish-meal-settlement') return id ? `/${module}` : '/fish-department'
  if (module === 'monthly' && id) return '/monthly'
  if (['fish-head-purchase', 'fish-meal-purchase', 'fish-head-wages', 'daily', 'today', 'monthly'].includes(module)) return '/fish-department'
  if (module === 'ice-department') return child ? `/ice-department/${id}` : id ? '/ice-department' : '/dashboard'
  if (module === 'weighing') return child === 'review' ? `/weighing/${id}` : id ? '/weighing' : '/fish-department'
  if (module === 'purchases') return id ? '/purchases' : '/ccm-admin'
  if (module === 'vessel-trips') return id ? '/vessel-trips' : '/ccm-admin'
  if (module === 'vessel-wage-templates') return '/vessel-trips'
  if (['workers', 'partners', 'vessels', 'purchase-categories', 'fish-species'].includes(module) || (module === 'master-data' && id)) return '/master-data'
  return '/dashboard'
}
