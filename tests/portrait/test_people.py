import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from deeptutor.multi_user import identity
from deeptutor.portrait import directory, service
from deeptutor.portrait.database import PortraitDatabase
from deeptutor.portrait.demo import seed_demo
from deeptutor.services.auth import TokenPayload


ADMIN = TokenPayload('owner', 'admin', 'admin-id')
TEACHER = TokenPayload('tea001', 'user', 't1')
STUDENT = TokenPayload('stu001', 'user', 's1')


@pytest.fixture
def db(tmp_path, monkeypatch):
    db = PortraitDatabase(tmp_path / 'portrait.db')
    seed_demo(db)
    users = {
        'tea001': dict(id='t1', role='user', member_type='teacher'),
        'tea002': dict(id='t2', role='user', member_type='teacher'),
        'stu001': dict(id='s1', role='user', member_type='student'),
        'stu010': dict(id='s10', role='user', member_type='student'),
        'stu019': dict(id='s19', role='user', member_type='student'),
    }
    monkeypatch.setattr(identity, 'load_users', lambda: users)
    monkeypatch.setattr(identity, 'get_user_by_id', lambda uid: next(((n, r) for n, r in users.items() if r['id'] == uid), None))
    with db.transaction() as c:
        c.executemany('INSERT INTO account_bindings VALUES(?,?,?)', [
            ('t1', None, 1), ('t2', None, 2), ('s1', 1, None), ('s10', 10, None), ('s19', 19, None),
        ])
        # Teacher 1 manages two classes in semester 2, one in semester 1.
        # Class 2 is shared by teachers 1 and 2 without duplicate students.
        c.execute('INSERT INTO teacher_classes VALUES(1,2,2)')
    return db


def test_admin_search_paginates_before_returning_students(db):
    first = directory.people(db, ADMIN, 2)
    second = directory.people(db, ADMIN, 2, page=2)
    assert first['total'] == second['total'] == 90
    assert len(first['items']) == len(second['items']) == 20
    assert not {r['id'] for r in first['items']} & {r['id'] for r in second['items']}
    assert directory.people(db, ADMIN, 2, page=6)['items'] == []
    catalog = service.catalog(db, ADMIN, 2, include_students=False)
    assert catalog['students'] == [] and catalog['first_student']['id'] == 1
    assert catalog['student_count'] == 90 and catalog['can_select_teacher']


@pytest.mark.parametrize('query', ['stu010', 'STU010', 'DEMO-S010', '演示学生010'])
def test_search_by_name_code_and_login(db, query):
    result = directory.people(db, ADMIN, 2, q=query)
    assert result['total'] == 1
    assert result['items'][0]['id'] == 10
    assert result['items'][0]['username'] == 'stu010'


def test_filters_and_search_are_literal(db):
    result = directory.people(db, ADMIN, 2, class_id=2, college_id=1)
    assert result['total'] == 9
    assert {r['class_id'] for r in result['items']} == {2}
    assert directory.people(db, ADMIN, 2, class_id=2, college_id=2)['total'] == 0
    for query in ['%', '_', "' OR 1=1 --"]:
        assert directory.people(db, ADMIN, 2, q=query)['total'] == 0


def test_teacher_directory_and_multiple_classes(db):
    result = directory.people(db, ADMIN, 2, kind='teacher', q='tea001')
    teacher = result['items'][0]
    assert result['total'] == 1 and teacher['id'] == 1
    assert teacher['class_count'] == 2 and teacher['student_count'] == 18
    assert {c['id'] for c in teacher['classes']} == {1, 2}
    assert directory.people(db, ADMIN, 1, kind='teacher', q='tea001')['items'][0]['student_count'] == 9
    assert directory.people(db, ADMIN, 2, kind='teacher', class_id=2)['total'] == 2


def test_teacher_search_is_scoped_before_count_and_pagination(db):
    assert directory.people(db, TEACHER, 2)['total'] == 18
    assert directory.people(db, TEACHER, 1)['total'] == 9
    assert directory.people(db, TEACHER, 2, q='stu010')['total'] == 1
    for filters in [dict(q='stu019'), dict(class_id=3), dict(q='演示学生019')]:
        result = directory.people(db, TEACHER, 2, **filters)
        assert result['total'] == 0 and result['items'] == []
    catalog = service.catalog(db, TEACHER, 2, include_students=False)
    assert not catalog['can_select_teacher'] and catalog['teacher']['id'] == 1
    assert {c['id'] for c in catalog['classes']} == {1, 2}


