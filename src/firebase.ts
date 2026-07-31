import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

const productionConfig = {
  apiKey: 'AIzaSyD-FWdApghgsJwyJZc0V5vRCbjHAU1TMok',
  authDomain: 'ccm-fishery-os-4490d.firebaseapp.com',
  projectId: 'ccm-fishery-os-4490d',
  storageBucket: 'ccm-fishery-os-4490d.firebasestorage.app',
  messagingSenderId: '484619840074',
  appId: '1:484619840074:web:d82c35bdc46244509754b3',
}

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || productionConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || productionConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || productionConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || productionConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || productionConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || productionConfig.appId,
}

export const firebaseConfigured = Object.values(config).every(Boolean)
export const app = getApps().length === 0 ? initializeApp(config) : getApp()
export const firebaseApp = app
export const auth = getAuth(app)
export const db = getFirestore(app)
export const cloudFunctions = getFunctions(app, 'asia-southeast1')
