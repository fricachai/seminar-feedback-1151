ALTER TABLE presentations ADD COLUMN kind TEXT NOT NULL DEFAULT 'report';
CREATE INDEX presentations_student_kind ON presentations(student_id, kind, active);
