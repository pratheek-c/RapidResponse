-- Migration 003: Add caller_address column to incidents
-- Stores the reverse-geocoded human-readable address of the caller.
-- Uses "" as default so existing rows are not NULL.

ALTER TABLE incidents
  ADD COLUMN caller_address TEXT NOT NULL DEFAULT '';
