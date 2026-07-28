# CCM Fishery Business Context

## 1. Purpose
This document defines CCM's actual business rules.

All developers and Codex tasks must read this before changing the system.

When a technical assumption conflicts with this document, this document takes priority.

## 2. Company Scope
This system is only for CCM Fishery.

Do not include:
- Jinda Sdn Bhd
- Monkey Fitness
- Personal finance
- Other unrelated businesses

## 3. Main Operational Areas
Current known areas:
- Fish Head Department
- Fish handling and receiving
- Vessel operations
- Office and settlement
- Purchased ice usage

These areas must remain separate.

## 4. Fish Head Department
Current activities:
- Fish-head cutting
- Fish-head weight recording
- Fish-fry weight recording
- Fish-head cutting labor
- Future fish-head sales
- Future fish-fry sales

The Fish Head Department may later be treated as a separate profit center.

## 5. Fish-Head Cutting Wage
Fish-head cutting wage belongs only to the Fish Head Department.

It is not:
- Vessel captain salary
- Vessel crew salary
- Office salary
- General payroll

Current fixed rates:
- RM0.12/kg
- RM0.15/kg
- RM0.18/kg

The system must also support a custom rate.

Correct formula:

`Weight × Rate`

Do not calculate by basket count alone.

## 6. Custom Rate
- Custom rate must be stored on each entry.
- Historical entries retain their original rate.
- Changing defaults must not alter old records.
- Recently used custom rates may be shown for convenience.

## 7. Vessel Labor
Captain and crew wages belong to vessel operations and are vessel expenses.

They must be designed separately and linked to vessel and trip.

Examples of vessel numbers:
- 978
- 833
- 2031
- 5202
- 4818
- 1785
- 2072
- 9633

Never mix vessel labor with fish-head cutting wages.

## 8. Vessel Expenses
May include:
- Captain wage
- Crew wage
- Diesel
- Repairs
- Fishing equipment
- Food
- Occasional ice usage
- Other trip expenses

Associate with a specific vessel whenever possible.

## 9. Ice
CCM does not produce ice.

Ice is fully outsourced and purchased from external suppliers.

Therefore:
- No ice-production department
- No ice manufacturing cost
- No ice factory labor

Main use:
- Fish Head Department uses most ice
- Vessels occasionally take some
- Other fishery operations may use some

Only ice actually used by a vessel belongs to vessel cost.

## 10. Fish Head and Fish Fry
Fish Head and Fish Fry are separate categories.

Example:
- Fish Head: 699kg
- Fish Fry: 2,395kg

Never combine them into one product category.

## 11. Handwritten Records
Known structure:
- Bill number at top
- Vessel number on right
- Date on left
- Red numbers for unit prices
- Black writing for fish name and kilograms
- Red calculation under weight

Future OCR must follow CCM's real paper layout.

## 12. Typical Daily Workload
- 8 to 10 workers
- Around 10 baskets per worker per day
- Around 80 to 100 entries per day

The interface must prioritize speed and error reduction.

## 13. Basket Entry Rule
Each basket is one separate event.

Each entry stores:
- Worker
- Weight
- Rate
- Wage
- Date
- Time

Do not assume equal basket weight.

## 14. Historical Integrity
Historical records must never change automatically.

Example:
If RM0.12 later becomes RM0.13, old records stay at RM0.12.

## 15. Mobile-First Rule
Primary use is on iPhone.

Design for:
- One-hand use
- Large buttons
- Wet hands
- Bright environment
- Fast repeated entry
- Minimal typing

Desktop is mainly for administration, reports, and development.

## 16. Three-Second Rule
After worker selection, normal repeated entry should take no more than 3 seconds.

Worker and rate remain selected until changed.

## 17. Data Priority
1. Correct worker
2. Correct rate
3. Correct weight
4. Fast confirmation
5. Immediate feedback

## 18. System Boundaries
Never merge:
- Fish-head cutting worker ≠ Vessel captain
- Fish-head cutting wage ≠ Vessel crew wage
- Fish Head Department cost ≠ Vessel expense
- Purchased ice ≠ Ice production
- Fish Head ≠ Fish Fry
- CCM ≠ Jinda
- CCM ≠ Monkey Fitness

## 19. Accounting Boundary
V1 is an operational wage-recording system.

Do not add accounting, tax, SST, e-Invoice, EPF, SOCSO, or payroll statutory calculations unless separately specified later.

## 20. Source of Truth
Priority:
1. Latest confirmed rule from CCM owner
2. CCM_CONTEXT.md
3. SPEC.md
4. Existing application behavior
5. Generic industry assumptions
