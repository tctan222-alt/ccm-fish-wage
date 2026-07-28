import { lazy, Suspense } from 'react'
import { signOut } from 'firebase/auth'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { auth } from './firebase'
import { LoginPage } from './pages/LoginPage'

const FishHeadWagePage = lazy(() => import('./pages/FishHeadWagePage').then(module => ({ default: module.FishHeadWagePage })))
const WorkersPage = lazy(() => import('./pages/WorkersPage').then(module => ({ default: module.WorkersPage })))

function LoadingScreen() {
  return <main className="loading-screen" role="status"><strong>Loading CCM Fishery…</strong></main>
}

function AuthenticatedApp() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <LoginPage />

  return <BrowserRouter>
    <button className="sign-out" type="button" onClick={() => void signOut(auth)}>Sign Out</button>
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/" element={<FishHeadWagePage />} />
        <Route path="/workers" element={<WorkersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  </BrowserRouter>
}

export default function App() {
  return <AuthProvider><AuthenticatedApp /></AuthProvider>
}