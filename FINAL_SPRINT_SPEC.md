# FINAL SPRINT — 4 Hours, 3 Agents, Ship It

> **Read this FIRST.** This is the ONLY spec file. All 3 agents work from this simultaneously.
> Each agent has a clearly marked section. DO NOT touch files outside your section.

---

## AGENT BOUNDARIES — WHO OWNS WHAT

```
AGENT 1: BACKEND — Dispatch Logic + Auto-Assignment + Q&A Bridge
  OWNS: backend/src/routes/, backend/src/services/dispatchService.ts,
        backend/src/services/unitService.ts, backend/src/agents/dispatchBridgeAgent.ts,
        backend/src/agents/triageAgent.ts, backend/src/services/extractionService.ts
  MODIFIES: backend/src/server.ts (add routes), backend/src/agents/novaAgent.ts (add injection + session registry)
  NEW MIGRATION: backend/src/db/migrations/ (next number)

AGENT 2: FRONTEND — Dashboard UI + Role Login + Map + Detail Panel + Q&A
  OWNS: frontend/src/pages/DashboardView.tsx, frontend/src/pages/LoginPage.tsx,
        frontend/src/components/ (all new dashboard components),
        frontend/src/hooks/ (useSSE, useIncidents, useAuth, useUnits),
        frontend/src/config/, frontend/src/types/
  DOES NOT TOUCH: frontend/src/pages/CallerView.tsx, frontend/src/hooks/useCallSocket.ts

AGENT 3: NOVA SONIC + SYSTEM PROMPT + COVERT DISTRESS + TOOL ADDITIONS
  OWNS: backend/src/agents/novaAgent.ts (system prompt updates, new tools, covert detection)
  MODIFIES: Nova Sonic tool definitions, system prompt text, transcript event emissions
  DOES NOT TOUCH: routes, frontend, database
```

**RULE:** If two agents need to modify the same file, Agent 1 (backend) goes first, others wait or coordinate via well-defined interfaces.

---

## WHAT WE'RE BUILDING IN 4 HOURS

### Feature 1: Auto-Assignment Agent
When a call comes in and gets classified, the system automatically:
1. Determines which department(s) should respond based on incident type
2. Finds the nearest available unit(s) of those department types
3. Sends an alert to those units: "You've been auto-assigned to Incident #X"
4. If emergency (Priority 4-5): auto-dispatches immediately, no waiting for acceptance
5. If non-emergency (Priority 1-3): sends suggestion, unit must accept

### Feature 2: Department Unit Login
Unit officers log in, pick their unit. They see:
- All active incidents on map
- Their assigned incidents with full detail
- "I'll Respond" on unassigned incidents
- Ask-caller Q&A on their incidents (same as dispatcher)
- Live transcript with explanation annotations
- Call for backup button

### Feature 3: Unit Q&A (Same as Dispatcher)
When a unit officer is assigned to an incident and asks a question:
- Question gets injected into Sonic session
- Sonic asks caller naturally
- Answer extracted by Nova Lite
- Answer appears in the unit's Q&A panel
- Live transcript shows the exchange with a visual marker: "📎 Dispatch question asked"

### Feature 4: Annotated Live Transcript
The transcript doesn't just show raw text. It shows WHY:
- AI extraction notes inline: `[📊 Extracted: severity=4, type=accident]`
- Dispatch Q&A markers: `[📎 Unit P-2 asked: "Is the road blocked?"]`
- Covert detection: `[🤫 Covert distress detected — switching to Yes/No mode]`
- Status changes: `[✅ Patrol P-2 dispatched — "Police are on their way"]`

---

## AGENT 1: BACKEND

### 1A. Auto-Assignment Agent

**File: `backend/src/agents/triageAgent.ts`**

This agent runs automatically when Nova Sonic fires `classify_incident(type, priority)`.

