-- Migration 002: Add indexes for common query patterns

CREATE INDEX IF NOT EXISTS idx_incidents_status
  ON incidents(status);

CREATE INDEX IF NOT EXISTS idx_incidents_created_at
  ON incidents(created_at);

CREATE INDEX IF NOT EXISTS idx_incidents_type_priority
  ON incidents(type, priority);

CREATE INDEX IF NOT EXISTS idx_transcription_turns_incident_id
  ON transcription_turns(incident_id);

CREATE INDEX IF NOT EXISTS idx_transcription_turns_created_at
  ON transcription_turns(created_at);

CREATE INDEX IF NOT EXISTS idx_units_status
  ON units(status);

CREATE INDEX IF NOT EXISTS idx_units_type
  ON units(type);

CREATE INDEX IF NOT EXISTS idx_dispatches_incident_id
  ON dispatches(incident_id);

CREATE INDEX IF NOT EXISTS idx_dispatches_unit_id
  ON dispatches(unit_id);
