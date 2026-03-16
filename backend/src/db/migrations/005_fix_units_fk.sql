-- Migration 005: Fix units.current_incident_id FK
--
-- During migration 004, the units table was created while the incidents table
-- was temporarily renamed to incidents_old, leaving the FK pointing to the
-- now-dropped incidents_old table.  This migration recreates units with the
-- FK correctly referencing incidents(id).

-- Preserve existing rows
ALTER TABLE units RENAME TO units_old;

CREATE TABLE units (
  id                  TEXT PRIMARY KEY,
  unit_code           TEXT NOT NULL UNIQUE,
  type                TEXT NOT NULL
                      CHECK (type IN ('fire','ems','police','hazmat','rescue')),
  status              TEXT NOT NULL DEFAULT 'available'
                      CHECK (status IN ('available','dispatched','on_scene','returning')),
  current_incident_id TEXT REFERENCES incidents(id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Copy all rows; NULLify any stale incident references that no longer exist
INSERT INTO units (id, unit_code, type, status, current_incident_id, created_at, updated_at)
SELECT
  id, unit_code, type, status,
  CASE
    WHEN current_incident_id IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM incidents WHERE incidents.id = units_old.current_incident_id)
      THEN current_incident_id
    ELSE NULL
  END,
  created_at, updated_at
FROM units_old;

DROP TABLE units_old;

-- Restore indexes
CREATE INDEX IF NOT EXISTS idx_units_status
  ON units(status);

CREATE INDEX IF NOT EXISTS idx_units_current_incident_id
  ON units(current_incident_id);
