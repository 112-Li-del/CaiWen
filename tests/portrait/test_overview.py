import sqlite3

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from deeptutor.portrait.database import PortraitDatabase
from deeptutor.portrait.demo import seed_demo
from deeptutor.portrait import service
from deeptutor.services.auth import TokenPayload


@pytest.fixture
def db(tmp_path):
    db=PortraitDatabase(tmp_path/'portrait.db')
    seed_demo(db)
    return db


def test_demo_counts_repeat_and_validity(db):
    assert seed_demo(db)['created'] is False
    with db.connect() as c:
        for table,count in [('students',90),('teachers',10),('classes',10),('grade_records',1080),('behavior_records',180),('daily_behavior',5400),('account_bindings',0)]:
            assert c.execute(f'SELECT count(*) FROM {table}').fetchone()[0]==count
        assert not c.execute('PRAGMA foreign_key_check').fetchall()
        assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'


def test_demo_refuses_nonempty_database(tmp_path):
    db=PortraitDatabase(tmp_path/'real.db');db.initialize()
    with db.connect() as c: c.execute("INSERT INTO colleges VALUES(1,'real','正式学院')")
    with pytest.raises(ValueError): seed_demo(db)


def test_gpa_original_conversion_and_view(db):
    assert service.gpa_point(90)==4
    assert service.gpa_point(85)==3.7
    assert service.gpa_point(60)==1
    assert service.gpa_point(59)==0
    data=service.overview(db,None,2,student_id=1)
    expected=round(sum(service.gpa_point(c['score']) for c in data['courses'])/6,2)
    assert data['summary']['gpa']==expected
    assert data['summary']['total_credits']==19
    assert data['summary']['course_count']==6
    assert len(data['board']['points'])==30
    assert len(service.overview(db,None,2,student_id=1,days=7)['board']['points'])==7
    assert len(service.overview(db,None,2,student_id=1,board_mode='semester')['board']['points'])==2
    assert service.overview(db,None,2,student_id=1)['tags']==data['tags']


def test_scope_is_enforced_for_students_and_teachers(db,monkeypatch):
    from deeptutor.multi_user import identity
    records={'s':('s',{'role':'user','member_type':'student'}),'t':('t',{'role':'user','member_type':'teacher'})}
    monkeypatch.setattr(identity,'get_user_by_id',lambda uid:records.get(uid))
    with db.connect() as c:
        c.execute("INSERT INTO account_bindings VALUES('s',1,NULL)")
        c.execute("INSERT INTO account_bindings VALUES('t',NULL,1)")
    student=TokenPayload('s','user','s');teacher=TokenPayload('t','user','t')
    assert len(service.catalog(db,student)['students'])==1
    assert len(service.catalog(db,teacher)['students'])==9
    assert not service.catalog(db,student)['can_compare']
    for actor in (student,teacher):
        with pytest.raises(HTTPException) as exc: service.overview(db,actor,2,student_id=10)
        assert exc.value.status_code==404
    with pytest.raises(HTTPException): service.overview(db,student,2,dimension='class',class_id=1)
    data=service.overview(db,teacher,2,dimension='class',class_id=1)
    assert data['summary']['student_count']==9
    records['s'][1]['member_type']='teacher'
    assert service.catalog(db,student)['students']==[]


def test_read_api_validation_and_no_binding(db):
    from deeptutor.api.routers import portrait
    app=FastAPI();app.include_router(portrait.router)
    app.dependency_overrides[portrait.get_database]=lambda:db
    app.dependency_overrides[portrait.require_auth]=lambda:TokenPayload('admin','admin','a')
    with TestClient(app) as client:
        assert client.get('/catalog').status_code==200
        assert client.get('/overview?semester_id=2&student_id=1').status_code==200
        assert client.get('/overview?semester_id=2&board_mode=invalid').status_code==422
        assert client.get('/overview?semester_id=2&days=999999').status_code==422
        assert client.get('/overview?semester_id=999').status_code==404


