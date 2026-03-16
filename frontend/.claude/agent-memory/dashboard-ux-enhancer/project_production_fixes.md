---
name: production_fixes_batch1
description: All 9 production fixes applied 2026-03-16 to the DECC dispatcher dashboard
type: project
---

Applied 2026-03-16. All changes are surgical edits; no new dependencies added.

## Task 1 — Remove "Simulate 112 Call" button
**File:** `frontend/src/components/common/Header.tsx`
Removed the `<Link to="/">Simulate 112 Call</Link>` button and the `Link` import from react-router-dom. It was a dev-only button that should never appear in the production dispatcher UI.

## Task 2 — Replace window.confirm() with in-app modal (Escalate & Complete)
**File:** `frontend/src/components/dispatch/ActionButtons.tsx`
Replaced both `window.confirm()` calls with a `ConfirmModal` component rendered via `confirmAction: "escalate" | "complete" | null` state. Modal has dark overlay, action title, contextual warning, Cancel (grey) and Confirm (amber for escalate, red for complete) buttons. The actual API call only runs after modal Confirm.

## Task 3 — Human-readable CAD incident number (INC-YYYYMMDD-NNNN)
**Files changed:**
- `frontend/src/types/dashboard.ts` — Added `cad_number: string | null` to `DashboardIncident`
- `backend/src/types/index.ts` — Added `cad_number: string | null` to `Incident`
- `backend/src/db/libsql.ts` — `dbCreateIncident` now queries `COUNT(*) WHERE DATE(created_at) = DATE('now')`, increments by 1, formats as `INC-YYYYMMDD-NNNN`, inserts into `cad_number` column. `rowToIncident` mapper reads the column.
- `backend/src/db/migrations/007_add_cad_number.sql` — `ALTER TABLE incidents ADD COLUMN cad_number TEXT`
- `backend/scripts/seed.ts` — Added `007_add_cad_number.sql` to migration list; seed incidents have `cad_number` values `INC-20260316-0001` through `INC-20260316-0004`
- `frontend/src/components/incidents/IncidentCard.tsx` — Shows `cad_number ?? #${id.slice(0,8)}` in card header and aria-label
- `frontend/src/components/incidents/IncidentDetail.tsx` — Shows `cad_number ?? #${id.slice(0,8)}` in detail panel header

## Task 4 — Accept button disabled when no units selected
**File:** `frontend/src/components/dispatch/ActionButtons.tsx`
Added `selectedUnitIds?: string[]` prop. Accept button is `disabled` when `selectedUnitIds.length === 0`, with `title="Select at least one unit before dispatching"` tooltip. `IncidentDetail.tsx` passes `selectedUnitIds={selectedUnitIds}` to `ActionButtons`.

## Task 5 — Sort incident list P1 first, then by created_at descending
**File:** `frontend/src/components/incidents/IncidentList.tsx`
Added module-level `PRIORITY_ORDER` map `{P1:0, P2:1, P3:2, P4:3}`. Inside `filtered` useMemo, after filtering, calls `result.sort()` by priority rank then `Date.parse(b.created_at) - Date.parse(a.created_at)`. Also added `cad_number` to search matching.

## Task 6 — P1 audio alert + dismissible banner for new critical incidents
**File:** `frontend/src/pages/DashboardView.tsx`
- Added `playP1Tone()` function: creates `AudioContext`, plays 880 Hz for 0.3s then 660 Hz for 0.3s (two-tone siren). Gracefully catches AudioContext errors.
- Added `seenIds: useRef<Set<string>>` to track already-seen incident IDs across renders.
- `useEffect` on `incidents` array: for each new P1 incident not yet in `seenIds`, fires `playP1Tone()` and pushes to `p1Alerts` state. Non-P1 incidents are also registered in `seenIds` to avoid alerting if later upgraded (re-fetched).
- Renders dismissible full-width red banners above `StatsBar` for each active alert. X button removes individual alert.

## Task 7 — Toast on failed dispatch actions (inline error banner)
**File:** `frontend/src/components/incidents/IncidentDetail.tsx`
- Added `actionError: string | null` state with `useEffect` auto-dismiss after 6 seconds.
- `handleAccept`, `handleEscalate`, `handleComplete` each wrapped in try/catch: on error, sets `actionError` with the message, then re-throws so `ActionButtons` can also show its own toast.
- Red error banner rendered above the `ActionButtons` section when `actionError` is set.

## Task 8 — Status badge colors distinguishable
**Files:**
- `frontend/src/components/Badges.tsx` — Updated `STATUS_STYLES` inline styles: active=amber, classified=blue, dispatched=indigo/purple, en_route=cyan, on_scene=green, completed/resolved=slate, cancelled=dark red.
- `frontend/src/components/common/StatusBadge.tsx` — Updated `statusStyle` Tailwind classes to match same semantics using Tailwind utility classes.

## Task 9 — Sign-out confirmation modal
**File:** `frontend/src/components/common/Header.tsx`
Added `signOutPending: boolean` state. Sign Out button now sets `signOutPending(true)` instead of calling `onSignOut()` directly. A modal overlay renders when `signOutPending` is true, with "Sign out of DECC?" title, explanatory text, Cancel (grey) and Sign Out (red) buttons. `onSignOut()` only called on Confirm.

**Why:** `window.confirm()` is blocked in many browser contexts and looks unprofessional. Modal keeps UX consistent and prevents accidental sign-out.
