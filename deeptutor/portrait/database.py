"""Versioned SQLite storage for portraits. No web routes or implicit legacy imports."""
from __future__ import annotations

from contextlib import contextmanager
import json
import math
from pathlib import Path
import sqlite3
from typing import Iterator

SCHEMA_VERSION = 2
DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "portrait" / "portrait.db"

STUDENT_TAGS = [
    ("average_score", "平均成绩", "number"),
    ("score_stddev", "成绩标准差", "number"),
    ("score_range", "偏科指数", "number"),
    ("score_level", "成绩等级", "category"),
    ("score_stability", "学习稳定性", "category"),
    ("imbalance_level", "偏科程度", "category"),
    ("attendance_rate", "考勤率", "number"),
    ("attendance_level", "考勤评价", "category"),
    ("study_hours", "学习时长", "number"),
    ("study_level", "学习状态", "category"),
    ("sleep_hours", "睡眠时长", "number"),
    ("sleep_level", "睡眠质量", "category"),
    ("participation", "课堂参与度", "number"),
    ("participation_level", "课堂表现", "category"),
    ("social_activity", "社会活动参与度", "number"),
    ("social_activity_level", "社会活动评价", "category"),
]
CLASS_TAGS = [
    ("class_average_score", "班级平均成绩", "number"),
    ("class_score_stddev", "班级成绩离散度", "number"),
    ("class_average_range", "班级偏科平均指数", "number"),
    ("class_score_level", "班级成绩等级", "category"),
    ("class_polarization", "班级两极分化程度", "category"),
]


