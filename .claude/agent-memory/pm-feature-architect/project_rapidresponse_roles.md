---
name: project_rapidresponse_roles
description: Role-based dashboard feature context — Dispatcher vs Unit Officer, branch feat/role-based-dashboard, key architecture decisions
type: project
---

Feature branch: `feat/role-based-dashboard` created 2026-03-16.

Two roles being built: Dispatcher (command center, god-view) and Unit Officer (field responder, takes own jobs).

**Key architecture decisions:**
- Session context stored in a new `UserSessionContext` (React context), NOT in useAuth — keeps auth hook clean
- `useAuth` already stores `department` in localStorage (key: `rr_dispatch_department`). The new role/unit/station selection happens AFTER auth, as a second step on the LoginPage.
- Role defaults to 'dispatcher' when no role is selected (backwards compat with existing flow)
- Backend role validation is permissive — reads `role` from request body, not from JWT (no JWT role claims yet)
- NO breaking changes to existing endpoints: /dispatch/accept, /dispatch/question, /dispatch/escalate, /dispatch/complete, /dispatch/save-report
- New endpoints added: POST /dispatch/take, POST /dispatch/backup-request, POST /dispatch/backup-respond
- New DB migration: `005_roles.sql` (backup_requests + active_sessions tables)
- `assigned_units` on incidents is stored as JSON string in DB (already exists)
- The existing `IncidentDetail` shows full detail (transcript, Q&A, unit assignment) to everyone — needs role-gating

**Frontend key files:**
- `frontend/src/hooks/useAuth.ts` — Firebase auth, stores department in localStorage
- `frontend/src/pages/LoginPage.tsx` — currently shows dept selector + Google SSO, needs role selector added
- `frontend/src/pages/DashboardView.tsx` — top-level dashboard, needs session context
- `frontend/src/components/common/Header.tsx` — needs role + unit/station display
- `frontend/src/components/incidents/IncidentDetail.tsx` — needs role-gating on transcript/Q&A/actions
- `frontend/src/components/dispatch/ActionButtons.tsx` — needs role-aware button visibility
- `frontend/src/types/dashboard.ts` — needs new SSE event types + UserSession type

**Backend key files:**
- `backend/src/routes/dispatch.ts` — add take, backup-request, backup-respond routes
- `backend/src/types/index.ts` — add new request types, SSE events
- `backend/src/db/migrations/` — add 005_roles.sql

**Why:** Spec in ROLE_BASED_DASHBOARD_SPEC.md. Core use case: field units need to self-assign to incidents and call for backup without dispatcher intervention.

**How to apply:** When suggesting future work on dispatch flows, remember the role split. Unit Officers cannot assign other units, only themselves via /dispatch/take.