```typescript
// Type mapping: incident type → required department(s)
const TYPE_TO_DEPARTMENTS: Record<string, string[]> = {
  'medical':    ['medical'],
  'fire':       ['fire'],
  'crime':      ['patrol'],
  'accident':   ['patrol', 'medical'],
  'hazmat':     ['hazmat', 'fire'],
  'domestic':   ['patrol'],
  'burglary':   ['patrol'],
  'assault':    ['patrol', 'medical'],
  'shooting':   ['patrol', 'medical'],
  'other':      ['patrol'],
};

type AutoAssignResult = {
  assigned_units: Array<{ unit_id: string; unit_type: string; distance_km: number }>;
  auto_dispatched: boolean;    // true if priority 4-5 (emergency auto-dispatch)
  needs_acceptance: boolean;   // true if priority 1-3 (unit must accept)
};

export function determineRequiredDepartments(incidentType: string): string[] {
  return TYPE_TO_DEPARTMENTS[incidentType.toLowerCase()] ?? ['patrol'];
}

export async function autoAssign(
  incidentId: string,
  incidentType: string,
  priority: number,
  incidentLat: number,
  incidentLng: number
): Promise<AutoAssignResult> {
  const requiredDepts = determineRequiredDepartments(incidentType);

  // For each required department, find nearest available unit
  const assignments: AutoAssignResult['assigned_units'] = [];

  for (const dept of requiredDepts) {
    const nearestUnit = await findNearestAvailableUnit(dept, incidentLat, incidentLng);
    if (nearestUnit) {
      assignments.push({
        unit_id: nearestUnit.id,
        unit_type: dept,
        distance_km: nearestUnit.distance,
      });
    }
  }

  const isEmergency = priority >= 4;

  if (isEmergency) {
    // AUTO-DISPATCH: Don't wait for acceptance
    for (const unit of assignments) {
      await assignUnitToIncident(incidentId, unit.unit_id, unit.unit_type);
      // Push SSE: unit_auto_dispatched
    }
  } else {
    // SUGGEST: Send alerts, wait for acceptance
    for (const unit of assignments) {
      // Push SSE: assignment_suggested (targeted to that unit)
    }
  }

  return {
    assigned_units: assignments,
    auto_dispatched: isEmergency,
    needs_acceptance: !isEmergency,
  };
}
```

**Integration point:** In the existing tool handler for `classify_incident` inside `novaAgent.ts` or wherever that tool result is processed, after updating libSQL, call:

```typescript
import { autoAssign } from '../agents/triageAgent';

// After classify_incident tool fires:
const result = await autoAssign(incidentId, type, priority, lat, lng);

if (result.auto_dispatched) {
  // Inject dispatch message into Sonic session
  const deptTypes = result.assigned_units.map(u => u.unit_type);
  const message = buildDispatchMessage(deptTypes);
  await injectTextIntoSession(session, `DISPATCH UPDATE: ${message}`, 'dispatch_status');

  // Push SSE to dashboard
  for (const unit of result.assigned_units) {
    pushSSE({
      type: 'unit_auto_dispatched',
      data: { incident_id: incidentId, unit_id: unit.unit_id, unit_type: unit.unit_type, auto: true }
    });
  }

  // Push annotated transcript event
  pushSSE({
    type: 'transcript_annotation',
    data: {
      incident_id: incidentId,
      annotation_type: 'auto_dispatch',
      text: `Auto-dispatched: ${deptTypes.join(' + ')} (Priority ${priority})`,
    }
  });
} else {
  // Push suggestion alerts to specific units
  for (const unit of result.assigned_units) {
    pushSSE({
      type: 'assignment_suggested',
      data: {
        incident_id: incidentId,
        suggested_unit: unit.unit_id,
        unit_type: unit.unit_type,
        distance_km: unit.distance_km,
        priority,
      }
    });
  }
}
```

**Department-specific dispatch messages:**

