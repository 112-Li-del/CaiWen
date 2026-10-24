-- Version 1. No accounts/passwords, questionnaires, exercise days, or GPA.
CREATE TABLE portrait_meta (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 data_revision INTEGER NOT NULL DEFAULT 0 CHECK(data_revision >= 0)
);
INSERT INTO portrait_meta(singleton) VALUES(1);
CREATE TABLE colleges (
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK(length(trim(code)) > 0),
 name TEXT NOT NULL CHECK(length(trim(name)) > 0)
);
CREATE TABLE majors (
 id INTEGER PRIMARY KEY, college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
 code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, UNIQUE(id, college_id)
);
CREATE TABLE classes (
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 major_id INTEGER NOT NULL REFERENCES majors(id) ON DELETE RESTRICT,
 admission_year INTEGER NOT NULL CHECK(admission_year BETWEEN 1900 AND 2200)
);
CREATE TABLE semesters (
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 start_date TEXT NOT NULL, end_date TEXT NOT NULL,
 CHECK(length(start_date)=10 AND length(end_date)=10 AND
       date(start_date,'+0 days')=start_date AND date(end_date,'+0 days')=end_date AND
       date(start_date) IS NOT NULL AND date(end_date) IS NOT NULL AND start_date <= end_date)
);
CREATE TABLE students (
 id INTEGER PRIMARY KEY, student_no TEXT NOT NULL UNIQUE CHECK(length(trim(student_no)) > 0),
 name TEXT NOT NULL CHECK(length(trim(name)) > 0),
 class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
 enrollment_date TEXT, graduation_date TEXT, dormitory TEXT,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','graduated','inactive')),
 CHECK(enrollment_date IS NULL OR date(enrollment_date) IS NOT NULL),
 CHECK(graduation_date IS NULL OR date(graduation_date) IS NOT NULL),
 CHECK(enrollment_date IS NULL OR graduation_date IS NULL OR enrollment_date <= graduation_date)
);
CREATE TABLE teachers (
 id INTEGER PRIMARY KEY, teacher_no TEXT NOT NULL UNIQUE CHECK(length(trim(teacher_no)) > 0),
 name TEXT NOT NULL CHECK(length(trim(name)) > 0),
 college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
-- Preserve historical class membership instead of rewriting past reports.
CREATE TABLE student_class_enrollments (
 student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
 class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
 PRIMARY KEY(student_id,semester_id)
);
CREATE INDEX ix_enrollments_class ON student_class_enrollments(class_id,semester_id);
CREATE TABLE teacher_classes (
 teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
 class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
 semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
 PRIMARY KEY(teacher_id, class_id, semester_id)
);
-- The external account is a stable CaiWen user ID, never a copied login account.
CREATE TABLE account_bindings (
 account_user_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(account_user_id)) > 0),
 student_id INTEGER UNIQUE REFERENCES students(id) ON DELETE RESTRICT,
 teacher_id INTEGER UNIQUE REFERENCES teachers(id) ON DELETE RESTRICT,
 CHECK((student_id IS NOT NULL) + (teacher_id IS NOT NULL) = 1)
);
CREATE TABLE courses (
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK(length(trim(code)) > 0),
 name TEXT NOT NULL, credits REAL NOT NULL CHECK(credits >= 0 AND credits <= 100),
 course_type TEXT, full_score REAL NOT NULL DEFAULT 100 CHECK(full_score > 0 AND full_score <= 10000)
);
CREATE TABLE import_batches (
 id INTEGER PRIMARY KEY, kind TEXT NOT NULL, source_name TEXT NOT NULL,
 source_sha256 TEXT, actor_user_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 inserted_count INTEGER NOT NULL DEFAULT 0 CHECK(inserted_count >= 0),
 updated_count INTEGER NOT NULL DEFAULT 0 CHECK(updated_count >= 0),
 skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count >= 0)
);
-- Attempts coexist; none is silently selected as the final or highest score.
CREATE TABLE grade_records (
 id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
 semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
 attempt_no INTEGER NOT NULL DEFAULT 1 CHECK(attempt_no >= 1),
 score REAL CHECK(score IS NULL OR score >= 0),
 status TEXT NOT NULL DEFAULT 'recorded' CHECK(status IN ('recorded','absent','exempt','pending')),
 source_batch_id INTEGER REFERENCES import_batches(id) ON DELETE RESTRICT,
 UNIQUE(student_id, course_id, semester_id, attempt_no),
 CHECK((status = 'recorded' AND score IS NOT NULL) OR (status <> 'recorded' AND score IS NULL))
);
CREATE TABLE grade_changes (
 id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
 grade_id INTEGER NOT NULL REFERENCES grade_records(id) ON DELETE RESTRICT,
 operation TEXT NOT NULL CHECK(operation IN ('insert','update')),
 before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
 after_json TEXT NOT NULL CHECK(json_valid(after_json)), UNIQUE(batch_id,grade_id)
);
CREATE TRIGGER grade_score_insert BEFORE INSERT ON grade_records
 WHEN NEW.score > (SELECT full_score FROM courses WHERE id=NEW.course_id)
 BEGIN SELECT RAISE(ABORT, 'score exceeds course full_score'); END;