@pytest.mark.parametrize('actor', [TEACHER, STUDENT])
def test_members_cannot_switch_teacher_or_search_teachers(db, actor):
    for operation in [
        lambda: directory.people(db, actor, 2, kind='teacher'),
        lambda: directory.people(db, actor, 2, teacher_id=2),
        lambda: service.catalog(db, actor, 2, teacher_id=2),
        lambda: service.overview(db, actor, 2, teacher_id=2),
    ]:
        with pytest.raises(HTTPException) as exc:
            operation()
        assert exc.value.status_code == 403
    if actor == STUDENT:
        with pytest.raises(HTTPException):
            directory.people(db, actor, 2)
        with pytest.raises(HTTPException):
            service.overview(db, actor, 2, dimension='scope')


def test_admin_teacher_scope_applies_to_detail_class_and_history(db):
    assert directory.people(db, ADMIN, 2, teacher_id=1)['total'] == 18
    data = service.overview(db, ADMIN, 2, teacher_id=1, dimension='scope', board_mode='semester')
    assert data['teacher']['id'] == 1 and data['summary']['student_count'] == 18
    assert data['title'] == '所管学生汇总' and data['profile'] is None
    assert len(data['board']['points']) == 2
    for sem, point in zip([1, 2], data['board']['points']):
        expected = service.overview(db, TEACHER, sem, dimension='scope')['metrics']['study']
        assert point['study'] == expected
    assert service.overview(db, ADMIN, 2, teacher_id=1, dimension='scope', class_id=2)['summary']['student_count'] == 9
    assert service.overview(db, ADMIN, 2, teacher_id=1, student_id=10)['profile']['id'] == 10
    for params in [dict(student_id=19), dict(dimension='class', class_id=3), dict(dimension='scope', class_id=3)]:
        with pytest.raises(HTTPException) as exc:
            service.overview(db, ADMIN, 2, teacher_id=1, **params)
        assert exc.value.status_code == 404


def test_empty_teacher_scope_is_explicit(db):
    with db.transaction() as c:
        c.execute('DELETE FROM teacher_classes WHERE teacher_id=1 AND semester_id=2')
    teacher = directory.people(db, ADMIN, 2, kind='teacher', q='tea001')['items'][0]
    assert teacher['class_count'] == teacher['student_count'] == 0
    catalog = service.catalog(db, ADMIN, 2, teacher_id=1, include_students=False)
    assert catalog['classes'] == [] and catalog['first_student'] is None
    data = service.overview(db, ADMIN, 2, teacher_id=1, dimension='scope')
    assert data['summary']['student_count'] == 0 and data['metrics']['study'] is None
    assert data['courses'] == [] and data['board']['points'] == []


def test_api_validation_and_member_parameter_forgery(db):
    from deeptutor.api.routers import portrait
    app = FastAPI()
    app.include_router(portrait.router)
    app.dependency_overrides[portrait.get_database] = lambda: db
    app.dependency_overrides[portrait.require_auth] = lambda: TEACHER
    with TestClient(app) as client:
        result = client.get('/people?semester_id=2').json()
        assert result['total'] == 18
        assert client.get('/people?semester_id=2&teacher_id=2').status_code == 403
        assert client.get('/people?semester_id=2&kind=teacher').status_code == 403
        assert client.get('/overview?semester_id=2&dimension=scope').json()['summary']['student_count'] == 18
        assert client.get('/catalog?semester_id=2').json()['students'] == []
        for query in ['page=0', 'page_size=51', 'kind=unknown', 'class_id=0', 'q=' + 'a' * 101]:
            assert client.get('/people?semester_id=2&' + query).status_code == 422
        app.dependency_overrides[portrait.require_auth] = lambda: ADMIN
        assert client.get('/people?semester_id=2&kind=teacher').json()['total'] == 10
        assert client.get('/catalog?semester_id=2&teacher_id=999').status_code == 404
        assert client.get('/people?semester_id=999').status_code == 404
