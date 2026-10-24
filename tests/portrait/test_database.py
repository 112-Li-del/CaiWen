import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from deeptutor.portrait import PortraitDatabase


@pytest.fixture
def db(tmp_path):
    db = PortraitDatabase(tmp_path / "portrait.db")
    db.initialize()
    with db.transaction() as conn:
        conn.execute("INSERT INTO colleges VALUES(1,'C','学院')")
        conn.execute("INSERT INTO majors VALUES(1,1,'M','专业')")
        conn.execute("INSERT INTO classes VALUES(1,'CL','班级',1,2026)")
        conn.execute("INSERT INTO semesters VALUES(1,'2026-2027-1','第一学期','2026-09-01','2027-01-31')")
        conn.execute("INSERT INTO students(id,student_no,name,class_id) VALUES(1,'S001','测试学生',1)")
        conn.execute("INSERT INTO courses VALUES(1,'CS001','课程',3,'必修',100)")
    return db


def grade(**kwargs):
    return dict(student_no="S001", course_code="CS001", semester_code="2026-2027-1", score=85, **kwargs)


def import_rows(db, rows):
    return db.import_grades(rows, actor_user_id="admin-id", source_name="test.xlsx")


def test_initialization_repeat_and_constraints(db):
    db.initialize()
    with db.connect() as conn:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("SELECT count(*) FROM tag_definitions WHERE scope='student'").fetchone()[0] == 16
        assert conn.execute("SELECT count(*) FROM tag_definitions WHERE scope='class'").fetchone()[0] == 5
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert not conn.execute("PRAGMA foreign_key_check").fetchall()
        names = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        assert not any("questionnaire" in n for n in names)
        assert "cluster_results" in names


def test_import_replay_and_correction(db):
    assert import_rows(db, [grade(), grade()])["inserted"] == 1
    assert import_rows(db, [grade()])["skipped"] == 1
    changed = grade()
    changed["score"] = 90
    assert import_rows(db, [changed])["updated"] == 1
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM grade_records").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM grade_changes").fetchone()[0] == 2


@pytest.mark.parametrize("bad", [dict(score=101), dict(score=-1), dict(score=float('nan')), dict(student_no='missing'), dict(attempt_no=0), dict(score=None), dict(score=True)])
def test_failed_batch_rolls_back(db, bad):
    invalid = grade()
    invalid.update(bad)
    with pytest.raises(ValueError):
        import_rows(db, [grade(), invalid])
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM grade_records").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM import_batches").fetchone()[0] == 0


def test_attempts_are_not_overwritten(db):
    import_rows(db, [grade(), grade(attempt_no=2)])
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM grade_records").fetchone()[0] == 2
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM students WHERE id=1")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE courses SET full_score=80 WHERE id=1")


def test_behavior_units_and_missing_values(db):
    with db.transaction() as conn:
        conn.execute("INSERT INTO behavior_records(student_id,semester_id,study_hours_daily,source_kind) VALUES(1,1,0,'demo')")
    with db.connect() as conn:
        value = conn.execute("SELECT * FROM behavior_records").fetchone()
        assert value['study_hours_daily'] == 0
        assert value['sleep_hours_daily'] is None
        for sql in (
            "UPDATE behavior_records SET attendance_rate=101",
            "UPDATE behavior_records SET participation_value=9,participation_scale=5",
            "UPDATE behavior_records SET social_activity_value=22",
            "UPDATE behavior_records SET sleep_hours_daily=25",
        ):
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(sql)


def test_account_binding_validates_caiwen_identity(db, monkeypatch):
    from deeptutor.multi_user import identity
    account = {"role": "admin", "member_type": None}
    monkeypatch.setattr(identity, "get_user_by_id", lambda uid: ("name", account))
    with pytest.raises(ValueError):
        db.bind_account('u_1', student_id=1)
    account.update(role="user", member_type="student")
    db.bind_account('u_1', student_id=1)
    with pytest.raises(sqlite3.IntegrityError):
        db.bind_account('u_2', student_id=1)


