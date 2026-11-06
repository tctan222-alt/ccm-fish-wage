import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // App tests may exercise unmocked SDK paths. Never inherit production
    // defaults or a developer's .env identity, including on networked CI.
    // This Vitest-only environment does not alter the production build.
    env: {
      VITE_FIREBASE_API_KEY: 'demo-only-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'demo-ccm-app.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'demo-ccm-app',
      VITE_FIREBASE_STORAGE_BUCKET: 'demo-ccm-app.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
      VITE_FIREBASE_APP_ID: '1:000000000000:web:demo',
    },
    setupFiles: './src/test/setup.ts',
    // The Rules suite uses a separate Node/Emulator configuration. Retain the
    // normal dependency exclusion so browser tests never discover package tests.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/firestore.rules.test.ts'],
  },
})
