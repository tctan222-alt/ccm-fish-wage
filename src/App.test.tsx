import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'

const firebase = vi.hoisted(() => ({
  authState: null as null | ((user: User | null) => void),
  signIn: vi.fn(),
  signOut: vi.fn(),
  wageScreen: vi.fn(),
  settlementListScreen: vi.fn(),
  settlementDetailScreen: vi.fn(),
  sharedSettlementListScreen: vi.fn(),
}))

vi.mock('./firebase', () => ({ auth: {}, db: {}, firebaseConfigured: true }))
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth, callback: (user: User | null) => void) => { firebase.authState = callback; return vi.fn() }),
  signInWithEmailAndPassword: firebase.signIn,
  signOut: firebase.signOut,
}))
vi.mock('./pages/FishHeadWagePage', () => ({ FishHeadWagePage: () => { firebase.wageScreen(); return <h1>Fish Head Wage</h1> } }))
vi.mock('./pages/FishHeadSettlementListPage', () => ({ FishHeadSettlementListPage: () => { firebase.settlementListScreen(); return <h1>鱼头现场单列表</h1> } }))
vi.mock('./pages/SettlementListPage', () => ({ SettlementListPage: ({ productType }: { productType: string }) => { firebase.sharedSettlementListScreen(productType); return <h1>共享结单列表</h1> } }))
vi.mock('./pages/PurchaseSettlementPage', async () => {
  const { useParams } = await import('react-router-dom')
  return { PurchaseSettlementPage: ({ productType }: { productType: string }) => {
    const { sessionId } = useParams()
    firebase.settlementDetailScreen({ productType, sessionId })
    return <h1>结单详情 {sessionId}</h1>
  } }
})

import App from './App'

beforeEach(() => {
  firebase.authState = null
  firebase.signIn.mockReset()
  firebase.signOut.mockReset()
  firebase.wageScreen.mockReset()
  firebase.settlementListScreen.mockReset()
  firebase.settlementDetailScreen.mockReset()
  firebase.sharedSettlementListScreen.mockReset()
})
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/') })

async function showLogin() {
  render(<App />)
  expect(screen.getByRole('status')).toHaveTextContent('正在载入 CCM Fishery')
  firebase.authState?.(null)
  return screen.findByRole('heading', { name: '登录' })
}

describe('authentication gate', () => {
  it.each(['/fish-head-wages', '/fish-head-settlement', '/fish-head-settlement/session-B'])('shared Home returns from %s to the Dashboard without signing out', async path => {
    window.history.replaceState(null, '', path)
    render(<App />)
    firebase.authState?.({ uid: 'admin' } as User)
    fireEvent.click(await screen.findByRole('link', { name: '← 主页 Home' }))
    await screen.findByRole('heading', { name: 'CCM 首页' })
    expect(window.location.pathname).toBe('/dashboard')
    expect(firebase.signOut).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: '← 主页 Home' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument()
  })
  it('shows login when unauthenticated and does not load wage services', async () => {
    await showLogin()
    expect(screen.getByLabelText('电邮')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'password')
    expect(firebase.wageScreen).not.toHaveBeenCalled()
  })

  it('shows the dashboard when authenticated instead of opening fish-head wages', async () => {
    render(<App />)
    firebase.authState?.({ uid: 'admin' } as User)
    expect(await screen.findByRole('heading', { name: 'CCM 首页' })).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'返回'})).toBeInTheDocument()
    expect(firebase.wageScreen).not.toHaveBeenCalled()
  })

  it('signs in with the entered credentials', async () => {
    firebase.signIn.mockResolvedValue({})
    await showLogin()
    fireEvent.change(screen.getByLabelText('电邮'), { target: { value: ' admin@example.test ' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(firebase.signIn).toHaveBeenCalledWith({}, 'admin@example.test', 'test-password'))
  })

  it('displays a friendly invalid-credential message without a raw code', async () => {
    firebase.signIn.mockRejectedValue({ code: 'auth/invalid-credential' })
    await showLogin()
    fireEvent.change(screen.getByLabelText('电邮'), { target: { value: 'a@b.test' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('电邮或密码不正确。')
    expect(screen.getByRole('alert')).not.toHaveTextContent('auth/')
  })

  it('locks the button and prevents repeated submissions', async () => {
    let resolve = () => {}
    firebase.signIn.mockImplementation(() => new Promise(done => { resolve = () => done({}) }))
    await showLogin()
    fireEvent.change(screen.getByLabelText('电邮'), { target: { value: 'a@b.test' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } })
    const button = screen.getByRole('button', { name: '登录' })
    fireEvent.click(button); fireEvent.click(button)
    expect(screen.getByRole('button', { name: '登录中…' })).toBeDisabled()
    expect(firebase.signIn).toHaveBeenCalledOnce()
    resolve()
  })

  it('signs out', async () => {
    render(<App />)
    firebase.authState?.({ uid: 'admin' } as User)
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }))
    expect(firebase.signOut).toHaveBeenCalledWith({})
  })

  it('opens the fish-head list after auth initialization without loading a detail form', async () => {
    window.history.replaceState(null, '', '/fish-head-settlement')
    render(<App />)
    expect(firebase.settlementListScreen).not.toHaveBeenCalled()
    firebase.authState?.({ uid: 'admin' } as User)
    expect(await screen.findByRole('heading', { name: '鱼头现场单列表' })).toBeInTheDocument()
    expect(firebase.settlementDetailScreen).not.toHaveBeenCalled()
  })

  it('keeps the direct fish-head route connected to the existing detail with exact sessionId', async () => {
    window.history.replaceState(null, '', '/fish-head-settlement/session-B')
    render(<App />)
    firebase.authState?.({ uid: 'admin' } as User)
    await screen.findByRole('heading', { name: '结单详情 session-B' })
    expect(firebase.settlementDetailScreen).toHaveBeenCalledWith({ productType: 'fish_head', sessionId: 'session-B' })
    expect(firebase.settlementListScreen).not.toHaveBeenCalled()
  })

  it('opens the fish-meal base route as the shared list without fetching detail', async () => {
    window.history.replaceState(null, '', '/fish-meal-settlement')
    render(<App />)
    firebase.authState?.({ uid: 'admin' } as User)
    await screen.findByRole('heading', { name: '共享结单列表' })
    expect(firebase.sharedSettlementListScreen).toHaveBeenCalledWith('fish_meal')
    expect(firebase.settlementDetailScreen).not.toHaveBeenCalled()
    expect(firebase.settlementListScreen).not.toHaveBeenCalled()
  })
  it('preserves direct fish-meal detail identity and only loads detail after navigation', async () => {
    window.history.replaceState(null, '', '/fish-meal-settlement/meal-B')
    render(<App />); firebase.authState?.({ uid: 'admin' } as User)
    await screen.findByRole('heading', { name: '结单详情 meal-B' })
    expect(firebase.settlementDetailScreen).toHaveBeenCalledWith({ productType: 'fish_meal', sessionId: 'meal-B' })
    expect(firebase.sharedSettlementListScreen).not.toHaveBeenCalled()
  })
})
