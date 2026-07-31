import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-ccm-functions'
const app = getApps()[0] ?? initializeApp({ projectId })
const auth = getAuth(app), db = getFirestore(app)
const callableUrl = `http://127.0.0.1:5001/${projectId}/asia-southeast1/rebuildIceWorkMonthlySettlement`
const input = { vesselId: 'v978', monthSortKey: 202607, clientOperationId: 'emulator-operation-001' }
const record = {
  vesselId: 'v978', monthKey: '07/2026', monthSortKey: 202607, status: 'confirmed', voided: false, revision: 2, confirmedAt: Timestamp.fromMillis(1_700_000_000_000),
  factoryIncomingWeightGrams: 1_000, factoryIncomingRateCentsPerKg: 10, factoryIncomingAmountCents: 10,
  iceBoxHalfUnits: 2, iceBoxRateCentsPerHalfUnit: 1_500, iceBoxAmountCents: 3_000,
  dieselVolumeMilliliters: 1_000, dieselRateCentsPerLiter: 2, dieselAmountCents: 2,
  hawkerSaleWeightGrams: 1_000, hawkerSaleRateCentsPerKg: 30, hawkerSaleAmountCents: 30,
  directIceBarCount: 1, directIceRateCentsPerBar: 1_350, directIceAmountCents: 1_350,
  plasticBagCount: 1, plasticBagRateCentsEach: 140, plasticBagAmountCents: 140,
  workFeeSubtotalCents: 3_042, materialSubtotalCents: 1_490, recordTotalCents: 4_532,
}
let adminToken = ''
let ordinaryToken = ''
async function call(data: Record<string, unknown>, token?: string) {
  return fetch(callableUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data }) })
}

beforeAll(async () => {
  const email = 'ice-admin@example.test', password = 'LocalOnly123!'
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })
  const user = await auth.getUserByEmail(email)
  await auth.setCustomUserClaims(user.uid, { ccmAdmin: true })
  const signIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })
  adminToken = String((await signIn.json() as { idToken: string }).idToken)
  const ordinary = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ordinary@example.test', password, returnSecureToken: true }) })
  ordinaryToken = String((await ordinary.json() as { idToken: string }).idToken)
  await db.doc('vessels/v978').set({ vesselCode: '978', active: true })
  await db.doc('iceWorkRecords/valid').set(record)
})
afterAll(async () => { await deleteApp(app) })

describe('ice work callable emulator', () => {
  it('rejects an unauthenticated caller', async () => { expect((await call(input)).status).toBe(401) })
  it('rejects an authenticated caller without the explicit settlement claim', async () => { expect((await call({ ...input, clientOperationId: 'emulator-operation-ordinary' }, ordinaryToken)).status).toBe(403) })
  it('creates a trusted draft from Firestore records for an authorized caller', async () => {
    const response = await call(input, adminToken)
    expect(response.status).toBe(200)
    expect((await db.doc('iceWorkMonthlySettlements/v978_202607').get()).data()?.finalTotalCents).toBe(79_532)
  })
  it('is idempotent for the same client operation id', async () => {
    const before = (await db.doc('iceWorkMonthlySettlements/v978_202607').get()).data()?.revision
    expect((await call(input, adminToken)).status).toBe(200)
    expect((await db.doc('iceWorkMonthlySettlements/v978_202607').get()).data()?.revision).toBe(before)
    expect((await db.collection('iceWorkMonthlySettlements/v978_202607/actions').get()).size).toBe(1)
  })
})