```typescript
export function buildDispatchMessage(unitTypes: string[]): string {
  const MESSAGES: Record<string, string> = {
    patrol:  'Police officers are on their way to your location right now.',
    fire:    'The fire department has been dispatched and is heading to you.',
    medical: 'An ambulance with paramedics has been dispatched to your location.',
    hazmat:  'A hazardous materials team has been dispatched.',
  };

  const unique = [...new Set(unitTypes)];
  if (unique.length === 1) return MESSAGES[unique[0]] ?? 'Help is on the way.';

  const names: Record<string, string> = {
    patrol: 'police officers', fire: 'the fire department',
    medical: 'paramedics', hazmat: 'a hazmat team',
  };
  const list = unique.map(t => names[t] ?? 'emergency responders');
  const joined = list.length === 2
    ? `${list[0]} and ${list[1]}`
    : `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
  return `I want you to know that ${joined} are all on their way to you right now. Stay on the line with me.`;
}
```

### 1B. REST Routes for Dashboard

**File: `backend/src/routes/dispatchRoutes.ts`**

```
GET  /incidents              → All active incidents (for dashboard load)
GET  /incidents/:id          → Full incident detail (respects role — see below)
GET  /incidents/resolved     → Completed incidents
GET  /units                  → All units with status + position
POST /dispatch/take          → Unit officer takes an incident (assigns self)
POST /dispatch/accept-suggestion → Unit accepts auto-assignment suggestion
POST /dispatch/assign        → Dispatcher assigns any unit(s)
POST /dispatch/question      → Either role asks caller a question (on their incident)
POST /dispatch/escalate      → Either role escalates (on their incident)
POST /dispatch/backup        → Unit officer requests backup
POST /dispatch/backup-respond → Another unit responds to backup
POST /dispatch/complete      → Either role closes case (on their incident)
POST /dispatch/save-report   → Save edited summary to libSQL
```

**Role validation on every route:**

```typescript
// GET /incidents/:id — return different data based on role
if (role === 'dispatcher') {
  // Return EVERYTHING: transcript, extraction, Q&A, full detail
} else if (role === 'unit_officer') {
  if (incident.assigned_units.includes(unitId)) {
    // Return EVERYTHING (it's their incident)
  } else {
    // Return BASIC ONLY: type, location, severity, status, assigned_unit
    // NO transcript, NO Q&A
  }
}

// POST /dispatch/assign → requireRole('dispatcher')
// POST /dispatch/take → requireRole('unit_officer'), validate unit is self
// POST /dispatch/question → validate requester is assigned to incident OR is dispatcher
// POST /dispatch/complete → same validation
// POST /dispatch/backup → requireRole('unit_officer'), validate own incident
```

### 1C. Question Bridge (for BOTH dispatcher and unit officer)

**File: `backend/src/agents/dispatchBridgeAgent.ts`**

Both dispatchers and assigned unit officers can ask the caller questions. The flow is identical:

```
1. Officer/dispatcher types question
2. POST /dispatch/question { incident_id, question, asker_id, asker_role }
3. Backend refines question via Nova Lite (optional, saves credits to skip)
4. Injects into active Sonic session
5. Sonic asks caller naturally
6. Transcript lines captured
7. Nova Lite extracts the answer from recent transcript
8. Push SSE: answer_update { incident_id, question, answer }
9. Push SSE: transcript_annotation { type: 'question_asked', text: 'P-2 asked: "..."' }
```

### 1D. Session Registry

**Modify: `backend/src/agents/novaAgent.ts`**

```typescript
// Add at module level:
const activeSessions = new Map<string, NovaSession>();

// On call_start:
activeSessions.set(incidentId, session);

// On call_end:
activeSessions.delete(incidentId);

// Export:
export function getActiveSession(id: string): NovaSession | undefined {
  return activeSessions.get(id);
}

// Text injection method (uses existing encodeChunk pattern):
export async function injectTextIntoSession(
  session: NovaSession,
  text: string,
  purpose: 'dispatch_question' | 'dispatch_status'
): Promise<void> {
  const contentName = crypto.randomUUID();
  await session.sendEvent({ event: { contentStart: {
    promptName: session.promptName, contentName,
    type: 'TEXT', interactive: true, role: 'USER',
  }}});
  await session.sendEvent({ event: { textInput: {
    promptName: session.promptName, contentName, content: text,
  }}});
  await session.sendEvent({ event: { contentEnd: {
    promptName: session.promptName, contentName,
  }}});
}
```

### 1E. SSE Event Extensions

**Add these new event types to the existing SSE broadcaster:**

```typescript
// Auto-assignment events
| { type: 'unit_auto_dispatched'; data: { incident_id, unit_id, unit_type, auto: true } }
| { type: 'assignment_suggested'; data: { incident_id, suggested_unit, unit_type, distance_km, priority } }
| { type: 'suggestion_accepted'; data: { incident_id, unit_id } }