def test_account_links_are_admin_only(db, monkeypatch):
    from deeptutor.api.routers import portrait, auth
    monkeypatch.setattr(auth, 'AUTH_ENABLED', True)
    with db.connect() as c:
        c.execute("INSERT INTO account_bindings VALUES('student-account',1,NULL)")
        c.execute("INSERT INTO account_bindings VALUES('teacher-account',NULL,1)")
    app = FastAPI()
    app.include_router(portrait.router)
    app.dependency_overrides[portrait.get_database] = lambda: db
    app.dependency_overrides[portrait.require_auth] = lambda: TokenPayload('owner', 'admin', 'owner')
    with TestClient(app) as client:
        links = client.get('/account-links').json()
        assert links['student-account']['code'] == 'DEMO-S001'
        assert links['teacher-account']['class_name'] == '演示班级01'
        app.dependency_overrides[portrait.require_auth] = lambda: TokenPayload('student', 'user', 'student-account')
        assert client.get('/account-links').status_code == 403


def test_daily_constraints_and_v1_upgrade(tmp_path):
    db=PortraitDatabase(tmp_path/'old.db')
    with db.transaction() as c:
        db._execute_schema(c,'schema.sql')
        c.execute("INSERT INTO colleges VALUES(1,'original','保留数据')")
        c.execute('PRAGMA user_version=1')
    db.initialize()
    with db.connect() as c:
        assert c.execute('PRAGMA user_version').fetchone()[0]==2
        assert c.execute('SELECT name FROM colleges').fetchone()[0]=='保留数据'
        assert c.execute("SELECT name FROM sqlite_master WHERE name='daily_behavior'").fetchone()


def test_missing_behavior_is_not_zero(db):
    with db.connect() as c:
        c.execute('DELETE FROM behavior_records WHERE student_id=1 AND semester_id=2')
        c.execute('DELETE FROM daily_behavior WHERE student_id=1 AND semester_id=2')
    data=service.overview(db,None,2,student_id=1)
    assert data['metrics']['study'] is None
    assert data['board']['points']==[]
    assert data['radar'][2]['value'] is None


@pytest.mark.parametrize('assignment', [
    "observed_date='2026-02-30'",
    "observed_date='2026-08-01'",
    'attended_sessions=100',
    'study_hours=25',
])
def test_invalid_daily_values_are_rejected(db, assignment):
    with db.connect() as c:
        with pytest.raises(sqlite3.IntegrityError):
            c.execute(f'UPDATE daily_behavior SET {assignment} WHERE id=1')


def test_missing_grades_do_not_count_as_zero_passed_credits(db):
    with db.connect() as c:
        c.execute('DELETE FROM grade_records WHERE semester_id=2 AND student_id=1')
    data=service.overview(db,None,2,student_id=1)
    assert data['summary']['passed_credits'] is None
    assert data['summary']['gpa'] is None


@pytest.mark.parametrize('score, expected', [(59.9, 0), (60, 4), (100, 4)])
def test_course_earned_credits_require_a_passing_score(db, score, expected):
    with db.connect() as c:
        c.execute('UPDATE grade_records SET score=80 WHERE semester_id=2 AND student_id=1')
        c.execute('UPDATE grade_records SET score=? WHERE semester_id=2 AND student_id=1 AND course_id=3', (score,))
    data = service.overview(db, None, 2, student_id=1)
    course = next(item for item in data['courses'] if item['id'] == 3)
    assert course['credits'] == 4
    assert course['earned_credits'] == expected
    assert data['summary']['total_credits'] == 19
    assert data['summary']['passed_credits'] == 15 + expected


def test_class_earned_credits_are_not_awarded_from_the_class_average(db):
    with db.connect() as c:
        c.execute('UPDATE grade_records SET score=80 WHERE semester_id=2 AND course_id=3')
        c.execute('UPDATE grade_records SET score=45.2 WHERE semester_id=2 AND student_id=1 AND course_id=3')
    data = service.overview(db, None, 2, dimension='class', class_id=1)
    course = next(item for item in data['courses'] if item['id'] == 3)
    assert course['score'] > 60
    assert course['earned_credits'] == round(8 * 4 / 9, 2)


def test_unrecorded_course_does_not_invent_earned_credits(db):
    with db.connect() as c:
        c.execute("UPDATE grade_records SET score=NULL,status='pending' WHERE semester_id=2 AND student_id=1 AND course_id=3")
    course = next(item for item in service.overview(db, None, 2, student_id=1)['courses'] if item['id'] == 3)
    assert course['earned_credits'] is None
