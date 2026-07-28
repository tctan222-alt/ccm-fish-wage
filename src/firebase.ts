import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
const configuredValues = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
}

export const firebaseConfigured = Object.values(configuredValues).every(Boolean)

// Firebase services still need an app during local builds and tests. These inert
// placeholders are never presented as production credentials.
const config = firebaseConfigured
  ? configuredValues
  : {
      apiKey: 'not-configured',
      authDomain: 'not-configured.invalid',
      projectId: 'not-configured',
    }
export const firebaseApp=initializeApp(config)
export const db=getFirestore(firebaseApp)
export const auth=getAuth(firebaseApp)
