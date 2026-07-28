# CCM Fishery ERP

Internal ERP system for Chin Chua Meng Fishery (CCM).

## Tech Stack

- React
- TypeScript
- Firebase
- Firestore
- Firebase Authentication (Email/Password)
- Firebase Hosting (prepared; owner deployment required)

## Platform

- iPhone First
- Desktop for Administration

## Local setup

Use Node.js 20 and run `npm install`. The production Firebase project is
`ccm-fishery-os-4490d`; its public Web client values are documented in
`.env.example` and built-in defaults keep production builds from failing when an
environment file is absent. Individual Fish Head Cutting Wage records are stored
in the canonical `fishHeadWageEntries` collection.

The application requires an administrator account created out of band in Firebase
Authentication. It supports Email/Password sign-in and deliberately provides no
public registration or password-reset flow. Passwords, private keys, service-account
JSON, and Firebase Admin credentials must never be committed.

## Production preparation

`firebase.json` targets Vite's `dist` output and includes SPA rewrites and cache
headers. The reviewed Firestore rules deny unauthenticated access and hard deletes.
Neither configuration has been deployed: the owner must approve and deploy rules
and Hosting, and must enable Email/Password in the Firebase console first.

## Current Modules

- Fish Head Wage (v0.3 basket entry)

## Planned Modules

- Fish Head Production
- Fish Meal
- Dashboard
- Vessel
- Reports