// Backup events
| { type: 'backup_requested'; data: { incident_id, requesting_unit, requested_types, urgency, message } }
| { type: 'backup_accepted'; data: { incident_id, responding_unit } }

// Annotated transcript events
| { type: 'transcript_annotation'; data: { incident_id, annotation_type, text, timestamp } }
// annotation_type: 'auto_dispatch' | 'question_asked' | 'answer_received' | 'covert_detected' | 'escalated' | 'status_change'

// Existing events (already have):
| { type: 'incident_classified' }
| { type: 'transcript_update' }
| { type: 'extraction_update' }
| { type: 'answer_update' }
| { type: 'status_change' }
```

### 1F. Database Migration

```sql
-- backend/src/db/migrations/NNN_dispatch_features.sql

CREATE TABLE IF NOT EXISTS dispatch_actions (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  unit_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incident_units (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  is_primary INTEGER DEFAULT 1,
  auto_assigned INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'dispatched',
  dispatched_at TEXT NOT NULL DEFAULT (datetime('now')),
  arrived_at TEXT
);

CREATE TABLE IF NOT EXISTS dispatch_questions (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  asker_id TEXT,
  asker_role TEXT,
  question TEXT NOT NULL,
  answer TEXT,
  asked_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);

CREATE TABLE IF NOT EXISTS backup_requests (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  requesting_unit TEXT NOT NULL,
  requested_types TEXT NOT NULL,
  urgency TEXT NOT NULL,
  message TEXT,
  responded_units TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add to incidents table (if columns don't exist):
-- ALTER TABLE incidents ADD COLUMN assigned_units TEXT DEFAULT '[]';
-- ALTER TABLE incidents ADD COLUMN auto_assigned INTEGER DEFAULT 0;
-- ALTER TABLE incidents ADD COLUMN accepted_at TEXT;
-- ALTER TABLE incidents ADD COLUMN completed_at TEXT;
-- ALTER TABLE incidents ADD COLUMN summary TEXT;
-- ALTER TABLE incidents ADD COLUMN escalated INTEGER DEFAULT 0;
```

### 1G. server.ts Route Registration

**Add to the existing fetch handler in `backend/src/server.ts`:**

```typescript
// Import all handlers
import {
  handleGetIncidents, handleGetIncident, handleGetResolvedIncidents,
  handleGetUnits, handleTakeIncident, handleAcceptSuggestion,
  handleAssignUnits, handleQuestion, handleEscalate,
  handleBackupRequest, handleBackupRespond,
  handleComplete, handleSaveReport
} from './routes/dispatchRoutes';

// In fetch(req):
const url = new URL(req.url);
const path = url.pathname;
const method = req.method;

// GET routes
if (method === 'GET' && path === '/incidents') return handleGetIncidents(req);
if (method === 'GET' && path === '/incidents/resolved') return handleGetResolvedIncidents(req);
if (method === 'GET' && path.match(/^\/incidents\/[\w-]+$/)) return handleGetIncident(req, path.split('/')[2]);
if (method === 'GET' && path === '/units') return handleGetUnits(req);

// POST routes
if (method === 'POST' && path === '/dispatch/take') return handleTakeIncident(await req.json(), req);
if (method === 'POST' && path === '/dispatch/accept-suggestion') return handleAcceptSuggestion(await req.json(), req);
if (method === 'POST' && path === '/dispatch/assign') return handleAssignUnits(await req.json(), req);
if (method === 'POST' && path === '/dispatch/question') return handleQuestion(await req.json(), req);
if (method === 'POST' && path === '/dispatch/escalate') return handleEscalate(await req.json(), req);
if (method === 'POST' && path === '/dispatch/backup') return handleBackupRequest(await req.json(), req);
if (method === 'POST' && path === '/dispatch/backup-respond') return handleBackupRespond(await req.json(), req);
if (method === 'POST' && path === '/dispatch/complete') return handleComplete(await req.json(), req);
if (method === 'POST' && path === '/dispatch/save-report') return handleSaveReport(await req.json(), req);
```

---

## AGENT 2: FRONTEND

### 2A. Login Page with Role Selection

**File: `frontend/src/pages/LoginPage.tsx`**

```
Two role cards after Google SSO:
  📡 DISPATCHER → pick station → enter dashboard
  🚔 UNIT OFFICER → pick department → pick unit → enter dashboard

Store in React context:
  { role, user, unit?, station? }
```

### 2B. Dashboard Layout

Same layout for both roles. ArcGIS map + sidebar. The BUTTONS change based on role.

```
Header: shows role ("📡 Dispatcher — Central" or "🛡️ Patrol P-2")
Map: ArcGIS dark basemap, unit dots, incident markers, route polylines
Ticker: stock-terminal marquee at top or bottom (all incidents, read-only)
Sidebar: incident list → click → incident detail
```

### 2C. Incident Card — Button Logic

```typescript
// Determine which buttons to show:

function getCardActions(role: Role, unit: Unit | null, incident: Incident): Action[] {
  const isMyIncident = unit && incident.assigned_units?.includes(unit.id);
  const isUnassigned = !incident.assigned_units?.length;
  const isActive = ['active', 'classified'].includes(incident.status);
  const isDispatched = ['dispatched', 'en_route', 'on_scene'].includes(incident.status);

  if (role === 'dispatcher') {
    const actions: Action[] = [];
    if (isUnassigned) actions.push('assign_unit');         // Assign any unit
    if (isDispatched) actions.push('assign_more');         // Add more units
    actions.push('view_detail');                           // Always
    if (isDispatched) actions.push('escalate', 'complete');
    return actions;
  }

  if (role === 'unit_officer') {
    const actions: Action[] = [];
    if (isUnassigned && isActive) actions.push('take');    // "I'll Respond"
    if (isMyIncident) {
      actions.push('view_detail', 'ask_question', 'backup', 'escalate', 'complete');
    }
    // Other unit's incident: no actions, just map marker
    return actions;
  }

  return [];
}
```

### 2D. Full Detail Panel (Both Roles, Only for Authorized Incidents)

```
Show when:
  - Dispatcher clicks any incident
  - Unit officer clicks THEIR incident

Contains:
  1. AI Report (extraction data, severity bar, hazards, response recommendation)
  2. ANNOTATED Live Transcript (see 2E below)
  3. Dispatch Q&A panel (both roles can ask questions)
  4. Action buttons (role-dependent)
```

### 2E. Annotated Transcript

The transcript shows regular lines PLUS annotation markers from `transcript_annotation` SSE events:

```
🤖  911, what's your emergency?
👤  There's been a car crash at 5th and Main
🤖  I understand. Are you safe? Is anyone injured?
👤  Two people are hurt, one hit their head

  📊  Classified: Accident — Priority 4 (High)
  🚔  Auto-dispatched: Patrol P-2 + Medical M-1

👤  I think there's fuel leaking from one of the cars
🤖  I want you to know that police officers and paramedics
    are on their way to you right now.

  ⚠️  Hazard detected: Fuel leak — Escalation suggested

  📎  P-2 asked: "Is the intersection completely blocked?"

🤖  Can you tell me — is the intersection completely blocked
    or can some vehicles still get through?
👤  Both lanes are completely blocked

  ✅  Answer: Both lanes blocked in both directions
```

**Implementation:**
- Regular transcript lines: from `transcript_update` SSE events
- Annotations: from `transcript_annotation` SSE events
- Both go into the same ordered list, sorted by timestamp
- Annotations styled differently: smaller text, colored background pill, icon prefix

```typescript
type TranscriptEntry =
  | { type: 'line'; role: 'caller' | 'ai'; text: string; timestamp: string }
  | { type: 'annotation'; annotation_type: string; text: string; timestamp: string };

// Render annotations as:
// bg-slate-700/30 rounded-md px-3 py-1.5 text-xs text-slate-400 flex items-center gap-2
// With icon based on annotation_type:
//   auto_dispatch → 🚔
//   question_asked → 📎
//   answer_received → ✅
//   covert_detected → 🤫
//   extraction → 📊
//   escalated → ⚠️
//   status_change → 🔄
```

### 2F. Auto-Assignment Alerts (Unit Officer View)

When `assignment_suggested` SSE fires for the logged-in unit:

```
┌──────────────────────────────────────────────────────────────┐
│ 🚔 ASSIGNMENT ALERT                                          │
│ Vehicle Collision at 5th & Main Street                       │
│ Priority: 4 (High) • 0.3 km away                            │
│ Recommended: You (P-2) + Medical M-1                         │
│                                                               │
│      [✅ Accept Assignment]      [❌ Decline]                 │
└──────────────────────────────────────────────────────────────┘
```

When `unit_auto_dispatched` SSE fires (emergency, no choice):

```
┌──────────────────────────────────────────────────────────────┐
│ 🚨 EMERGENCY AUTO-DISPATCH                                    │
│ Active Shooter at 200 Central Ave                            │
│ Priority: 5 (Critical) • 0.5 km away                        │
│ You (P-2) have been auto-dispatched                          │
│                                                               │
│      [📋 View Incident]     [🗺️ Navigate]                    │
└──────────────────────────────────────────────────────────────┘
```

- Emergency auto-dispatch: no decline option. You're going.
- Non-emergency suggestion: can accept or decline.
- Both show as persistent notification bars, not toasts.
- Sound/vibration alert.

### 2G. Backup Request UI (Unit Officer on Their Incident)

```
🆘 CALL BACKUP button → opens modal:

  What do you need?
  [☑ More patrol] [☐ Fire] [☑ Medical]

  Urgency: [Routine] [Urgent] [🔴 EMERGENCY]

  Message: [Suspect armed, need backup now____]

  [Cancel]  [🆘 Send Alert]
```

Nearby units see the backup alert (same as current FEATURES.md spec).

### 2H. SSE Hook

**File: `frontend/src/hooks/useSSE.ts`**

```typescript
export function useSSE(backendUrl: string) {
  const [incidents, setIncidents] = useState<Record<string, Incident>>({});
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptEntry[]>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const es = new EventSource(`${backendUrl}/events`);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data);

      switch (event.type) {
        case 'incident_classified':
          // Upsert incident
          break;
        case 'transcript_update':
          // Append line to transcript
          break;
        case 'transcript_annotation':
          // Append annotation to transcript (same list, different rendering)
          break;
        case 'extraction_update':
          // Merge into incident data
          break;
        case 'answer_update':
          // Add to Q&A thread
          break;
        case 'unit_auto_dispatched':
          // If it's MY unit → show emergency dispatch alert
          // Update incident state
          break;
        case 'assignment_suggested':
          // If it's MY unit → show suggestion alert
          break;
        case 'backup_requested':
          // If I'm nearby and available → show backup alert
          break;
        case 'status_change':
          // Update incident status
          break;
      }
    };

    return () => es.close();
  }, [backendUrl]);

  return { incidents, transcripts, alerts };
}
```

---

## AGENT 3: NOVA SONIC — System Prompt + Tools + Covert Detection

### 3A. System Prompt Additions

Add these blocks to the EXISTING system prompt in `novaAgent.ts`. Do NOT replace the existing prompt — append to it.

```
COVERT DISTRESS DETECTION:
You must detect when a caller cannot speak freely. Signs include:
- Ordering food, taxi, or any service on a 911 line
- Whispering or extremely quiet speech
- Only yes/no or one-word answers with tense tone
- Saying "wrong number" after giving real information
- A child calling about a parent being hurt
- Background sounds of violence (yelling, hitting, crying, breaking objects)

