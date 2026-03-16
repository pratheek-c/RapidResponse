# Role-Based Dashboard Spec — Dispatcher vs Unit Officer

> Two login types. Same dashboard. Different permissions. This doc defines exactly what each role sees, what buttons are active, and how the "call for backup" system works.

---

## The Two Roles

### DISPATCHER (Command Center)

- **Who:** Operator sitting at the dispatch center
- **Login:** Google SSO → selects role "Dispatcher" → selects their dispatch center/station
- **View:** Sees ALL incidents, ALL units, full god-view of the map
- **Can do:**
  - View any incident detail (report, transcript, Q&A)
  - Assign ANY available unit to ANY unassigned incident
  - Ask caller follow-up questions (dispatch bridge)
  - Escalate any incident (request battalion increase)
  - Complete any incident (generate report, save)
  - See and respond to backup alerts from field units
- **Cannot do:**
  - Take a job themselves (they're not a field unit)

### UNIT OFFICER (Field Responder)

- **Who:** Patrol officer, firefighter, paramedic, hazmat tech — in the field
- **Login:** Google SSO → selects role "Unit Officer" → selects their unit (e.g., "Patrol P-2")
- **View:** Sees ALL active incidents on map, sees other units as dots, sees the ticker
- **Can do:**
  - **Take a job** — "I'll respond to this" (assigns THEMSELVES only)
  - View detail of incidents they've taken (full report, transcript, Q&A)
  - Ask caller follow-up questions on THEIR incident
  - Escalate THEIR incident
  - Complete THEIR incident (generate report, save)
  - **Call for backup** — send alert to nearby units ("I need help")
  - View other active incidents on map (read-only markers)
- **Cannot do:**
  - Assign OTHER units to incidents
  - Complete or escalate someone else's incident
  - Access full detail (transcript, Q&A) of incidents they haven't taken

---

## Login Flow

```
┌──────────────────────────────────────────────┐
│                                               │
│         🚨 RAPIDRESPONSE.AI                   │
│         Emergency Response Platform           │
│                                               │
│    ┌──────────────────────────────────┐       │
│    │   🔒 Sign in with Google         │       │
│    └──────────────────────────────────┘       │
│                                               │
│    Select your role:                          │
│                                               │
│    ┌──────────────────┐ ┌──────────────────┐  │
│    │  📡 DISPATCHER   │ │  🚔 UNIT OFFICER │  │
│    │  Command Center  │ │  Field Responder │  │
│    └──────────────────┘ └──────────────────┘  │
│                                               │
│    ─── IF DISPATCHER: ───────────────────     │
│    Select station: [Central Dispatch ▾]       │
│                                               │
│    ─── IF UNIT OFFICER: ─────────────────     │
│    Select department:                         │
│    [🛡️ Patrol] [🔥 Fire] [🚑 Medical] [⚠️ Haz] │
│                                               │
│    Select your unit:                          │
│    [P-1] [P-2] [P-3] [P-4]                   │
│    (only shows available units for dept)      │
│                                               │
│    [  Enter Dashboard  →  ]                   │
│                                               │
└──────────────────────────────────────────────┘
```

**On login:**
- Role + unit selection saved to session state
- If Unit Officer: their unit status in libSQL updates to `on_duty`
- If Unit Officer: their unit dot appears on the map for everyone
- Header shows role: "📡 Dispatcher — Central" or "🛡️ Patrol P-2 — On Duty"

---

## Permission Matrix

| Action | Dispatcher | Unit Officer (own incident) | Unit Officer (other's incident) | Unit Officer (unassigned incident) |
|--------|-----------|---------------------------|-------------------------------|----------------------------------|
| See on map | ✅ | ✅ | ✅ (marker only) | ✅ (marker + basic card) |
| View basic info (type, location, severity) | ✅ | ✅ | ✅ | ✅ |
| View full detail (transcript, Q&A, report) | ✅ | ✅ | ❌ | ❌ |
| Take / accept (assign self) | ❌ | ✅ (self only) | ❌ | ✅ (assigns self) |
| Assign other units | ✅ | ❌ | ❌ | ❌ |
| Ask caller questions | ✅ | ✅ | ❌ | ❌ |
| Escalate | ✅ | ✅ | ❌ | ❌ |
| Complete & close | ✅ | ✅ | ❌ | ❌ |
| Call for backup (alert) | ❌ | ✅ | ❌ | ❌ |
| See backup alerts | ✅ | ✅ (if nearby) | ✅ (if nearby) | ✅ (if nearby) |
| View resolved history | ✅ | ✅ (own only) | ❌ | ❌ |

---

## Incident Card States by Role

### Unassigned Incident (No one has taken it yet)

**Dispatcher sees:**
```
┌────────────────────────────────────┐
│ 🔴 4  Vehicle Collision            │
│      5th & Main Street             │
│      👤 2 injuries  ⚠️ Hazards     │
│      ● UNASSIGNED • 2m ago         │
│                                     │
│   [📋 View Detail]  [🚔 Assign Unit]│
└────────────────────────────────────┘
```
- "View Detail" → opens full transcript, report, Q&A
- "Assign Unit" → opens unit selector dropdown (can pick any available unit)

**Unit Officer sees:**
```
┌────────────────────────────────────┐
│ 🔴 4  Vehicle Collision            │
│      5th & Main Street             │
│      👤 2 injuries  ⚠️ Hazards     │
│      ● UNASSIGNED • 2m ago         │
│                                     │
│        [✅ I'll Respond]            │
└────────────────────────────────────┘
```
- Shows basic info only (type, location, severity, injuries, hazards)
- NO transcript, NO Q&A, NO full report yet
- "I'll Respond" → assigns themselves, status changes to DISPATCHED
- Button only shows if the unit's department matches recommended_response OR if it's a general call
- Once clicked → they get full access to this incident

---

### Assigned Incident — MY Incident (Unit Officer who took it)

This is the full detail view. Only shows AFTER the unit takes the job.

```
┌────────────────────────────────────────┐
│  [← Back]  MY INCIDENT #abc-123       │
│  🔴 VEHICLE COLLISION                  │
│  ● DISPATCHED — You (P-2) responding  │
│                                         │
│  ┌─ AI REPORT ───────────────────────┐ │
│  │ Type: Accident — Vehicle           │ │
│  │ Location: 5th & Main Street        │ │
│  │ Severity: ████░ HIGH (4/5)         │ │
│  │ Injuries: 2 reported               │ │
│  │ Hazards: ⚠️ Fuel leak              │ │
│  │ Response: 🛡️ + 🚑                  │ │
│  └────────────────────────────────────┘ │
│                                         │
│  ┌─ LIVE TRANSCRIPT ─────────────────┐ │
│  │ 🤖 911, what's your emergency?    │ │
│  │ 👤 Car crash at 5th and Main...   │ │
│  │ ...                                │ │
│  └────────────────────────────────────┘ │
│                                         │
│  ┌─ ASK CALLER ──────────────────────┐ │
│  │ [Ask the caller a question... ] [→]│ │
│  └────────────────────────────────────┘ │
│                                         │
│  [🆘 CALL BACKUP]  [🚨 ESCALATE]      │
│                                         │
│  [⬜ COMPLETE & CLOSE]                  │
└────────────────────────────────────────┘
```

**Buttons available:**
- **Ask Caller** — types question, Sonic asks the caller, answer streams back
- **Call Backup** — sends alert to nearby units (see backup system below)
- **Escalate** — requests additional department types (e.g., "I need fire here too")
- **Complete & Close** — generates AI summary, officer reviews, saves

---

### Assigned Incident — SOMEONE ELSE'S Incident (Unit Officer)

```
┌────────────────────────────────────┐
│ 🟡 3  Medical Emergency            │
│      12 Oak Avenue                  │
│      Responding: Medical M-1        │
│      ● EN ROUTE • 5m ago           │
│                                     │
│      (View only — not your job)    │
└────────────────────────────────────┘
```

- Map marker visible, basic info visible
- NO transcript, NO Q&A, NO action buttons
- Shows which unit is responding
- If that unit calls for backup → this officer might see the backup alert

---

### Assigned Incident — Dispatcher View (ANY Incident)

Dispatcher always has full access to everything:

```
┌────────────────────────────────────────┐
│  INCIDENT #abc-123                      │
│  🔴 VEHICLE COLLISION                   │
│  Responding: Patrol P-2                │
│  ● DISPATCHED • 2m ago                 │
│                                         │
│  ┌─ AI REPORT ──────────────────────┐  │
│  │ [full extraction data]            │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌─ LIVE TRANSCRIPT ────────────────┐  │
│  │ [full transcript]                 │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌─ ASK CALLER ─────────────────────┐  │
│  │ [Ask the caller...          ] [→] │  │
│  └───────────────────────────────────┘  │
│                                         │
│  [🚔 Assign More Units]  [🚨 ESCALATE] │
│                                         │
│  [⬜ COMPLETE & CLOSE]                   │
└────────────────────────────────────────┘
```

**Dispatcher differences from Unit Officer:**
- "Assign More Units" instead of "Call Backup" — dispatcher picks units from a list
- Can access ANY incident, not just their own
- Can complete/escalate ANY incident

---

## The Backup / Alert System (Unit Officer → Other Units)

This is the key difference from a dispatcher. A unit officer can't assign others, but CAN send an alert requesting help.

### How It Works

```
Officer P-2 is responding to an incident at 5th & Main
  ↓
Situation gets dangerous — P-2 clicks "🆘 CALL BACKUP"
  ↓
Modal appears:
  ┌──────────────────────────────────────┐
  │  🆘 REQUEST BACKUP                   │
  │                                       │
  │  What do you need?                   │
  │  [☑ More patrol units]              │
  │  [☐ Fire department]                │
  │  [☑ Medical / EMS]                  │
  │                                       │
  │  Urgency:                            │
  │  [🟡 Routine] [🟠 Urgent] [🔴 EMRG] │
  │                                       │
  │  Brief message (optional):           │
  │  [Suspect armed, need backup ASAP ]  │
  │                                       │
  │  [Cancel]        [🆘 Send Alert]     │
  └──────────────────────────────────────┘
  ↓
POST /dispatch/backup-request
{
  incident_id: "abc-123",
  requesting_unit: "patrol-2",
  requested_types: ["patrol", "medical"],
  urgency: "emergency",
  message: "Suspect armed, need backup ASAP"
}
  ↓
Backend processes:
  1. Finds all on-duty units within radius
  2. Filters by requested types
  3. Pushes SSE event: backup_requested
  ↓
OTHER Unit Officers see a BACKUP ALERT:
```

### What Nearby Units See

When a backup alert comes in, all matching nearby on-duty units see a notification banner:

```
┌──────────────────────────────────────────────────────────────────┐
│ 🆘 BACKUP REQUEST from Patrol P-2                                │
│ Vehicle Collision at 5th & Main Street                           │
│ "Suspect armed, need backup ASAP"                                │
│ 🔴 EMERGENCY  •  0.4 mi away                                    │
│                                                                   │
│         [✅ I'll Respond]         [❌ Dismiss]                    │
└──────────────────────────────────────────────────────────────────┘
```

**This appears as:**
- A persistent notification bar at the top of the dashboard (not a toast — stays until dismissed)
- Also: the incident marker on the map pulses with a special "🆘" ring animation
- Also: a sound/vibration alert if on mobile

**If the unit clicks "I'll Respond":**
- They're added to the incident as a secondary responder
- They get full access to the incident detail (transcript, Q&A, etc.)
- The original unit (P-2) sees "P-4 is responding to your backup request"
- Dispatcher also sees all of this

**If the unit clicks "Dismiss":**
- Alert goes away for them
- No action taken
- Logged for audit

### What the Dispatcher Sees

Dispatcher sees backup requests as a special SSE event and can:
- See which unit requested backup and why
- See which units are being alerted
- Manually assign additional units if no one responds within X seconds
- Override and force-assign if it's critical

---

## SSE Events — Role Additions

```typescript
// New events for role-based features:

// Backup system
| { type: 'backup_requested'; data: {
    incident_id: string;
    requesting_unit: string;
    requested_types: Department[];
    urgency: 'routine' | 'urgent' | 'emergency';
    message: string;
    target_units: string[];           // Units being alerted
  }}

| { type: 'backup_accepted'; data: {
    incident_id: string;
    responding_unit: string;
    responding_unit_type: Department;
  }}

// Unit status changes
| { type: 'unit_status_change'; data: {
    unit_id: string;
    status: UnitStatus;               // 'on_duty', 'dispatched', 'en_route', etc.
    assigned_incident: string | null;
  }}
```

---

## REST Endpoints — Role Additions

### `POST /dispatch/take` (Unit Officer only)

Officer takes an unassigned incident. Assigns themselves.

```typescript
// Request:
{
  incident_id: string;
  unit_id: string;          // Their own unit (from session)
}

// Validation:
// - unit_id must match logged-in user's unit
// - incident must be unassigned (status: 'active' or 'classified')
// - unit must be 'available' or 'on_duty'

// Processing:
// 1. Update incident: status → 'dispatched', assigned_units → [unit_id]
// 2. Update unit: status → 'dispatched', assigned_incident → incident_id
// 3. Insert into incident_units table
// 4. Inject dispatch message into Sonic session (department-specific)
// 5. Push SSE: unit_dispatched + status_change

// Response:
{ status: 'dispatched', dispatch_message: "Police officers are on their way..." }
```

### `POST /dispatch/backup-request` (Unit Officer only)

Officer requests backup from nearby units.

```typescript
// Request:
{
  incident_id: string;
  requesting_unit: string;
  requested_types: Department[];
  urgency: 'routine' | 'urgent' | 'emergency';
  message?: string;
}

// Validation:
// - requesting_unit must match logged-in user
// - requesting_unit must be assigned to this incident

// Processing:
// 1. Find on-duty units within radius, matching requested types
// 2. Exclude units already assigned to other incidents
// 3. Log to dispatch_actions table
// 4. Push SSE: backup_requested (targeted to nearby units + all dispatchers)

// Response:
{
  status: 'alert_sent';
  alerted_units: string[];       // Unit IDs that received the alert
}
```

### `POST /dispatch/backup-respond` (Unit Officer only)

Another unit responds to a backup request.

```typescript
// Request:
{
  incident_id: string;
  responding_unit: string;
}

// Validation:
// - responding_unit must match logged-in user
// - responding_unit must be available (not on another job)

// Processing:
// 1. Add unit to incident_units table as secondary responder
// 2. Update unit status → 'dispatched'
// 3. Push SSE: backup_accepted
// 4. Inject into Sonic: "Additional units are en route" (if call still active)

// Response:
{ status: 'responding', incident_id: string }
```

### `POST /dispatch/assign` (Dispatcher only)

Dispatcher assigns any unit to any incident.

```typescript
// Request:
{
  incident_id: string;
  unit_ids: string[];
  officer_id: string;        // Dispatcher's ID
}

// Validation:
// - logged-in user must have role 'dispatcher'
// - all units must be available

// Processing:
// Same as existing accept flow but allows assigning multiple units
// Dispatcher can assign units that don't match their department
```

---

## Header — Role Indicator

```
DISPATCHER:
┌──────────────────────────────────────────────────────────────┐
│ 🚨 RAPIDRESPONSE │ 📡 Dispatcher — Central │ 🔴 LIVE │ ...  │
└──────────────────────────────────────────────────────────────┘

UNIT OFFICER:
┌──────────────────────────────────────────────────────────────┐
│ 🚨 RAPIDRESPONSE │ 🛡️ Patrol P-2 — On Duty │ 🔴 LIVE │ ... │
└──────────────────────────────────────────────────────────────┘
```

Unit Officer header also shows:
- Their current status: "Available" / "Responding to Incident #abc" / "On Scene"
- A quick toggle: "Go Off Duty" (sets their unit as unavailable)

---

## Map Differences by Role

### Both Roles See:
- All active incident markers (pulsing, severity-colored)
- All on-duty unit markers (department-colored dots)
- The incident ticker (stock-terminal style marquee)
- ArcGIS dark basemap
- Route polylines for dispatched units heading to incidents

### Dispatcher Also Sees:
- Can click ANY incident for full detail
- Can drag-assign units (or click assign in the panel)
- Sees a "unit pool" overlay showing all available units with department/distance

### Unit Officer Also Sees:
- Their OWN position highlighted (larger dot with pulsing ring)
- Route from THEIR position to their assigned incident
- Backup alerts as pulsing 🆘 rings on the map
- Cannot click into full detail of other units' incidents

---

## Incident Lifecycle — Role Actions at Each Stage

```
STAGE: UNASSIGNED (new call, no one has taken it)
┌─────────────────────────────────────────────────┐
│ Dispatcher:  [View Detail] [Assign Unit]        │
│ Unit Officer: [I'll Respond]                    │
│ (basic info only for unit officer)              │
└─────────────────────────────────────────────────┘
        │
        ▼ (someone takes it)

STAGE: DISPATCHED (unit assigned, heading to scene)
┌─────────────────────────────────────────────────┐
│ Dispatcher:  [Full Detail] [Assign More] [Esc.] [Complete] │
│ Assigned Unit: [Full Detail] [Ask Q] [Backup] [Esc.] [Complete] │
│ Other Units: (read-only marker, basic info)     │
└─────────────────────────────────────────────────┘
        │
        ▼ (unit arrives)

STAGE: ON SCENE
┌─────────────────────────────────────────────────┐
│ Dispatcher:  [Full Detail] [Assign More] [Complete] │
│ Assigned Unit: [Full Detail] [Ask Q] [Backup] [Complete] │
│ Other Units: (read-only)                        │
└─────────────────────────────────────────────────┘
        │
        ▼ (unit or dispatcher closes)

STAGE: COMPLETED
┌─────────────────────────────────────────────────┐
│ Dispatcher:  [View Report] (in resolved list)   │
│ Assigned Unit: [View Report] (in their history) │
│ Other Units: (marker removed, not visible)      │
└─────────────────────────────────────────────────┘
```

---

## Button Visibility Rules (Summary)

### For UNIT OFFICER:

| Button | Visible When | Condition |
|--------|-------------|-----------|
| **I'll Respond** | Incident is UNASSIGNED | Unit is available, not already on a job |
| **Ask Caller** | Incident is MINE and DISPATCHED/ON_SCENE | Sonic session still active |
| **🆘 Call Backup** | Incident is MINE and DISPATCHED/ON_SCENE | Always available on own incident |
| **Escalate** | Incident is MINE and DISPATCHED/ON_SCENE | Always available on own incident |
| **Complete & Close** | Incident is MINE and DISPATCHED/ON_SCENE | Always available on own incident |
| **Respond to Backup** | Backup alert received | Unit is available, alert is for nearby |
| **Assign Unit** | NEVER | Dispatcher-only action |
| **Assign More** | NEVER | Dispatcher-only action |

### For DISPATCHER:

| Button | Visible When | Condition |
|--------|-------------|-----------|
| **View Detail** | ANY incident, ANY stage | Always |
| **Assign Unit** | Incident is UNASSIGNED | Available units exist |
| **Assign More** | Incident is DISPATCHED+ | Additional available units exist |
| **Ask Caller** | ANY assigned incident | Sonic session still active |
| **Escalate** | ANY incident DISPATCHED+ | Always |
| **Complete & Close** | ANY incident DISPATCHED+ | Always |
| **I'll Respond** | NEVER | Dispatcher is not a field unit |
| **Call Backup** | NEVER | Dispatcher assigns directly instead |

---

## Session State

```typescript
// Frontend session context (React Context or Zustand)

type UserSession = {
  user: {
    id: string;
    name: string;
    email: string;
    avatar: string;           // From Google profile
  };
  role: 'dispatcher' | 'unit_officer';
  // Only set if role === 'unit_officer':
  unit?: {
    id: string;               // "patrol-2"
    type: Department;         // "patrol"
    label: string;            // "P-2"
  };
  // Only set if role === 'dispatcher':
  station?: {
    id: string;
    name: string;             // "Central Dispatch"
  };
};

// Permission helper:
function canActOnIncident(session: UserSession, incident: Incident): boolean {
  if (session.role === 'dispatcher') return true;
  if (session.role === 'unit_officer') {
    return incident.assigned_units.includes(session.unit?.id ?? '');
  }
  return false;
}

function canTakeIncident(session: UserSession, incident: Incident): boolean {
  if (session.role !== 'unit_officer') return false;
  if (incident.status !== 'active' && incident.status !== 'classified') return false;
  if (incident.assigned_units.length > 0) return false; // Already taken
  // Check if unit is available (not on another job)
  return session.unit?.id != null;
}

function canViewFullDetail(session: UserSession, incident: Incident): boolean {
  if (session.role === 'dispatcher') return true;
  return incident.assigned_units.includes(session.unit?.id ?? '');
}
```

---

## Backend — Role Validation Middleware

Every dispatch route must check the caller's role:

```typescript
// In dispatchRoutes.ts:

function requireRole(role: 'dispatcher' | 'unit_officer', session: UserSession): void {
  if (session.role !== role) {
    throw new Error(`Action requires role: ${role}`);
  }
}

function requireOwnIncident(session: UserSession, incident: Incident): void {
  if (session.role === 'dispatcher') return; // Dispatchers can act on anything
  if (!incident.assigned_units.includes(session.unit?.id ?? '')) {
    throw new Error('You are not assigned to this incident');
  }
}

function requireOwnUnit(session: UserSession, unitId: string): void {
  if (session.role === 'dispatcher') return;
  if (session.unit?.id !== unitId) {
    throw new Error('You can only assign yourself');
  }
}

// Route validation:
// POST /dispatch/take    → requireRole('unit_officer') + requireOwnUnit
// POST /dispatch/assign  → requireRole('dispatcher')
// POST /dispatch/backup-request → requireRole('unit_officer') + requireOwnIncident
// POST /dispatch/question → requireOwnIncident (both roles)
// POST /dispatch/escalate → requireOwnIncident (both roles)
// POST /dispatch/complete → requireOwnIncident (both roles)
```

---

## libSQL Migration Addition

```sql
-- Add to 004_dispatch_tables.sql or new 005_roles.sql

-- Backup requests log
CREATE TABLE IF NOT EXISTS backup_requests (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  requesting_unit TEXT NOT NULL,
  requested_types TEXT NOT NULL,      -- JSON array: ["patrol", "medical"]
  urgency TEXT NOT NULL,              -- 'routine', 'urgent', 'emergency'
  message TEXT,
  alerted_units TEXT,                 -- JSON array of unit IDs alerted
  responded_units TEXT,               -- JSON array of unit IDs that accepted
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

-- User sessions (track who is logged in as what)
CREATE TABLE IF NOT EXISTS active_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,                  -- 'dispatcher' or 'unit_officer'
  unit_id TEXT,                        -- NULL for dispatchers
  station_id TEXT,                     -- NULL for unit officers
  logged_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_heartbeat TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Notes for Coding Agent

1. **Role check on EVERY dispatch route.** Never trust the frontend. Always validate role on the backend.
2. **Unit officer can only see full detail of incidents they're assigned to.** If `canViewFullDetail()` returns false, return only basic fields (type, location, severity, status) — not transcript, not Q&A.
3. **"I'll Respond" = POST /dispatch/take** — this is separate from dispatcher's "Assign Unit" (POST /dispatch/assign). Different endpoints, different permissions.
4. **Backup alerts are targeted via SSE.** Don't send backup alerts to ALL units — only to on-duty units within a radius that match the requested department types. But always send to all dispatchers.
5. **When a unit goes off duty,** update their unit status in libSQL, push SSE `unit_status_change`, and if they were assigned to an incident, flag it as "unit unavailable" for dispatcher attention.
6. **The ticker shows ALL incidents to ALL roles.** It's read-only awareness, not an action surface.