CREATE TRIGGER grade_score_update BEFORE UPDATE ON grade_records
 WHEN NEW.score > (SELECT full_score FROM courses WHERE id=NEW.course_id)
 BEGIN SELECT RAISE(ABORT, 'score exceeds course full_score'); END;
CREATE TRIGGER course_full_score_update BEFORE UPDATE OF full_score ON courses
 WHEN EXISTS(SELECT 1 FROM grade_records WHERE course_id=NEW.id AND score > NEW.full_score)
 BEGIN SELECT RAISE(ABORT, 'full_score conflicts with existing grades'); END;
CREATE TABLE behavior_records (
 id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
 attendance_rate REAL CHECK(attendance_rate BETWEEN 0 AND 100),
 study_hours_daily REAL CHECK(study_hours_daily BETWEEN 0 AND 24),
 sleep_hours_daily REAL CHECK(sleep_hours_daily BETWEEN 0 AND 24),
 internet_hours_daily REAL CHECK(internet_hours_daily BETWEEN 0 AND 24),
 participation_value REAL, participation_scale REAL CHECK(participation_scale IN (5,10,100)),
 social_activity_value REAL CHECK(social_activity_value >= 0),
 social_activity_unit TEXT CHECK(social_activity_unit IN ('count','hours','score')),
 social_activity_period TEXT CHECK(social_activity_period IN ('week','month','semester')),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('school_record','staff_entry','self_report','demo')),
 source_batch_id INTEGER REFERENCES import_batches(id) ON DELETE RESTRICT,
 UNIQUE(student_id, semester_id),
 CHECK((participation_value IS NULL AND participation_scale IS NULL) OR
       (participation_value IS NOT NULL AND participation_scale IS NOT NULL AND participation_value BETWEEN 0 AND participation_scale)),
 CHECK((social_activity_value IS NULL AND social_activity_unit IS NULL AND social_activity_period IS NULL) OR
       (social_activity_value IS NOT NULL AND social_activity_unit IS NOT NULL AND social_activity_period IS NOT NULL))
);
CREATE TABLE tag_definitions (
 code TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('student','class')),
 value_type TEXT NOT NULL CHECK(value_type IN ('number','category')),
 rule_version INTEGER NOT NULL DEFAULT 1 CHECK(rule_version > 0),
 rule_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(rule_json)),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','active','retired')),
 UNIQUE(code, scope), UNIQUE(scope,name)
);
CREATE TABLE analysis_runs (
 id INTEGER PRIMARY KEY, semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL, rule_version TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','succeeded','failed')),
 started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 completed_at TEXT, error_message TEXT, input_fingerprint TEXT,
 input_revision INTEGER NOT NULL CHECK(input_revision >= 0),
 CHECK(state='running' OR completed_at IS NOT NULL)
);
CREATE TABLE student_tag_values (
 run_id INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE RESTRICT,
 student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 tag_code TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'student' CHECK(scope='student'),
 numeric_value REAL, text_value TEXT,
 state TEXT NOT NULL CHECK(state IN ('valid','insufficient_data','invalid_data')),
 explanation TEXT,
 FOREIGN KEY(tag_code,scope) REFERENCES tag_definitions(code,scope) ON DELETE RESTRICT,
 PRIMARY KEY(run_id,student_id,tag_code),
 CHECK((state='valid' AND ((numeric_value IS NOT NULL)+(text_value IS NOT NULL))=1) OR
       (state<>'valid' AND numeric_value IS NULL AND text_value IS NULL))
);
CREATE TABLE class_tag_values (
 run_id INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE RESTRICT,
 class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
 tag_code TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'class' CHECK(scope='class'),
 numeric_value REAL, text_value TEXT,
 state TEXT NOT NULL CHECK(state IN ('valid','insufficient_data','invalid_data')),
 explanation TEXT,
 FOREIGN KEY(tag_code,scope) REFERENCES tag_definitions(code,scope) ON DELETE RESTRICT,
 PRIMARY KEY(run_id,class_id,tag_code),
 CHECK((state='valid' AND ((numeric_value IS NOT NULL)+(text_value IS NOT NULL))=1) OR
       (state<>'valid' AND numeric_value IS NULL AND text_value IS NULL))
);
CREATE TABLE cluster_tasks (
 id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL, features_json TEXT NOT NULL CHECK(json_valid(features_json) AND json_type(features_json)='array' AND json_array_length(features_json)>0),
 k INTEGER NOT NULL CHECK(k >= 2), algorithm TEXT NOT NULL DEFAULT 'kmeans',
 parameters_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(parameters_json)),
 state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','succeeded','failed')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 error_message TEXT
);
CREATE TABLE cluster_results (
 task_id INTEGER NOT NULL REFERENCES cluster_tasks(id) ON DELETE RESTRICT,
 student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 cluster_label INTEGER NOT NULL CHECK(cluster_label >= 0), x REAL, y REAL,
 PRIMARY KEY(task_id,student_id)
);
CREATE TRIGGER cluster_label_insert BEFORE INSERT ON cluster_results
 WHEN NEW.cluster_label >= (SELECT k FROM cluster_tasks WHERE id=NEW.task_id)
 BEGIN SELECT RAISE(ABORT, 'cluster label out of range'); END;