class PortraitDatabase:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path is not None else DEFAULT_PATH

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """Every connection enforces foreign keys and releases its file handle."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=10000")
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
                conn.commit()
            except BaseException:
                conn.rollback()
                raise

    def initialize(self) -> None:
        with self.connect() as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            if version not in (0, 1, SCHEMA_VERSION):
                raise ValueError(f"Unsupported portrait schema version: {version}")
            if (version == 0 and tables) or (version > 0 and "portrait_meta" not in tables):
                raise ValueError("Refusing to initialize an unrelated database")
            conn.execute("PRAGMA journal_mode=WAL")
        with self.transaction() as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version == SCHEMA_VERSION:
                return
            if version == 1:
                self._execute_schema(conn, "daily.sql")
                conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
                return
            if version != 0:
                raise ValueError(f"Unsupported portrait schema version: {version}")
            if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone():
                raise ValueError("Refusing to initialize a nonempty, unversioned database")
            # executescript implicitly commits: execute complete statements ourselves
            # so DDL, registry seeds and the version marker share one transaction.
            self._execute_schema(conn, "schema.sql")
            self._execute_schema(conn, "daily.sql")
            for scope, definitions in (("student", STUDENT_TAGS), ("class", CLASS_TAGS)):
                conn.executemany(
                    "INSERT INTO tag_definitions(code,name,scope,value_type) VALUES(?,?,?,?)",
                    [(code, name, scope, kind) for code, name, kind in definitions],
                )
            # Every source mutation invalidates old published values, but retains
            # their history. Runtime readers use the current_* views.
            for table in ("students", "classes", "courses", "grade_records", "behavior_records", "student_class_enrollments", "tag_definitions"):
                for operation in ("INSERT", "UPDATE", "DELETE"):
                    conn.execute(
                        f"CREATE TRIGGER revision_{table}_{operation.lower()} AFTER {operation} ON {table} "
                        "BEGIN UPDATE portrait_meta SET data_revision=data_revision+1 WHERE singleton=1; END"
                    )
            for table in ("student_tag_values", "class_tag_values"):
                for operation in ("INSERT", "UPDATE"):
                    conn.execute(
                        f"CREATE TRIGGER kind_{table}_{operation.lower()} BEFORE {operation} ON {table} "
                        "WHEN NEW.state='valid' AND ((SELECT value_type FROM tag_definitions WHERE code=NEW.tag_code)='number') <> (NEW.numeric_value IS NOT NULL) "
                        "BEGIN SELECT RAISE(ABORT, 'tag value type mismatch'); END"
                    )
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    @staticmethod
    def _execute_schema(conn: sqlite3.Connection, filename: str) -> None:
        statement = ""
        for line in Path(__file__).with_name(filename).read_text(encoding="utf-8").splitlines(True):
            statement += line
            if sqlite3.complete_statement(statement):
                conn.execute(statement)
                statement = ""
        if statement.strip():
            raise ValueError("Incomplete schema statement")

    def import_grades(self, rows: list[dict], *, actor_user_id: str, source_name: str) -> dict:
        """Atomic batch, keyed by student number/course code/semester/attempt.

        Replays skip identical records. Corrections update a stable row and log
        before/after values. Conflicting duplicates inside one batch abort it.
        Callers must authorize administrators before invoking this storage API.
        """
        if not actor_user_id.strip() or not source_name.strip() or not rows:
            raise ValueError("Actor, source and at least one grade are required")
        counts = {"inserted": 0, "updated": 0, "skipped": 0}
        seen: dict[tuple, tuple] = {}
        with self.transaction() as conn:
            batch = conn.execute(
                "INSERT INTO import_batches(kind,source_name,actor_user_id) VALUES('grades',?,?)",
                (source_name, actor_user_id),
            ).lastrowid
            for index, row in enumerate(rows, 1):
                try:
                    refs = []
                    for table, key in (("students", "student_no"), ("courses", "course_code"), ("semesters", "semester_code")):
                        column = "student_no" if table == "students" else "code"
                        result = conn.execute(f"SELECT id FROM {table} WHERE {column}=?", (row.get(key),)).fetchone()
                        if result is None:
                            raise ValueError(f"Unknown {key}")
                        refs.append(result[0])
                    attempt = row.get("attempt_no", 1)
                    if type(attempt) is not int or attempt < 1:
                        raise ValueError("attempt_no must be a positive integer")
                    state = row.get("status", "recorded")
                    score = row.get("score")
                    if score is not None:
                        if isinstance(score, bool):
                            raise ValueError("Invalid score")
                        score = float(score)
                        if not math.isfinite(score):
                            raise ValueError("Score must be finite")
                    key = (*refs, attempt)
                    value = (score, state)
                    if key in seen and seen[key] != value:
                        raise ValueError("Conflicting duplicate in this batch")
                    seen[key] = value
                    old = conn.execute(
                        "SELECT id,score,status FROM grade_records WHERE student_id=? AND course_id=? AND semester_id=? AND attempt_no=?", key
                    ).fetchone()
                    if old and (old["score"], old["status"]) == value:
                        counts["skipped"] += 1
                        continue
                    if old:
                        conn.execute("UPDATE grade_records SET score=?,status=?,source_batch_id=? WHERE id=?", (*value, batch, old["id"]))
                        grade_id, operation = old["id"], "update"
                        before = json.dumps({"score": old["score"], "status": old["status"]})
                    else:
                        grade_id = conn.execute(
                            "INSERT INTO grade_records(student_id,course_id,semester_id,attempt_no,score,status,source_batch_id) VALUES(?,?,?,?,?,?,?)",
                            (*key, *value, batch),
                        ).lastrowid
                        operation, before = "insert", None
                    conn.execute(
                        "INSERT INTO grade_changes(batch_id,grade_id,operation,before_json,after_json) VALUES(?,?,?,?,?)",
                        (batch, grade_id, operation, before, json.dumps({"score": score, "status": state})),
                    )
                    counts["inserted" if operation == "insert" else "updated"] += 1
                except (ValueError, TypeError, sqlite3.IntegrityError) as exc:
                    raise ValueError(f"Row {index}: {exc}") from exc
            conn.execute("UPDATE import_batches SET inserted_count=?,updated_count=?,skipped_count=? WHERE id=?", (*counts.values(), batch))
        return {"batch_id": batch, **counts}

    def bind_account(self, user_id: str, *, student_id: int | None = None, teacher_id: int | None = None) -> None:
        """Validate the external JSON identity; SQLite cannot foreign-key it."""
        from deeptutor.multi_user.identity import get_user_by_id

        account = get_user_by_id(user_id)
        expected = "student" if student_id is not None and teacher_id is None else "teacher"
        if account is None or account[1].get("role") != "user" or account[1].get("member_type") != expected:
            raise ValueError("Account must be an ordinary member with matching campus identity")
        if account[1].get("disabled") or account[1].get("status", "active") != "active":
            raise ValueError("Account is not active")
        with self.transaction() as conn:
            conn.execute("INSERT INTO account_bindings(account_user_id,student_id,teacher_id) VALUES(?,?,?)", (user_id, student_id, teacher_id))

    def backup(self, destination: str | Path) -> Path:
        """Consistent snapshot including committed WAL data; never overwrite a file."""
        target = Path(destination)
        if not self.path.is_file():
            raise FileNotFoundError(self.path)
        if target.resolve() == self.path.resolve():
            raise ValueError("Backup path must differ from database")
        target.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation avoids overwriting an unrelated existing artifact.
        with target.open("xb"):
            pass
        try:
            with self.connect() as source:
                with sqlite3.connect(target) as dest:
                    source.backup(dest)
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return target
