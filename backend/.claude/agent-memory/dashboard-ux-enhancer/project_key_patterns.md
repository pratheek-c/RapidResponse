---
name: project_key_patterns
description: API endpoints, SSE events, data flow patterns, action handlers, and Dublin context for RapidResponse.ai
type: project
---

## API Endpoints (all prefixed with VITE_API_BASE)
- GET  /incidents — all incidents
- GET  /incidents/:id — single incident
- GET  /incidents/:id/transcript — transcript turns
- GET  /incidents/:id/questions — Q&A entries
- POST /dispatch/accept — { incident_id, unit_ids, officer_id }
- POST /dispatch/question — { incident_id, question, officer_id }
- POST /dispatch/escalate — { incident_id, reason, requested_unit_types }
- POST /dispatch/complete — { incident_id }
- POST /dispatch/save-report — { incident_id, summary }
- GET  /units — all units
- GET  /units/mock?lat=&lng= — mock units sorted by distance
- GET  /mock/dispatchers — mock dispatcher + zone data

## SSE Event Types
- incident_created — new incident { incident_id, created_at }
- incident_classified — type/priority assigned { incident_id, incident_type, priority }
- transcript_update — new transcript line { incident_id, role, text, timestamp }
- extraction_update — AI extraction data { incident_id, extraction: Record<string,any> }
- answer_update — Q&A answer arrived { incident_id, question, answer }
- unit_dispatched — unit assigned { incident_id, unit_id, unit_type }
- status_change — status transition { incident_id, status, unit_id? }
- escalation_suggestion — triage escalation { incident_id, reason, suggested_units }
- incident_completed — resolved { incident_id, summary }

## Data Flow
1. useSSE establishes EventSource to backend SSE stream
2. useIncidents consumes SSE events and merges into local state
3. IncidentDetail fetches transcript/questions on mount (not SSE-driven)
4. Unit data polled separately via useUnits (no SSE for units)

## Key Missing Features (as of audit)
- ActionButtons has no loading/disabled states during API calls
- No toast/notification feedback on dispatch actions
- Stats bar says "Springfield" — should be "Dublin"
- Header says "Springfield Emergency Communications" — should be Dublin branding
- EmptyState in DispatcherDashboard says "SPRINGFIELD" — needs Dublin context
- UnitSelector shows unit_code + department only — no distance, ETA, or type detail
- QuestionInput has no voice input option
- No keyboard shortcuts
- No shift/clock info in header or stats bar
- No call queue depth or response time metrics

## Dublin-Specific Context
- Organization: Dublin Emergency Communications Centre (Baggot Street)
- Call center designation: DECC
- Garda zones: Dublin Metropolitan Region — DM North, DM South, DM East, DM West, DM Central
- Fire brigade: Dublin Fire Brigade (DFB)
- Ambulance: National Ambulance Service (NAS)
- Emergency number: 112 / 999
- CAD system: Computer Aided Dispatch
