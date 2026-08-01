import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function fallbackFor(pathname:string) {
  if (pathname.startsWith('/fish-head-purchase') || pathname.startsWith('/fish-meal-purchase') || pathname.startsWith('/fish-head-wages') || pathname.startsWith('/daily') || pathname.startsWith('/monthly')) return '/fish-department'
  if (pathname === '/ice-department') return '/dashboard'
  if (pathname.startsWith('/ice-department/')) return '/ice-department'
  return '/dashboard'
}

export function BackButton({ whenDirty }: { whenDirty?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [detectedDirty,setDetectedDirty]=useState(false)
  const dirty=whenDirty??detectedDirty
  const historyIndex=useRef<number|null>(null)
  const revertingPop=useRef(false)
  const revertToLocationKey=useRef<string|null>(null)
  const previousLocationKey=useRef(location.key)
  useEffect(()=>{
    if(revertingPop.current){
      if(revertToLocationKey.current===location.key){
        revertingPop.current=false
        revertToLocationKey.current=null
        previousLocationKey.current=location.key
      }
      return
    }
    if(previousLocationKey.current===location.key)return
    previousLocationKey.current=location.key
    if(whenDirty===undefined)setDetectedDirty(false)
  },[location.key,whenDirty])
  useEffect(()=>{
    const index=typeof window.history.state?.idx==='number'?window.history.state.idx:null
    if(index!==null)historyIndex.current=index
  },[location.key])
  useEffect(()=>{
    const markDirty=(event:Event)=>{
      const target=event.target
      if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target instanceof HTMLSelectElement)setDetectedDirty(true)
    }
    const clearDirty=()=>setDetectedDirty(false)
    const warnBeforeUnload=(event:BeforeUnloadEvent)=>{
      if(!dirty)return
      event.preventDefault()
      event.returnValue=''
    }
    const guardNavigation=(event:MouseEvent)=>{
      if(!dirty||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return
      const target=event.target
      if(!(target instanceof Element))return
      const link=target.closest('a[href]')
      const leavesByButton=target.closest('[data-navigation-leave]')
      if(!link&&!leavesByButton)return
      if(link&&link instanceof HTMLAnchorElement&&link.target&&link.target!=='_self')return
      if(!window.confirm('还有未保存的资料，确定离开吗？')){
        event.preventDefault();event.stopPropagation();return
      }
      setDetectedDirty(false)
    }
    const guardPopState=(event:PopStateEvent)=>{
      const nextIndex=typeof event.state?.idx==='number'?event.state.idx:null
      if(revertingPop.current){historyIndex.current=nextIndex;return}
      if(!dirty||nextIndex===null||historyIndex.current===null){historyIndex.current=nextIndex;return}
      if(window.confirm('还有未保存的资料，确定离开吗？')){setDetectedDirty(false);historyIndex.current=nextIndex;return}
      const delta=historyIndex.current-nextIndex
      if(delta!==0){revertingPop.current=true;revertToLocationKey.current=previousLocationKey.current;window.history.go(delta)}
    }
    document.addEventListener('input',markDirty,true)
    document.addEventListener('change',markDirty,true)
    document.addEventListener('click',guardNavigation,true)
    window.addEventListener('ccm:form-saved',clearDirty)
    window.addEventListener('beforeunload',warnBeforeUnload)
    window.addEventListener('popstate',guardPopState)
    return ()=>{
      document.removeEventListener('input',markDirty,true)
      document.removeEventListener('change',markDirty,true)
      document.removeEventListener('click',guardNavigation,true)
      window.removeEventListener('ccm:form-saved',clearDirty)
      window.removeEventListener('beforeunload',warnBeforeUnload)
      window.removeEventListener('popstate',guardPopState)
    }
  },[dirty])
  function goBack() {
    if (dirty && !window.confirm('还有未保存的资料，确定离开吗？')) return
    const index = typeof window.history.state?.idx === 'number' ? window.history.state.idx : 0
    if (index > 0) navigate(-1)
    else navigate(fallbackFor(location.pathname))
  }
  return <button type="button" className="back-button" aria-label="返回" onClick={goBack}>← 返回</button>
}
