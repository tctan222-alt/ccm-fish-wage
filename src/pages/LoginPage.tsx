import { useRef, useState, type FormEvent } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'

const messages: Record<string, string> = {
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/wrong-password': 'The email or password is incorrect.',
  'auth/invalid-credential': 'The email or password is incorrect.',
  'auth/user-disabled': 'This account has been disabled. Contact the administrator.',
  'auth/network-request-failed': 'Could not connect. Check your internet connection and try again.',
  'auth/too-many-requests': 'Too many sign-in attempts. Wait a while and try again.',
}

function friendlyError(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  return messages[code] ?? 'Sign in failed. Check your details and try again.'
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true
    setSubmitting(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (reason) {
      setError(friendlyError(reason))
    } finally {
      lock.current = false
      setSubmitting(false)
    }
  }

  return <main className="login-shell">
    <section className="login-card">
      <p className="eyebrow">CCM Fishery</p>
      <h1>Sign in</h1>
      <p className="login-intro">Use your administrator account to access wage records.</p>
      <form onSubmit={submit}>
        <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="sign-in" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign In'}</button>
      </form>
    </section>
  </main>
}
