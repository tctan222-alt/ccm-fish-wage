import { useRef, useState, type FormEvent } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'

const messages: Record<string, string> = {
  'auth/invalid-email': '请输入有效的电邮地址。',
  'auth/wrong-password': '电邮或密码不正确。',
  'auth/invalid-credential': '电邮或密码不正确。',
  'auth/user-disabled': '此账号已停用，请联系管理员。',
  'auth/network-request-failed': '无法连接，请检查网络后重试。',
  'auth/too-many-requests': '登录尝试次数过多，请稍后再试。',
}

function friendlyError(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  return messages[code] ?? '登录失败，请检查资料后重试。'
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
      <h1>登录</h1>
      <p className="login-intro">请使用管理员账号进入 CCM Fishery。</p>
      <form onSubmit={submit}>
        <label>电邮<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>密码<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="sign-in" type="submit" disabled={submitting}>{submitting ? '登录中…' : '登录'}</button>
      </form>
    </section>
  </main>
}
