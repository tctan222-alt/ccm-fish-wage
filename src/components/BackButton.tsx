import { useContext, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DirtyStateContext } from './dirtyState'
import { fallbackFor } from '../lib/navigationParent'

export function BackButton({ whenDirty }: { whenDirty?: boolean }) {
  const navigate = useNavigate(), location = useLocation()
  const registered = useContext(DirtyStateContext)
  const dirty = whenDirty ?? registered?.dirty ?? false
  const retail = /^\/retail-sales(?:\/|$)/.test(location.pathname)
  const leaveMessage = '还有未保存的资料，确定离开吗？ You have unsaved changes. Leave this page?'
  const historyIndex = useRef<number | null>(null), restoring = useRef(false), approved = useRef(false)
  useEffect(() => {
    historyIndex.current = typeof window.history.state?.idx === 'number' ? window.history.state.idx : null
    approved.current = false
  }, [location.key, dirty])
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || approved.current) return
      event.preventDefault(); event.returnValue = ''
    }
    const guardNavigation = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href]'), leavesByButton = target.closest('[data-navigation-leave]')
      if (!link && !leavesByButton) return
      if (link instanceof HTMLAnchorElement && ((link.target && link.target !== '_self') || link.hasAttribute('download'))) return
      if (!window.confirm(leaveMessage)) { event.preventDefault(); event.stopPropagation(); return }
      // Router links and async Logout may leave the current form mounted. Only
      // a native document navigation consumes the subsequent beforeunload warning.
      approved.current = link instanceof HTMLAnchorElement && !link.hasAttribute('data-discover')
    }
    const guardPopState = (event: PopStateEvent) => {
      const nextIndex = typeof event.state?.idx === 'number' ? event.state.idx : null
      // Capture before BrowserRouter's listener, so cancelling never unmounts the draft.
      if (restoring.current) { restoring.current = false; event.stopImmediatePropagation(); return }
      if (!dirty || approved.current || nextIndex === null || historyIndex.current === null) { historyIndex.current = nextIndex; approved.current = false; return }
      if (window.confirm(leaveMessage)) { historyIndex.current = nextIndex; return }
      const delta = historyIndex.current - nextIndex
      if (delta !== 0) { event.stopImmediatePropagation(); restoring.current = true; window.history.go(delta) }
    }
    document.addEventListener('click', guardNavigation, true)
    window.addEventListener('beforeunload', warnBeforeUnload)
    window.addEventListener('popstate', guardPopState, true)
    return () => {
      document.removeEventListener('click', guardNavigation, true)
      window.removeEventListener('beforeunload', warnBeforeUnload)
      window.removeEventListener('popstate', guardPopState, true)
    }
  }, [dirty, leaveMessage])
  function goBack() {
    if (dirty && !window.confirm(leaveMessage)) return
    approved.current = true
    const index = typeof window.history.state?.idx === 'number' ? window.history.state.idx : 0
    if (index > 0) navigate(-1)
    else navigate(fallbackFor(location.pathname))
  }
  return <button type="button" className="back-button" aria-label={retail ? '返回 Back' : '返回'} onClick={goBack}>← {retail ? '返回 Back' : '返回'}</button>
}
