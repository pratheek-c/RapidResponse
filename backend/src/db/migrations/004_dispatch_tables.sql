-- Migration 004: Dispatch tables + expanded incident status
--
-- Changes:
--   1. Recreate incidents table with expanded status CHECK constraint and
--      new dispatch columns (accepted_at, completed_at, escalated, officer_id, assigned_units).
--      All existing rows are migrated.
--   2. Create dispatch_actions audit log table.
--   3. Create incident_units junction table.
--   4. Create dispatch_questions table.
--   5. Add covering indexes for new tables.

-- ---------------------------------------------------------------------------
-- 1. Recreate incidents with expanded schema
-- ---------------------------------------------------------------------------

-- Rename existing table
ALTER TABLE incidents RENAME TO incidents_old;

-- Create new table with full schema
CREATE TABLE incidents (
  id                TEXT    PRIMARY KEY,
  caller_id         TEXT    NOT NULL,
  caller_location   TEXT    NOT NULL,
  caller_address    TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL DEFAULT 'active'
                    CHECK (status IN (
                      'active','classified','dispatched','en_route',
                      'on_scene','completed','resolved','cancelled'
                    )),
  type              TEXT    CHECK (type IN (
                      'fire','medical','police','traffic',
                      'hazmat','search_rescue','other'
                    )),
  priority          TEXT    CHECK (priority IN ('P1','P2','P3','P4')),
  summary           TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  resolved_at       TEXT,
  s3_audio_prefix   TEXT,
  s3_transcript_key TEXT,
  -- New dispatch columns
  accepted_at       TEXT,
  completed_at      TEXT,
  escalated         INTEGER NOT NULL DEFAULT 0,
  officer_id        TEXT,
  assigned_units    TEXT    -- JSON array of unit_ids
);

-- Copy all existing rows (new columns default to NULL/0)
INSERT INTO incidents (
  id, caller_id, caller_location, caller_address,
  status, type, priority, summary,
  created_at, updated_at, resolved_at,
  s3_audio_prefix, s3_transcript_key,
  accepted_at, completed_at, escalated, officer_id, assigned_units
)
SELECT
  id, caller_id, caller_location, caller_address,
  -- Map legacy 'resolved' → 'completed' so it satisfies new CHECK
  CASE status WHEN 'resolved' THEN 'completed' ELSE status END,
  type, priority, summary,
  created_at, updated_at, resolved_at,
  s3_audio_prefix, s3_transcript_key,
  NULL, NULL, 0, NULL, NULL
FROM incidents_old;

DROP TABLE incidents_old;

-- ---------------------------------------------------------------------------
-- 2. Dispatch actions audit log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dispatch_actions (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT NOT NULL,
  action_type  TEXT NOT NULL
               CHECK (action_type IN ('accept','escalate','question','complete','save_report')),
  officer_id   TEXT,
  payload      TEXT,  -- JSON string for action-specific data
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

-- ---------------------------------------------------------------------------
-- 3. Units assigned to incidents
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS incident_units (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT NOT NULL,
  unit_id      TEXT NOT NULL,
  unit_type    TEXT NOT NULL
               CHECK (unit_type IN ('fire','ems','police','hazmat','rescue')),
  status       TEXT NOT NULL DEFAULT 'dispatched'
               CHECK (status IN ('dispatched','en_route','on_scene')),
  dispatched_at TEXT NOT NULL DEFAULT (datetime('now')),
  arrived_at   TEXT,
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

-- ---------------------------------------------------------------------------
-- 4. Dispatch Q&A log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dispatch_questions (
  id               TEXT PRIMARY KEY,
  incident_id      TEXT NOT NULL,
  officer_id       TEXT,
  question         TEXT NOT NULL,
  refined_question TEXT,
  answer           TEXT,
  asked_at         TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at      TEXT,
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

-- ---------------------------------------------------------------------------
-- 5. Indexes for new tables
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_incidents_status_v2
  ON incidents(status);

CREATE INDEX IF NOT EXISTS idx_incidents_completed_at
  ON incidents(completed_at);

CREATE INDEX IF NOT EXISTS idx_dispatch_actions_incident_id
  ON dispatch_actions(incident_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_actions_created_at
  ON dispatch_actions(created_at);

CREATE INDEX IF NOT EXISTS idx_incident_units_incident_id
  ON incident_units(incident_id);

CREATE INDEX IF NOT EXISTS idx_incident_units_unit_id
  ON incident_units(unit_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_questions_incident_id
  ON dispatch_questions(incident_id);
