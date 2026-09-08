import { lazy, Suspense } from 'react'
import { signOut } from 'firebase/auth'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { auth } from './firebase'
import { LoginPage } from './pages/LoginPage'
import { BackButton } from './components/BackButton'

const FishHeadWagePage = lazy(() => import('./pages/FishHeadWagePage').then(module => ({ default: module.FishHeadWagePage })))
const WorkersPage = lazy(() => import('./pages/WorkersPage').then(module => ({ default: module.WorkersPage })))
const TodaySummaryPage = lazy(() => import('./pages/TodaySummaryPage').then(module => ({ default: module.TodaySummaryPage })))
const MonthlySummaryPage = lazy(() => import('./pages/MonthlySummaryPage').then(module => ({ default: module.MonthlySummaryPage })))
const WorkerStatementPage = lazy(() => import('./pages/WorkerStatementPage').then(module => ({ default: module.WorkerStatementPage })))
const MasterDataPage = lazy(() => import('./pages/MasterDataPage').then(module => ({ default: module.MasterDataPage })))
const PartnersPage = lazy(() => import('./pages/PartnersPage').then(module => ({ default: module.PartnersPage })))
const PurchasesPage = lazy(() => import('./pages/PurchasesPage').then(module => ({ default: module.PurchasesPage })))
const PurchaseReceiptPage = lazy(() => import('./pages/PurchaseReceiptPage').then(module => ({ default: module.PurchaseReceiptPage })))
const PurchaseMonthlyPage = lazy(() => import('./pages/PurchaseMonthlyPage').then(module => ({ default: module.PurchaseMonthlyPage })))
const VesselsPage = lazy(() => import('./pages/VesselsPage').then(module => ({ default: module.VesselsPage })))
const PurchaseCategoriesPage = lazy(() => import('./pages/PurchaseCategoriesPage').then(module => ({ default: module.PurchaseCategoriesPage })))
const VesselTripsPage = lazy(() => import('./pages/VesselTripsPage').then(module => ({ default: module.VesselTripsPage })))
const VesselTripPage = lazy(() => import('./pages/VesselTripPage').then(module => ({ default: module.VesselTripPage })))
const VesselWageTemplatesPage = lazy(() => import('./pages/VesselWageTemplatesPage').then(module => ({ default: module.VesselWageTemplatesPage })))
const WeighingEntryPage = lazy(() => import('./pages/WeighingEntryPage').then(module => ({ default: module.WeighingEntryPage })))
const WeighingSessionsPage = lazy(() => import('./pages/WeighingSessionsPage').then(module => ({ default: module.WeighingSessionsPage })))
const WeighingReviewPage = lazy(() => import('./pages/WeighingReviewPage').then(module => ({ default: module.WeighingReviewPage })))
const FishSpeciesPage = lazy(() => import('./pages/FishSpeciesPage').then(module => ({ default: module.FishSpeciesPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({ default: module.DashboardPage })))
const FishDepartmentPage = lazy(() => import('./pages/FishDepartmentPage').then(module => ({ default: module.FishDepartmentPage })))
const IceDepartmentPage = lazy(() => import('./pages/IceDepartmentPage').then(module => ({ default: module.IceDepartmentPage })))
const IceVesselPage = lazy(() => import('./pages/IceVesselPage').then(module => ({ default: module.IceVesselPage })))
const IceMonthlySettlementPage = lazy(() => import('./pages/IceMonthlySettlementPage').then(module => ({ default: module.IceMonthlySettlementPage })))
const CcmAdminPage = lazy(() => import('./pages/CcmAdminPage').then(module => ({ default: module.CcmAdminPage })))
const PurchaseWeighingPage = lazy(() => import('./pages/PurchaseWeighingPage').then(module => ({ default: module.PurchaseWeighingPage })))
const PurchaseSettlementPage = lazy(() => import('./pages/PurchaseSettlementPage').then(module => ({ default: module.PurchaseSettlementPage })))
const RetailSalesPage = lazy(() => import('./pages/RetailSalesPage').then(module => ({ default: module.RetailSalesPage })))
const RetailFishPage = lazy(() => import('./pages/RetailSalesPage').then(module => ({ default: module.RetailFishPage })))
const RetailHistoryPage = lazy(() => import('./pages/RetailSalesPage').then(module => ({ default: module.RetailHistoryPage })))
const RetailReceiptPage = lazy(() => import('./pages/RetailSalesPage').then(module => ({ default: module.RetailReceiptPage })))
const RetailEditPage = lazy(() => import('./pages/RetailSalesPage').then(module => ({ default: module.RetailEditPage })))

function LoadingScreen() {
  const retail = /^\/retail-sales(?:\/|$)/.test(window.location.pathname)
  return <main className="loading-screen" role="status"><strong>{retail ? '正在载入门市销售… Loading Retail Sales…' : '正在载入 CCM Fishery…'}</strong></main>
}

function SignOutButton() {
  const retail = /^\/retail-sales(?:\/|$)/.test(useLocation().pathname)
  return <button className="sign-out" type="button" data-navigation-leave onClick={() => void signOut(auth)}>{retail ? '退出登录 Sign Out' : '退出登录'}</button>
}

function AuthenticatedApp() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <LoginPage />

  return <BrowserRouter>
    <SignOutButton />
    <BackButton />
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/retail-sales" element={<RetailSalesPage />} />
        <Route path="/retail-sales/fish" element={<RetailFishPage />} />
        <Route path="/retail-sales/history" element={<RetailHistoryPage />} />
        <Route path="/retail-sales/history/:saleId" element={<RetailReceiptPage />} />
        <Route path="/retail-sales/history/:saleId/edit" element={<RetailEditPage />} />
        <Route path="/fish-department" element={<FishDepartmentPage />} />
        <Route path="/fish-head-purchase" element={<PurchaseWeighingPage productType="fish_head" />} />
        <Route path="/fish-meal-purchase" element={<PurchaseWeighingPage productType="fish_meal" />} />
        <Route path="/fish-head-settlement" element={<PurchaseSettlementPage productType="fish_head" />} />
        <Route path="/fish-head-settlement/:sessionId" element={<PurchaseSettlementPage productType="fish_head" />} />
        <Route path="/fish-meal-settlement" element={<PurchaseSettlementPage productType="fish_meal" />} />
        <Route path="/fish-meal-settlement/:sessionId" element={<PurchaseSettlementPage productType="fish_meal" />} />
        <Route path="/fish-head-wages" element={<FishHeadWagePage />} />
        <Route path="/daily" element={<TodaySummaryPage />} />
        <Route path="/ice-department" element={<IceDepartmentPage />} />
        <Route path="/ice-department/:vesselId" element={<IceVesselPage />} />
        <Route path="/ice-department/:vesselId/monthly" element={<IceMonthlySettlementPage />} />
        <Route path="/ccm-admin" element={<CcmAdminPage />} />
        <Route path="/today" element={<TodaySummaryPage />} />
        <Route path="/monthly" element={<MonthlySummaryPage />} />
        <Route path="/monthly/:monthKey/worker/:workerId/statement" element={<WorkerStatementPage />} />
        <Route path="/workers" element={<WorkersPage />} />
        <Route path="/master-data" element={<MasterDataPage />} />
        <Route path="/partners" element={<PartnersPage />} />
        <Route path="/purchases" element={<PurchasesPage />} />
        <Route path="/purchases/new" element={<PurchaseReceiptPage />} />
        <Route path="/purchases/monthly" element={<PurchaseMonthlyPage />} />
        <Route path="/purchases/:receiptId" element={<PurchaseReceiptPage />} />
        <Route path="/vessels" element={<VesselsPage />} />
        <Route path="/purchase-categories" element={<PurchaseCategoriesPage />} />
        <Route path="/vessel-trips" element={<VesselTripsPage />} />
        <Route path="/vessel-trips/new" element={<VesselTripPage />} />
        <Route path="/vessel-trips/:tripId" element={<VesselTripPage />} />
        <Route path="/vessel-wage-templates" element={<VesselWageTemplatesPage />} />
        <Route path="/weighing" element={<WeighingSessionsPage />} />
        <Route path="/weighing/new" element={<WeighingEntryPage />} />
        <Route path="/weighing/:sessionId" element={<WeighingEntryPage />} />
        <Route path="/weighing/:sessionId/review" element={<WeighingReviewPage />} />
        <Route path="/fish-species" element={<FishSpeciesPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  </BrowserRouter>
}

export default function App() {
  return <AuthProvider><AuthenticatedApp /></AuthProvider>
}
