import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // The Rules suite uses a separate Node/Emulator configuration. Retain the
    // normal dependency exclusion so browser tests never discover package tests.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/firestore.rules.test.ts', 'functions/**'],
  },
})
