-- Migration 009: Role-based tables for Dispatcher vs Unit Officer

-- Backup requests log
CREATE TABLE IF NOT EXISTS backup_requests (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  requesting_unit TEXT NOT NULL,
  requested_types TEXT NOT NULL,   -- JSON array: ["patrol", "medical"]
  urgency TEXT NOT NULL             CHECK (urgency IN ('routine', 'urgent', 'emergency')),
  message TEXT,
  alerted_units TEXT,              -- JSON array of unit IDs alerted
  responded_units TEXT,            -- JSON array of unit IDs that accepted
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

-- Active sessions (who is logged in as what role)
CREATE TABLE IF NOT EXISTS active_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL               CHECK (role IN ('dispatcher', 'unit_officer')),
  unit_id TEXT,                    -- NULL for dispatchers
  station_id TEXT,                 -- NULL for unit officers
  logged_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_heartbeat TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backup_requests_incident_id
  ON backup_requests(incident_id);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user_id
  ON active_sessions(user_id);
