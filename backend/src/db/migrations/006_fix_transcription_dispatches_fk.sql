-- Migration 006: Fix transcription_turns and dispatches FK references
--
-- Both tables were created while incidents/units were temporarily renamed
-- during migration 004, leaving broken REFERENCES to incidents_old / units_old.

-- -----------------------------------------------------------------------
-- 1. transcription_turns
-- -----------------------------------------------------------------------

ALTER TABLE transcription_turns RENAME TO transcription_turns_old;

CREATE TABLE transcription_turns (
  id           TEXT    PRIMARY KEY,
  incident_id  TEXT    NOT NULL REFERENCES incidents(id),
  role         TEXT    NOT NULL CHECK (role IN ('caller','agent')),
  text         TEXT    NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  created_at   TEXT    NOT NULL
);

INSERT INTO transcription_turns (id, incident_id, role, text, timestamp_ms, created_at)
SELECT id, incident_id, role, text, timestamp_ms, created_at
FROM transcription_turns_old;

DROP TABLE transcription_turns_old;

CREATE INDEX IF NOT EXISTS idx_transcription_turns_incident_id
  ON transcription_turns(incident_id);

-- -----------------------------------------------------------------------
-- 2. dispatches
-- -----------------------------------------------------------------------

ALTER TABLE dispatches RENAME TO dispatches_old;

CREATE TABLE dispatches (
  id            TEXT PRIMARY KEY,
  incident_id   TEXT NOT NULL REFERENCES incidents(id),
  unit_id       TEXT NOT NULL REFERENCES units(id),
  dispatched_at TEXT NOT NULL,
  arrived_at    TEXT,
  cleared_at    TEXT
);

INSERT INTO dispatches (id, incident_id, unit_id, dispatched_at, arrived_at, cleared_at)
SELECT id, incident_id, unit_id, dispatched_at, arrived_at, cleared_at
FROM dispatches_old;

DROP TABLE dispatches_old;

CREATE INDEX IF NOT EXISTS idx_dispatches_incident_id
  ON dispatches(incident_id);

CREATE INDEX IF NOT EXISTS idx_dispatches_unit_id
  ON dispatches(unit_id);
