# ERP Architecture

CCM Fishery ERP is an internal React, TypeScript, Vite, Firebase, Firestore, Firebase Authentication, and Firebase Hosting application for fishery operations.

## Current product shape

- iPhone-first operational entry screens.
- Desktop-friendly administration screens.
- Firebase client SDK for browser access.
- Firestore as the application data store.
- Email/Password authentication for administrator access.
- Firebase Hosting prepared for the Vite single-page application.

## Current modules

- Fish Head Wage.
- Worker management.
- Fish purchasing and weighing.
- Purchase settlement and monthly summaries.
- Ice department workflows.
- Vessel and trip workflows.
- Master data screens.

## Architecture principles

- Keep domain calculations in testable library modules.
- Keep Firestore service modules responsible for persistence details.
- Keep page components focused on workflow and presentation.
- Keep Firebase initialization centralized in the existing Firebase module.
- Keep production deployment as an owner-controlled action.

## Data and access model

The current MVP is a single-admin operating model. Authenticated users may use operational data according to Firestore rules, while unauthenticated access must remain denied. Hard deletion of operational records should stay prohibited unless an explicit owner-approved retention policy changes that rule.

## Change-control notes

Architecture documentation can describe the intended system, but implementation changes must still be made in code, tests, and rules in a separate scoped task. Docs-only PRs must not modify runtime behavior.
