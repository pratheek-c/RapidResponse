---
name: CAD Dispatcher-Side Audit — March 2026
description: Full gap analysis of the RapidResponse dispatcher-facing app (login → dashboard → incident management). Records every issue found and its severity tier for future prioritisation work.
type: project
---

Audit performed 2026-03-16 against git head 7601c87.

**Why:** Evaluators familiar with Spillman/PremierOne will review this. Issues below represent the delta between "impressive demo" and "production-credible CAD system."

**How to apply:** Use this as the master backlog. P0/Critical items should be addressed before any public evaluation or demo to emergency-services stakeholders.

## Summary of major gaps
- Two parallel dashboard implementations (DispatcherDashboard vs DashboardView) — split routing/styling problem
- No incident sort order (arrival order not enforced)
- `window.confirm()` used for destructive dispatch actions — completely unacceptable in production CAD
- No session timeout / idle lock
- No dispatcher badge/ID visible during active session
- No CAD number (sequential human-readable incident ID) — only UUIDs
- Keyboard shortcuts advertised in UI (F4/F6/F8) but their state (e.g., F4 when no units selected) not clearly blocked
- Overdue threshold is hard-coded at 8 minutes with no justification
- Stats bar shows "this shift" for Resolved count but doesn't actually filter by shift
- No sound/visual alert for new P1 incidents
- "Simulate 112 Call" button in the production header and nav — demolicious but looks amateur
- No incident log / audit trail visible per incident
- No multi-agency / multi-department filtering
- Map has no controls for filtering by unit type or incident type
- UnitPanel in DispatcherDashboard fetches from /mock endpoint — mock data served on the production path
- handleDispatch in DispatcherDashboard silently swallows all errors
- Two completely different IncidentDetail implementations (components/IncidentDetail.tsx vs components/incidents/IncidentDetail.tsx)
- Department selection persisted in localStorage — no server-side validation of role
