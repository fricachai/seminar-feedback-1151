PRAGMA foreign_keys = ON;

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  title TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  modified_at TEXT NOT NULL,
  title_source TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE INDEX papers_student ON papers(student_id, active);

CREATE TABLE feedback (
  class_id TEXT NOT NULL,
  presenter_id TEXT NOT NULL REFERENCES students(id),
  reviewer_id TEXT NOT NULL REFERENCES students(id),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 5000),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (class_id, presenter_id, reviewer_id),
  CHECK (presenter_id <> reviewer_id)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiration ON sessions(expires_at);

CREATE TABLE login_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_end INTEGER NOT NULL
);

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
