---
name: codebase_map
description: File locations for all key components and backend modules in RapidResponse.ai
type: project
---

## Frontend — src/

- `components/common/Header.tsx` — Top nav bar: logo, shift badge, live clock, sign-out button
- `components/common/StatusBadge.tsx` — Tailwind-based status pill used in dashboard (dark theme)
- `components/common/LiveIndicator.tsx` — Animated connected/offline dot
- `components/common/DeptIcon.tsx` — Dept icon chip (patrol/fire/medical/hazmat)
- `components/Badges.tsx` — Inline-style badges used in CallerView (non-Tailwind context): PriorityBadge, StatusBadge (separate from common/StatusBadge), TypeChip
- `components/incidents/IncidentCard.tsx` — Compact card in left sidebar list
- `components/incidents/IncidentDetail.tsx` — Right panel: AI report, transcript, Q&A, unit selector, action buttons
- `components/incidents/IncidentList.tsx` — Left sidebar: filter tabs, search, sorted incident cards
- `components/dispatch/ActionButtons.tsx` — Accept/Escalate/Complete buttons with keyboard shortcuts (F4/F6/F8), toasts, confirm modal
- `components/dispatch/UnitSelector.tsx` — Unit selection grid
- `components/dispatch/QAThread.tsx` — Q&A display
- `components/dispatch/QuestionInput.tsx` — Ask-a-question text input
- `pages/DashboardView.tsx` — Main layout: Header + StatsBar + IncidentList + CommandMap + IncidentDetail
- `types/dashboard.ts` — All frontend types: DashboardIncident, DashboardUnit, SSE events, etc.

## Backend — src/

- `types/index.ts` — All backend types including Incident (has cad_number since Task 3)
- `db/libsql.ts` — libSQL singleton + all DB helper functions (dbCreateIncident generates CAD number)
- `db/migrations/` — SQL migration files 001–007 (007 adds cad_number column)
- `services/incidentService.ts` — High-level incident CRUD, pushes SSE events
- `scripts/seed.ts` — Dev seed data (14 units, 4 incidents with cad_numbers)

## Key conventions

- State management: React local state + custom hooks (useIncidents, useUnits, useAuth, useSSE)
- CSS: Tailwind CSS with custom tokens (bg-command-panel, bg-command-card, text-command-text, shadow-glow) defined in tailwind config
- API: REST over fetch, base URL from `VITE_API_BASE` env var
- Real-time: SSE via `useSSE` hook — events pushed from backend `sseService.ts`
- DB: libSQL (SQLite-compatible), file-based in dev (`file:./data/rapidresponse.db`)
- Auth: Firebase Auth via `useAuth` hook
