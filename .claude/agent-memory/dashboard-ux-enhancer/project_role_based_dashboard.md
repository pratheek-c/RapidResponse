---
name: role_based_dashboard
description: Architecture and file locations for the role-based dispatcher/unit-officer feature added in feat/role-based-dashboard
type: project
---

Role-based dashboard was implemented on branch `feat/role-based-dashboard` (commit cc02132).

**Key new files:**
- `frontend/src/context/SessionContext.tsx` — UserSession type, SessionProvider, useSession() hook, canActOnIncident / canTakeIncident / canViewFullDetail permission helpers. Session persisted to localStorage under key `rr_user_session`.
- `frontend/src/components/dispatch/BackupModal.tsx` — modal for unit officers to POST /dispatch/backup-request
- `frontend/src/components/common/BackupAlertBanner.tsx` — SSE-driven banner for backup_requested events; mounted at top of DashboardView

**Modified files:**
- `frontend/src/App.tsx` — SessionProvider wraps the whole tree
- `frontend/src/pages/LoginPage.tsx` — two-step flow: step 1 = dept + Google auth, step 2 = role selector (dispatcher picks station, unit officer picks dept tab then unit from GET /units?status=available)
- `frontend/src/components/common/Header.tsx` — RoleBadge shows role-aware pill; sign-out clears session
- `frontend/src/components/incidents/IncidentCard.tsx` — unit officer action row: "I'll Respond" / "My Incident" / "View only"
- `frontend/src/components/incidents/IncidentDetail.tsx` — canViewFullDetail gate; unit officer sees restricted view or "Call Backup" panel
- `frontend/src/hooks/useSSE.ts` — added backup_requested, backup_accepted, unit_status_change event types
- `frontend/src/types/dashboard.ts` — SseBackupRequestedEvent, SseBackupAcceptedEvent, SseUnitStatusChangeEvent added to SSEEvent union

**Permission model:**
- Dispatcher: full access to everything, all incidents, all actions
- Unit Officer: full detail only for incidents where their unit_id is in assigned_units; "I'll Respond" available on active/classified incidents with no assigned units; restricted view (AI report + lock) for other incidents

**New backend endpoints consumed (already exist in backend):**
- POST /dispatch/take — { incident_id, unit_id }
- POST /dispatch/backup-request — { incident_id, requesting_unit, requested_types, urgency, message }
- POST /dispatch/backup-respond — { incident_id, responding_unit }
- SSE events: backup_requested, backup_accepted, unit_status_change

**Why:** Frontend role separation requested to support field unit officers using the dashboard on mobile devices alongside command-center dispatchers.

**How to apply:** When adding new features that involve actions on incidents, check canActOnIncident/canViewFullDetail from SessionContext before rendering action buttons. Do not add role enforcement to backend calls — frontend check is sufficient per spec.
