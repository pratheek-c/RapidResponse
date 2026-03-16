-- Migration 008: Add covert_distress flag to incidents
ALTER TABLE incidents ADD COLUMN covert_distress INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_incidents_covert_distress
  ON incidents(covert_distress);