WHEN COVERT DISTRESS DETECTED:
1. Do NOT say "911", "emergency", or "police" aloud
2. Play along briefly if they're ordering something
3. Pivot: "I understand. Are you able to talk freely right now?"
4. If NO → switch to yes/no mode:
   "I'm going to ask some yes or no questions."
   - "Is someone with you who is dangerous?"
   - "Are you hurt?"
   - "Are there children present?"
   - "Does this person have a weapon?"
5. Speak softly. Match their volume.
6. Get location as TOP priority.
7. "Help is coming. They will be quiet."
8. Fire the flag_covert_distress tool.

WHEN DISPATCH INJECTS A QUESTION:
When you receive a text marked DISPATCH FOLLOW-UP, naturally ask the caller
that question as your own follow-up. Do NOT mention dispatch, an officer, or
a unit. Just ask it naturally.

WHEN UNITS ARE DISPATCHED:
When you receive a text marked DISPATCH UPDATE, relay the EXACT message to
the caller verbally. Then ask: "Is there anything else you can tell me while
we wait for them?"

NEVER:
- Never repeat sensitive info back loudly if caller is whispering
- Never say "police" or "officer" if covert distress is detected
- Never ask a child to confront a dangerous person
- Never dismiss any call as a prank if distress signals are present
```

### 3B. New Tool: `flag_covert_distress`

Add to the existing tool definitions array in `novaAgent.ts`:

```typescript
{
  toolSpec: {
    name: 'flag_covert_distress',
    description: 'Call this when you detect the caller cannot speak freely — ordering pizza, whispering, one-word answers, silent line with distress sounds, or any covert distress signal.',
    inputSchema: {
      json: JSON.stringify({
        type: 'object',
        properties: {
          distress_type: {
            type: 'string',
            enum: ['pizza_order', 'silent_line', 'whispering', 'one_word', 'wrong_number', 'child_caller', 'coerced', 'other'],
            description: 'The type of covert distress detected'
          },
          caller_can_speak: {
            type: 'boolean',
            description: 'Whether the caller can speak at all (false for silent lines)'
          },
          abuser_present: {
            type: 'boolean',
            description: 'Whether a dangerous person appears to be nearby'
          }
        },
        required: ['distress_type', 'caller_can_speak']
      })
    }
  }
}
```

**Tool handler (in the tool result processing):**

```typescript
case 'flag_covert_distress': {
  const { distress_type, caller_can_speak, abuser_present } = toolInput;

  // Update incident in libSQL
  await db.execute({
    sql: 'UPDATE incidents SET covert_distress = 1, distress_type = ? WHERE id = ?',
    args: [distress_type, incidentId]
  });

  // Push SSE to dashboard
  pushSSE({
    type: 'transcript_annotation',
    data: {
      incident_id: incidentId,
      annotation_type: 'covert_detected',
      text: `Covert distress detected: ${distress_type}. Silent approach required.`,
      timestamp: new Date().toISOString(),
    }
  });

  pushSSE({
    type: 'covert_distress_detected',
    data: {
      incident_id: incidentId,
      distress_type,
      caller_can_speak,
      abuser_present,
      dispatch_instructions: {
        silent_approach: true,
        no_sirens: true,
      }
    }
  });

  // Return tool result to Sonic
  return { status: 'flagged', instructions: 'Continue with yes/no questioning. Do not break cover.' };
}
```

### 3C. Transcript Annotation Emissions

In the existing transcript processing code (wherever `textOutput` events from Sonic are handled), add SSE pushes:

```typescript
// After saving a transcript line:
pushSSE({
  type: 'transcript_update',
  data: { incident_id: incidentId, role, text, timestamp: new Date().toISOString() }
});

