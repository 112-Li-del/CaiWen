CREATE TABLE daily_behavior (
 id INTEGER PRIMARY KEY,
 student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
 observed_date TEXT NOT NULL CHECK(length(observed_date)=10 AND date(observed_date) IS NOT NULL AND date(observed_date,'+0 days')=observed_date),
 scheduled_sessions INTEGER CHECK(scheduled_sessions>=0),
 attended_sessions INTEGER CHECK(attended_sessions>=0),
 study_hours REAL CHECK(study_hours BETWEEN 0 AND 24),
 sleep_hours REAL CHECK(sleep_hours BETWEEN 0 AND 24),
 internet_hours REAL CHECK(internet_hours BETWEEN 0 AND 24),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('school_record','staff_entry','self_report','demo')),
 UNIQUE(student_id,observed_date),
 CHECK((scheduled_sessions IS NULL AND attended_sessions IS NULL) OR
       (scheduled_sessions IS NOT NULL AND attended_sessions IS NOT NULL AND attended_sessions<=scheduled_sessions))
);
CREATE INDEX ix_daily_semester_date ON daily_behavior(semester_id,observed_date,student_id);
CREATE TRIGGER daily_semester_insert BEFORE INSERT ON daily_behavior
 WHEN NOT EXISTS(SELECT 1 FROM semesters WHERE id=NEW.semester_id AND NEW.observed_date BETWEEN start_date AND end_date)
 BEGIN SELECT RAISE(ABORT,'observation date outside semester'); END;
CREATE TRIGGER daily_semester_update BEFORE UPDATE ON daily_behavior
 WHEN NOT EXISTS(SELECT 1 FROM semesters WHERE id=NEW.semester_id AND NEW.observed_date BETWEEN start_date AND end_date)
 BEGIN SELECT RAISE(ABORT,'observation date outside semester'); END;
CREATE TRIGGER revision_daily_insert AFTER INSERT ON daily_behavior BEGIN UPDATE portrait_meta SET data_revision=data_revision+1; END;
CREATE TRIGGER revision_daily_update AFTER UPDATE ON daily_behavior BEGIN UPDATE portrait_meta SET data_revision=data_revision+1; END;
CREATE TRIGGER revision_daily_delete AFTER DELETE ON daily_behavior BEGIN UPDATE portrait_meta SET data_revision=data_revision+1; END;
CREATE TABLE demo_datasets (
 name TEXT PRIMARY KEY, seed INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
