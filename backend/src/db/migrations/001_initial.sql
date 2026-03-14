-- Migration 001: Initial schema
-- Creates core tables for RapidResponse.ai

CREATE TABLE IF NOT EXISTS incidents (
  id              TEXT PRIMARY KEY,
  caller_id       TEXT NOT NULL,
  caller_location TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'dispatched', 'resolved', 'cancelled')),
  type            TEXT          CHECK (type IN ('fire', 'medical', 'police', 'traffic',
                                                'hazmat', 'search_rescue', 'other')),
  priority        TEXT          CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  summary         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  resolved_at     TEXT,
  s3_audio_prefix     TEXT,
  s3_transcript_key   TEXT
);

CREATE TABLE IF NOT EXISTS transcription_turns (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  role        TEXT NOT NULL CHECK (role IN ('caller', 'agent')),
  text        TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id                  TEXT PRIMARY KEY,
  unit_code           TEXT NOT NULL UNIQUE,
  type                TEXT NOT NULL CHECK (type IN ('fire', 'ems', 'police', 'hazmat', 'rescue')),
  status              TEXT NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'dispatched', 'on_scene', 'returning')),
  current_incident_id TEXT REFERENCES incidents(id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dispatches (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT NOT NULL REFERENCES incidents(id),
  unit_id      TEXT NOT NULL REFERENCES units(id),
  dispatched_at TEXT NOT NULL,
  arrived_at   TEXT,
  cleared_at   TEXT
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