// After classify_incident tool fires:
pushSSE({
  type: 'transcript_annotation',
  data: {
    incident_id: incidentId,
    annotation_type: 'extraction',
    text: `Classified: ${type} — Priority ${priority}`,
    timestamp: new Date().toISOString(),
  }
});

// After dispatch message injected:
pushSSE({
  type: 'transcript_annotation',
  data: {
    incident_id: incidentId,
    annotation_type: 'status_change',
    text: `Dispatched: ${unitTypes.join(' + ')} — "${dispatchMessage}"`,
    timestamp: new Date().toISOString(),
  }
});
```

### 3D. Existing Tools to Verify

Make sure these existing tools still work and emit SSE:

| Tool | Fires When | SSE Event |
|------|-----------|-----------|
| `classify_incident(type, priority)` | Sonic has enough info | `incident_classified` + `transcript_annotation` |
| `get_protocol(query)` | Sonic needs protocol context | (internal, no SSE needed) |
| `dispatch_unit(incident_id, unit_type)` | Sonic determines dispatch needed | `dispatch_requested` + triggers auto-assignment |
| `flag_covert_distress(...)` | NEW — covert distress detected | `covert_distress_detected` + `transcript_annotation` |

---

## CRITICAL: HOW THE 3 AGENTS COORDINATE

```
Agent 3 (Sonic) fires classify_incident tool
  → existing tool handler updates libSQL
  → existing tool handler pushes SSE: incident_classified
  → NEW: calls Agent 1's autoAssign() function
  → Agent 1 finds nearest units, auto-dispatches or suggests
  → Agent 1 pushes SSE: unit_auto_dispatched or assignment_suggested
  → Agent 2 (frontend) receives SSE, shows alert to unit officer