def test_concurrent_replays_do_not_duplicate(db):
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: import_rows(db, [grade()]), range(8)))
    assert sum(r['inserted'] for r in results) == 1
    assert sum(r['skipped'] for r in results) == 7


def test_backup_and_future_version_rejection(db, tmp_path):
    import_rows(db, [grade()])
    snapshot = db.backup(tmp_path / 'backup.db')
    with sqlite3.connect(snapshot) as conn:
        assert conn.execute("SELECT count(*) FROM grade_records").fetchone()[0] == 1
    with pytest.raises(FileExistsError):
        db.backup(snapshot)
    with db.connect() as conn:
        conn.execute("PRAGMA user_version=99")
    with pytest.raises(ValueError):
        db.initialize()


def test_source_update_hides_stale_tags(db):
    with db.transaction() as conn:
        revision = conn.execute('SELECT data_revision FROM portrait_meta').fetchone()[0]
        conn.execute("INSERT INTO analysis_runs(id,semester_id,actor_user_id,rule_version,input_revision,state,completed_at) VALUES(1,1,'admin','1',?,'succeeded','2026-10-24')", (revision,))
        conn.execute("INSERT INTO student_tag_values(run_id,student_id,tag_code,numeric_value,state) VALUES(1,1,'average_score',85,'valid')")
        assert conn.execute('SELECT count(*) FROM current_student_tag_values').fetchone()[0] == 1
        conn.execute("INSERT INTO analysis_runs(id,semester_id,actor_user_id,rule_version,input_revision,state,completed_at) VALUES(2,1,'admin','1',?,'succeeded','2026-10-24')", (revision,))
        conn.execute("INSERT INTO student_tag_values(run_id,student_id,tag_code,numeric_value,state) VALUES(2,1,'average_score',90,'valid')")
        current = conn.execute('SELECT numeric_value FROM current_student_tag_values').fetchall()
        assert len(current) == 1 and current[0][0] == 90
    import_rows(db, [grade()])
    with db.connect() as conn:
        assert conn.execute('SELECT count(*) FROM current_student_tag_values').fetchone()[0] == 0
        assert conn.execute('SELECT count(*) FROM student_tag_values').fetchone()[0] == 2


def test_invalid_foreign_keys_and_tag_types(db):
    with db.connect() as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO teacher_classes VALUES(999,1,1)")
        conn.execute("INSERT INTO analysis_runs(id,semester_id,actor_user_id,rule_version,input_revision) VALUES(1,1,'a','1',0)")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO student_tag_values(run_id,student_id,tag_code,text_value,state) VALUES(1,1,'average_score','wrong','valid')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO semesters VALUES(2,'x','bad','2026-02-31','2026-03-31')")


def test_class_tags_and_cluster_results_are_constrained(db):
    with db.connect() as conn:
        conn.execute("INSERT INTO analysis_runs(id,semester_id,actor_user_id,rule_version,input_revision) VALUES(1,1,'a','1',0)")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO class_tag_values(run_id,class_id,tag_code,numeric_value,state) VALUES(1,1,'average_score',85,'valid')")
        conn.execute("INSERT INTO cluster_tasks(id,run_id,actor_user_id,features_json,k) VALUES(1,1,'a','[\"average_score\"]',2)")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO cluster_results(task_id,student_id,cluster_label) VALUES(1,1,2)")
        conn.execute("INSERT INTO cluster_results(task_id,student_id,cluster_label) VALUES(1,1,1)")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO cluster_results(task_id,student_id,cluster_label) VALUES(1,1,0)")


def test_unrelated_database_is_not_modified(tmp_path):
    path = tmp_path / 'unrelated.db'
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE unrelated(id INTEGER PRIMARY KEY)')
    before = path.read_bytes()
    with pytest.raises(ValueError):
        PortraitDatabase(path).initialize()
    assert path.read_bytes() == before
