-- Migration 007: Add human-readable CAD incident number
-- Format: INC-YYYYMMDD-NNNN (e.g. INC-20260316-0001)
ALTER TABLE incidents ADD COLUMN cad_number TEXT;
