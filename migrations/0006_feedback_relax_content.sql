PRAGMA foreign_keys = OFF;

CREATE TABLE feedback_new (
  class_id TEXT NOT NULL,
  presenter_id TEXT NOT NULL REFERENCES students(id),
  reviewer_id TEXT NOT NULL REFERENCES students(id),
  content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 3000),
  takeaway TEXT NOT NULL DEFAULT '' CHECK (length(takeaway) <= 3000),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (class_id, presenter_id, reviewer_id),
  CHECK (presenter_id <> reviewer_id),
  CHECK (length(content) > 0 OR length(takeaway) > 0)
);

INSERT INTO feedback_new (class_id, presenter_id, reviewer_id, content, takeaway, revision, updated_at)
SELECT class_id, presenter_id, reviewer_id, content, takeaway, revision, updated_at FROM feedback;

DROP TABLE feedback;
ALTER TABLE feedback_new RENAME TO feedback;

PRAGMA foreign_keys = ON;
