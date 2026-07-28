[SPEC.md](https://github.com/user-attachments/files/30458534/SPEC.md)
# CCM Fishery ERP — Product Specification

## 1. Purpose
CCM Fishery ERP is an internal operations system for Chin Chua Meng Fishery.

V1 focuses only on the Fish Head Department's fish-head cutting wages.

This is not a generic payroll system, vessel payroll system, accounting system, or tax system.

## 2. V1 Scope

Included:
- iPhone-first PWA
- Worker management
- Fish-head cutting wage entry
- Weight entry by basket
- Fixed rates: RM0.12/kg, RM0.15/kg, RM0.18/kg
- Custom rate option
- Recently used custom rates
- Daily worker totals
- Daily department totals
- Entry history
- Undo latest entry
- Edit and soft-delete entries
- Duplicate warning
- Audit log
- CSV export
- Firebase Authentication
- Cloud Firestore persistence
- Temporary offline entry and later sync

Excluded from V1:
- Vessel captain wages
- Vessel crew wages
- Vessel expenses
- Fish-head and fish-fry sales
- Ice purchase allocation
- OCR
- Google Sheets sync
- PDF monthly settlement
- Accounting, tax, SST, e-Invoice
- Jinda
- Monkey Fitness

## 3. Primary Device and User
Primary user: CCM owner or manager.

Primary device: iPhone.

Secondary device: Windows PC for administration and development.

The app must be usable one-handed and must prioritize speed over decoration.

## 4. Core Performance Goal
After a worker and rate are selected, one basket entry must normally be completed within 3 seconds.

Repeated flow:
1. Enter weight.
2. Tap Confirm.
3. Weight resets.
4. Worker and rate remain selected.
5. Enter next basket.

## 5. Main Navigation
V1 pages:
- Dashboard
- Fish Head Wage
- Records
- Settings

## 6. Dashboard
Show today's:
- Date
- Number of workers with entries
- Total baskets
- Total weight
- Total wages
- Recent entries
- Shortcut to Fish Head Wage entry

Do not show vessel information in V1.

## 7. Fish Head Wage Entry Page

### 7.1 Worker Selection
- Large buttons
- Minimum height 64px
- Selected worker must be visually obvious
- Selection remains active until changed
- Maximum 20 active workers

### 7.2 Rate Selection
Always show:
- RM0.12
- RM0.15
- RM0.18
- Custom

The selected rate remains active until changed.

### 7.3 Custom Rate
Rules:
- Minimum RM0.01
- Maximum RM9.99
- Maximum 2 decimal places
- Save rate on each entry
- Historical records never change when default rates change
- Show recent custom rates for one-tap reuse

### 7.4 Weight Input
Use an on-screen keypad.

Rules:
- Whole kilograms only in V1
- Minimum 1kg
- Maximum 300kg
- Large Confirm button
- Reset input after successful save

### 7.5 Entry Calculation
Formula:

`Wage = WeightKg × RateRm`

Each saved entry must contain:
- dateKey
- workerId
- workerName snapshot
- weightKg
- rateRm
- wageRm
- createdBy
- createdAt
- updatedAt
- deleted

### 7.6 Success Feedback
After a successful save:
- Show short confirmation
- Vibrate if supported
- Clear weight input
- Keep worker and rate selected

## 8. Current Worker Summary
Show:
- Worker name
- Basket count
- Total weight
- Dynamic weight breakdown by actual rates used
- Total wage

Unused rates should not occupy space.

## 9. Daily Department Summary
For each worker show:
- Name
- Basket count
- Total weight
- Total wage

Department totals:
- Total workers
- Total baskets
- Total weight
- Total wages

## 10. Records Page
Show entries for a selected date.

Each row:
- Time
- Worker
- Weight
- Rate
- Wage

Functions:
- Filter by date
- Filter by worker
- Sort newest first
- Edit
- Soft delete
- View audit information

## 11. Undo, Edit, Delete

### Undo
- Large button on entry page
- Applies to latest active entry created by current user
- Show confirmation details before undo

### Edit
Editable fields:
- Worker
- Weight
- Rate

After edit:
- Recalculate wage
- Update updatedAt
- Write audit log

### Delete
Use soft delete:
- deleted: true
- deletedAt
- deletedBy

Deleted entries must not appear in normal totals.

## 12. Worker Settings
Functions:
- Add worker
- Rename worker
- Disable worker
- Reorder workers

Workers with historical records must not be hard-deleted.

## 13. Duplicate Protection
If the same worker, weight, and rate are entered within 5 seconds, show:

`Possible duplicate entry. Continue?`

Do not automatically block because repeated weights can be valid.

## 14. CSV Export
Daily detail columns:
- Date
- Time
- Worker
- WeightKg
- RateRM
- WageRM
- CreatedBy
- CreatedAt
- UpdatedAt

Include worker summary and department summary.

Filename:

`CCM_Fish_Head_Wage_YYYY-MM-DD.csv`

## 15. Authentication and Roles
V1 can start with Owner only.

Future roles:
- Owner
- Manager
- Clerk
- View only

Authentication is required before writing to Firestore.

## 16. Audit Log
Track CREATE, UPDATE, DELETE, RESTORE.

Fields:
- action
- entityType
- entityId
- beforeData
- afterData
- userId
- timestamp

## 17. Suggested Firestore Collections
- users
- workers
- wageRates
- fishHeadWageEntries
- auditLogs
- appSettings

## 18. Offline Behavior
When offline:
- Allow temporary entry creation
- Queue locally
- Show offline status
- Sync when connection returns
- Warn if unsynced records remain

## 19. Technical Stack
Frontend:
- React
- TypeScript
- Vite
- Responsive CSS
- PWA

Backend:
- Firebase Authentication
- Cloud Firestore
- Vercel or Firebase Hosting

Development:
- GitHub
- Environment variables
- ESLint
- Prettier
- No secrets committed to GitHub

## 20. PWA Requirements
- Installable on iPhone home screen
- App name: CCM Fishery
- Short name: CCM
- Standalone display
- App icons
- Theme color
- Cached app shell
- Offline status indicator

## 21. UI Rules
Priority:
1. Speed
2. Accuracy
3. Clear feedback
4. Minimum taps
5. Appearance

Requirements:
- Large touch targets
- High contrast
- No dropdowns for frequent actions
- Minimal scrolling
- No unnecessary animation
- Designed for bright and wet working conditions

## 22. V1 Acceptance Criteria
V1 is accepted when:
- Owner can log in on iPhone
- Workers can be added and managed
- RM0.12, RM0.15, RM0.18 work
- Custom rate works
- Basket weight can be entered
- Wage calculates correctly
- Entry saves to Firestore
- Temporary offline entry works
- Worker and department totals are correct
- Latest entry can be undone
- Entries can be edited and deleted
- CSV export works
- App installs to iPhone home screen
- Normal repeated entry can be completed within 3 seconds
