ALTER TABLE feedback ADD COLUMN takeaway TEXT NOT NULL DEFAULT '';

CREATE TABLE teacher_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX teacher_sessions_expiration ON teacher_sessions(expires_at);
