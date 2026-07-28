# CCM Fishery ERP Roadmap

## Principle
Development priority:
1. Daily time saving
2. Error reduction
3. Cost visibility
4. Ease of use
5. Advanced automation

Do not start later modules before the current module works in real operations.

# Phase 0 — Foundation

Tasks:
- [x] Create GitHub repository
- [x] Create README.md
- [ ] Create SPEC.md
- [ ] Create CCM_CONTEXT.md
- [ ] Create ROADMAP.md
- [ ] Create CHANGELOG.md
- [ ] Create React + TypeScript project
- [ ] Configure Vite
- [ ] Configure ESLint
- [ ] Configure Prettier
- [ ] Configure Firebase project
- [ ] Configure Firebase Authentication
- [ ] Configure Firestore
- [ ] Configure environment variables
- [ ] Configure PWA manifest
- [ ] Configure deployment
- [ ] Confirm iPhone access

Exit criteria:
- Project runs locally
- Project deploys online
- iPhone opens the deployed site
- Secrets are not committed
- Documentation is committed

# Phase 1 — Fish Head Cutting Wage MVP

## Sprint 1.1 — Basic Entry
- [ ] Worker buttons
- [ ] RM0.12 button
- [ ] RM0.15 button
- [ ] RM0.18 button
- [ ] Custom rate button
- [ ] Large keypad
- [ ] Confirm entry
- [ ] Automatic wage calculation
- [ ] Reset weight after confirm
- [ ] Keep worker selected
- [ ] Keep rate selected
- [ ] Success feedback

Acceptance:
- One basket entry under 3 seconds
- Accurate calculation
- Proper iPhone operation

## Sprint 1.2 — Worker Management
- [ ] Add worker
- [ ] Rename worker
- [ ] Disable worker
- [ ] Reorder workers
- [ ] Active/inactive status
- [ ] Maximum 20 active workers

## Sprint 1.3 — Custom Rate
- [ ] Enter custom rate
- [ ] Validate rate
- [ ] Save rate per entry
- [ ] Show recent custom rates
- [ ] Reuse recent rate
- [ ] Dynamic rate breakdown

## Sprint 1.4 — Daily Summary
- [ ] Current worker basket count
- [ ] Current worker total weight
- [ ] Current worker rate breakdown
- [ ] Current worker total wage
- [ ] All-worker summary
- [ ] Total workers
- [ ] Total baskets
- [ ] Total weight
- [ ] Total wages

## Sprint 1.5 — Records and Corrections
- [ ] Record list
- [ ] Date filter
- [ ] Worker filter
- [ ] Edit entry
- [ ] Soft delete entry
- [ ] Undo latest entry
- [ ] Duplicate warning
- [ ] Audit log

## Sprint 1.6 — Firebase and Offline
- [ ] Firebase Authentication
- [ ] Firestore persistence
- [ ] Local offline queue
- [ ] Auto sync
- [ ] Offline indicator
- [ ] Unsynced warning

## Sprint 1.7 — Export and PWA
- [ ] Daily CSV export
- [ ] Worker summary export
- [ ] Department summary export
- [ ] PWA manifest
- [ ] iPhone home-screen install
- [ ] App icon
- [ ] Standalone display
- [ ] Service worker
- [ ] Offline app shell

# Phase 1 Pilot Test

Duration:
- Minimum 3 working days
- Preferred 7 working days

Measure:
- Average entry time
- Incorrect entries
- Corrections
- Missing baskets
- Difference versus manual cards
- End-of-day calculation time
- iPhone usability

Exit criteria:
- Totals match manual verification
- Entry averages 3 seconds or less
- No data loss
- CSV works
- Owner accepts system for real use

# Phase 2 — Fish Head Production
- [ ] Fish Head weight entry
- [ ] Fish Fry weight entry
- [ ] Date
- [ ] Vessel source
- [ ] Bill number
- [ ] Daily totals
- [ ] Keep Fish Head and Fish Fry separate
- [ ] Edit
- [ ] Delete
- [ ] Audit log
- [ ] CSV export

# Phase 3 — Purchased Ice
- [ ] Ice purchase entry
- [ ] Supplier
- [ ] Quantity and unit
- [ ] Unit cost
- [ ] Total cost
- [ ] Allocation to Fish Head Department
- [ ] Allocation to vessel when applicable
- [ ] Other usage
- [ ] Usage history
- [ ] Reports

# Phase 4 — Vessel Operations
- [ ] Vessel master data
- [ ] Trip records
- [ ] Captain wages
- [ ] Crew wages
- [ ] Diesel
- [ ] Repairs
- [ ] Food
- [ ] Fishing equipment
- [ ] Occasional ice
- [ ] Trip profit
- [ ] Vessel reports

# Phase 5 — Monthly Settlement and Reports
- [ ] Monthly summaries
- [ ] PDF export
- [ ] Customer settlement
- [ ] Vessel settlement
- [ ] Department summaries
- [ ] Management dashboard

# Phase 6 — OCR and Automation
- [ ] Handwritten fish-record photo upload
- [ ] OCR extraction
- [ ] Human confirmation
- [ ] Fish Head/Fish Fry totals
- [ ] Vessel and date recognition
- [ ] Duplicate detection
- [ ] Google Sheets sync

# Current Priority
Only Phase 0 and Phase 1 are active.

Do not start vessel, OCR, or accounting modules before Fish Head Cutting Wage is stable in daily use.
