import { describe, expect, it } from 'vitest'
import { app, auth, db } from './firebase'

describe('application test Firebase isolation', () => {
  it('binds even unmocked SDK paths to the complete demo-only identity', () => {
    expect(app.options).toEqual({
      apiKey: 'demo-only-api-key',
      authDomain: 'demo-ccm-app.firebaseapp.com',
      projectId: 'demo-ccm-app',
      storageBucket: 'demo-ccm-app.appspot.com',
      messagingSenderId: '000000000000',
      appId: '1:000000000000:web:demo',
    })
    expect(auth.app).toBe(app)
    expect(db.app).toBe(app)
  })
})
