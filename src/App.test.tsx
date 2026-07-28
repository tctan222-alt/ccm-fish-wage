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
  expect(screen.getByRole('status')).toHaveTextContent('Loading CCM Fishery')
  firebase.authState?.(null)
  return screen.findByRole('heading', { name: 'Sign in' })
}

describe('authentication gate', () => {
  it('shows login when unauthenticated and does not load wage services', async () => {
    await showLogin()
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(firebase.wageScreen).not.toHaveBeenCalled()
  })

  it('shows the application when authenticated', async () => {
    render(<App />)
    firebase.authState?.({ uid: 'admin' } as User)
    expect(await screen.findByRole('heading', { name: 'Fish Head Wage' })).toBeInTheDocument()
  })

  it('signs in with the entered credentials', async () => {
    firebase.signIn.mockResolvedValue({})
    await showLogin()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' admin@example.test ' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    await waitFor(() => expect(firebase.signIn).toHaveBeenCalledWith({}, 'admin@example.test', 'test-password'))
  })

  it('displays a friendly invalid-credential message without a raw code', async () => {
    firebase.signIn.mockRejectedValue({ code: 'auth/invalid-credential' })
    await showLogin()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is incorrect.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('auth/')
  })

  it('locks the button and prevents repeated submissions', async () => {
    let resolve = () => {}
    firebase.signIn.mockImplementation(() => new Promise(done => { resolve = () => done({}) }))
    await showLogin()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } })
    const button = screen.getByRole('button', { name: 'Sign In' })
    fireEvent.click(button); fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
    expect(firebase.signIn).toHaveBeenCalledOnce()
    resolve()
  })

  it('signs out', async () => {
    render(<App />)
    firebase.authState?.({ uid: 'admin' } as User)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign Out' }))
    expect(firebase.signOut).toHaveBeenCalledWith({})
  })
})
