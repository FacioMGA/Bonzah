---
title: Staff leave calendar
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-19
binding: false
---

# Staff leave calendar

Back Office → **Leave calendar** (`/holiday-chart`) displays the tenant-scoped
`StaffAbsence` records for active internal staff. All staff may view it; only
users with `people.leave.edit` may record an absence.

## Views

- Day, week, month and year views use the same saved absence records.
- Week view runs Monday through Sunday. Previous and Next move by the selected
  view period; Today returns to the current local calendar date.
- Holiday, sickness and out-of-office entries are colour coded. Hovering a
  marked cell shows its saved date range.

## Live check

Open `/holiday-chart` and switch through all four views. Confirm that a known
saved absence appears on every period it overlaps. Do not add a production
absence solely for testing; use an existing record unless the named staff
member and dates were explicitly approved.