Agent 2 (frontend) user clicks "Ask Question"
  → POST /dispatch/question (Agent 1's route)
  → Agent 1 injects text into Sonic session via session registry
  → Agent 3 (Sonic) asks caller naturally
  → Agent 3 emits transcript lines
  → Agent 1 pushes SSE: transcript_annotation (question_asked)
  → Agent 1 detects answer, pushes SSE: answer_update
  → Agent 2 shows answer in Q&A panel

Agent 3 (Sonic) detects covert distress
  → fires flag_covert_distress tool
  → Agent 1's tool handler pushes SSE: covert_distress_detected
  → Agent 2 shows 🤫 COVERT badge + "SILENT APPROACH" banner
```

---

## 4-HOUR TIMELINE

```
HOUR 1 (All 3 agents start simultaneously):
  Agent 1: Migration + dispatchRoutes scaffold + autoAssign logic
  Agent 2: LoginPage + DashboardView layout + SSE hook
  Agent 3: System prompt updates + flag_covert_distress tool + transcript annotations

HOUR 2:
  Agent 1: Take/assign/question/escalate route handlers + session registry
  Agent 2: IncidentCard + IncidentDetail + button logic by role
  Agent 3: Tool handler for covert distress + integration with classify_incident → autoAssign

HOUR 3:
  Agent 1: Backup request routes + dispatch message injection + complete/save-report
  Agent 2: Annotated transcript component + Q&A panel + auto-assignment alerts + backup UI
  Agent 3: Test Sonic flow end-to-end, verify all SSE events fire correctly

HOUR 4:
  ALL: Integration testing. Run a call end-to-end.
  Fix any broken connections between agents.
  Person 3 (video): Record the demo NOW with whatever is working.
  Submit.
```

---

## REMEMBER

- **Bun only.** `bun add`, `bun run`, `bun test`. Never npm/npx.
- **TypeScript strict.** No `any`.
- **Parameterized SQL.** Never interpolate.
- **IDs = `crypto.randomUUID()`**
- **Timestamps = ISO 8601 strings**
- **SSE not WebSocket for dashboard.** WebSocket only for `/call`.
- **The video matters more than perfect code.** If something works 80%, record it and submit.


---
  ❌ Not Done / Missing

  ┌─────┬────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #  │          Feature           │                                           What's Missing                                           │
  ├─────┼────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ 1A  │ Auto-assignment on         │ autoAssign() is NOT called after classify_incident fires in novaAgent.ts. Nearest unit lookup +    │
  │     │ classify                   │ auto-dispatch SSE (unit_auto_dispatched, assignment_suggested) — not wired                         │
  ├─────┼────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ 2E  │ Annotated Live Transcript  │ transcript_annotation SSE events not emitted. LiveTranscript component renders raw lines only — no │
  │     │                            │  annotation markers (📊 📎 ✅ 🤫)                                                                  │
  ├─────┼────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ 2F  │ Auto-Assignment Alert      │ assignment_suggested / unit_auto_dispatched SSE events not handled in frontend. No alert banner    │
  │     │ banner                     │ for unit officers                                                                                  │
  ├─────┼────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ 1E  │ transcript_annotation SSE  │ Never pushed anywhere — not after classify, not after dispatch, not after Q&A                      │
  ├─────┼────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ 3C  │ Transcript annotation      │ After classify_incident tool fires, no transcript_annotation SSE is pushed                         │
  │     │ emissions                  │                                                                                                    │
  ├─────┼────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ 2H  │ SSE hook handles new       │ useSSE doesn't handle transcript_annotation, unit_auto_dispatched, assignment_suggested            │
  │     │ events                     │                                                                                                    │
  └─────┴────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────┘

  ---
  Priority order to finish

  1. Annotated transcript — most visible in demo video
  2. Auto-assignment trigger — calls autoAssign() after classify fires
  3. Auto-assignment alert banner — unit officer sees the alert
  4. transcript_annotation SSE — emitted after classify, dispatch, Q&A

  Want me to implement these remaining items?