CREATE TRIGGER cluster_label_update BEFORE UPDATE ON cluster_results
 WHEN NEW.cluster_label >= (SELECT k FROM cluster_tasks WHERE id=NEW.task_id)
 BEGIN SELECT RAISE(ABORT, 'cluster label out of range'); END;
CREATE TRIGGER cluster_k_update BEFORE UPDATE OF k ON cluster_tasks
 WHEN EXISTS(SELECT 1 FROM cluster_results WHERE task_id=NEW.id AND cluster_label>=NEW.k)
 BEGIN SELECT RAISE(ABORT, 'k conflicts with existing results'); END;
CREATE VIEW current_student_tag_values AS
 SELECT v.* FROM student_tag_values v JOIN analysis_runs r ON r.id=v.run_id
 JOIN portrait_meta m ON m.singleton=1
 WHERE r.state='succeeded' AND r.input_revision=m.data_revision AND r.id=(
   SELECT MAX(v2.run_id) FROM student_tag_values v2 JOIN analysis_runs r2 ON r2.id=v2.run_id
   WHERE v2.student_id=v.student_id AND r2.semester_id=r.semester_id
     AND r2.state='succeeded' AND r2.input_revision=m.data_revision
 );
CREATE VIEW current_class_tag_values AS
 SELECT v.* FROM class_tag_values v JOIN analysis_runs r ON r.id=v.run_id
 JOIN portrait_meta m ON m.singleton=1
 WHERE r.state='succeeded' AND r.input_revision=m.data_revision AND r.id=(
   SELECT MAX(v2.run_id) FROM class_tag_values v2 JOIN analysis_runs r2 ON r2.id=v2.run_id
   WHERE v2.class_id=v.class_id AND r2.semester_id=r.semester_id
     AND r2.state='succeeded' AND r2.input_revision=m.data_revision
 );
CREATE INDEX ix_students_class ON students(class_id);
CREATE INDEX ix_classes_major ON classes(major_id);
CREATE INDEX ix_teacher_classes_scope ON teacher_classes(class_id,semester_id);
CREATE INDEX ix_grades_semester_course ON grade_records(semester_id,course_id);
CREATE INDEX ix_behavior_semester ON behavior_records(semester_id);
CREATE INDEX ix_student_tags_student ON student_tag_values(student_id,run_id);
CREATE INDEX ix_class_tags_class ON class_tag_values(class_id,run_id);
CREATE INDEX ix_analysis_semester_state ON analysis_runs(semester_id,state,id);
