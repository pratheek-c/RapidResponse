---
name: Covert Distress Detection — Implementation Plan
description: Architecture notes for flag_covert_distress tool, SSE event, DB migration, frontend badge/banner, and extraction extension
type: project
---

Feature: Covert Distress Detection — Nova Sonic detects caller cannot speak freely and fires flag_covert_distress tool.

**Why:** Life-safety feature — silent 112 calls (pizza code, hostage, DV) are misidentified as pocket dials and dropped. The tool signals dispatcher to switch to silent approach protocol.

**How to apply:** When implementing, follow the exact build order below. Every layer has a dependency chain: DB → types → tool → callHandler → SSE → frontend types → hook → UI.

Key architectural facts found during research (2026-03-16):
- Nova Sonic tool execution path: contentEnd(stopReason=TOOL_USE) → executeTool() in novaAgent.ts → returns {success, data} → sent back as toolResultInput
- SSE uses `pushSSE(DashboardSSEEvent)` — already typed in backend/src/types/index.ts as a discriminated union
- Frontend SSE listener is in useSSE.ts — listens on a hardcoded EVENT_TYPES array; must add new event type there
- Extraction is in-memory only (no DB column); covert_distress flag should follow same pattern for low-latency signal, BUT also write to DB for persistence/reload
- DashboardIncident in frontend/src/types/dashboard.ts must gain covert_distress field
- IncidentCard and IncidentDetail both read DashboardIncident — both need badge rendering
- The `rowToIncident` function in libsql.ts maps DB rows → Incident type; must be updated when column is added
- Incident type in backend/src/types/index.ts and UpdateIncidentInput must grow covert_distress field
- Migration numbering is sequential: next is 008
