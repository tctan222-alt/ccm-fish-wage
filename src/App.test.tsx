import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'

const firebase = vi.hoisted(() => ({
  authState: null as null | ((user: User | null) => void),
  signIn: vi.fn(),
  signOut: vi.fn(),
  wageScreen: vi.fn(),
}))

vi.mock('./firebase', () => ({ auth: {}, db: {}, firebaseConfigured: true }))
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth, callback: (user: User | null) => void) => { firebase.authState = callback; return vi.fn() }),
  signInWithEmailAndPassword: firebase.signIn,
  signOut: firebase.signOut,
}))
vi.mock('./pages/FishHeadWagePage', () => ({ FishHeadWagePage: () => { firebase.wageScreen(); return <h1>Fish Head Wage</h1> } }))

import App from './App'

beforeEach(() => {
  firebase.authState = null
  firebase.signIn.mockReset()
  firebase.signOut.mockReset()
  firebase.wageScreen.mockReset()
})
afterEach(cleanup)

async function showLogin() {
  render(<App />)
  expect(screen.getByRole('status')).toHaveTextContent('正在载入 CCM Fishery')
  firebase.authState?.(null)
  return screen.findByRole('heading', { name: '登录' })
}

describe('authentication gate', () => {
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
})
