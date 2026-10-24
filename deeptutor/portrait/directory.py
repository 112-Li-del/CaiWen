"""Permission-scoped people search. Filter and paginate before returning profiles."""
import json

from fastapi import HTTPException

from deeptutor.multi_user import identity


def is_admin(actor):
    return actor is None or actor.role == 'admin'


def member(c, actor):
    record = identity.get_user_by_id(actor.user_id) if actor else None
    if not record or record[1].get('role') != 'user' or record[1].get('disabled') or record[1].get('status', 'active') != 'active':
        return None, None
    return record[1].get('member_type'), c.execute(
        'SELECT * FROM account_bindings WHERE account_user_id=?', (actor.user_id,)
    ).fetchone()


def teacher_context(c, actor, semester_id, teacher_id=None):
    if teacher_id is not None and not is_admin(actor):
        raise HTTPException(403, '只有管理员可以切换教师视图')
    if not is_admin(actor):
        kind, binding = member(c, actor)
        teacher_id = binding['teacher_id'] if kind == 'teacher' and binding else None
    if teacher_id is None:
        return None
    row = c.execute(
        'SELECT t.id,t.name,t.teacher_no,co.name college_name FROM teachers t JOIN colleges co ON co.id=t.college_id WHERE t.id=?',
        (teacher_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, '教师不存在')
    classes = [dict(r) for r in c.execute(
        'SELECT cl.id,cl.name,COUNT(e.student_id) student_count FROM teacher_classes tc JOIN classes cl ON cl.id=tc.class_id '
        'LEFT JOIN student_class_enrollments e ON e.class_id=cl.id AND e.semester_id=tc.semester_id '
        'WHERE tc.teacher_id=? AND tc.semester_id=? GROUP BY cl.id ORDER BY cl.code',
        (teacher_id, semester_id),
    )]
    return dict(row, classes=classes, class_count=len(classes), student_count=sum(r['student_count'] for r in classes))


def student_source(c, actor, semester_id, teacher_id=None):
    """SQL source shared by counts, search, filters and overview permissions."""
    teacher = teacher_context(c, actor, semester_id, teacher_id)
    source = ('FROM students s JOIN student_class_enrollments e ON e.student_id=s.id '
              'JOIN classes cl ON cl.id=e.class_id JOIN majors m ON m.id=cl.major_id '
              'JOIN colleges co ON co.id=m.college_id WHERE e.semester_id=?')
    params = [semester_id]
    if teacher:
        source += ' AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE tc.class_id=e.class_id AND tc.semester_id=e.semester_id AND tc.teacher_id=?)'
        params.append(teacher['id'])
    elif not is_admin(actor):
        kind, binding = member(c, actor)
        if kind == 'student' and binding and binding['student_id']:
            source += ' AND s.id=?'
            params.append(binding['student_id'])
        else:
            source += ' AND 0'
    return source, params, teacher


def people(db, actor, semester_id, *, kind='student', q='', college_id=None, class_id=None, teacher_id=None, page=1, page_size=20):
    if kind not in ('student', 'teacher') or page < 1 or not 1 <= page_size <= 50:
        raise HTTPException(422, '人员搜索参数无效')
    with db.connect() as c:
        c.execute('BEGIN')
        if not c.execute('SELECT 1 FROM semesters WHERE id=?', (semester_id,)).fetchone():
            raise HTTPException(404, '学期不存在')
        if not is_admin(actor):
            member_kind, _ = member(c, actor)
            if kind == 'teacher' or member_kind != 'teacher':
                raise HTTPException(403, '只有管理员或教师可以搜索人员')
        users = identity.load_users()
        usernames = {r['id']: name for name, r in users.items()}
        matching_ids = json.dumps([uid for uid, name in usernames.items() if q.strip().casefold() in name.casefold()])
        if kind == 'student':
            source, params, _ = student_source(c, actor, semester_id, teacher_id)
            select = 's.id,s.name,s.student_no code,cl.name class_name,cl.id class_id,co.name college_name'
            alias, number, binding = 's', 'student_no', 'student_id'
        else:
            if teacher_id is not None:
                teacher_context(c, actor, semester_id, teacher_id)
            source = 'FROM teachers t JOIN colleges co ON co.id=t.college_id WHERE 1=1'
            params = []
            select = 't.id,t.name,t.teacher_no code,co.name college_name'
            alias, number, binding = 't', 'teacher_no', 'teacher_id'
        if college_id is not None:
            source += ' AND co.id=?'
            params.append(college_id)
        if class_id is not None:
            source += (' AND cl.id=?' if kind == 'student' else
                       ' AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id=t.id AND tc.class_id=? AND tc.semester_id=?)')
            params.append(class_id)
            if kind == 'teacher':
                params.append(semester_id)
        if q.strip():
            source += (f' AND (instr(lower({alias}.name),lower(?))>0 OR instr(lower({alias}.{number}),lower(?))>0 '
                       f'OR EXISTS(SELECT 1 FROM account_bindings b WHERE b.{binding}={alias}.id '
                       'AND b.account_user_id IN (SELECT value FROM json_each(?))))')
            params.extend([q.strip(), q.strip(), matching_ids])
        total = c.execute('SELECT COUNT(*) ' + source, params).fetchone()[0]
        rows = c.execute('SELECT ' + select + ' ' + source + f' ORDER BY {alias}.{number},{alias}.id LIMIT ? OFFSET ?',
                         [*params, page_size, (page - 1) * page_size]).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            account = c.execute(f'SELECT account_user_id FROM account_bindings WHERE {binding}=?', (item['id'],)).fetchone()
            item['username'] = usernames.get(account[0]) if account else None
            if kind == 'teacher':
                item.update(teacher_context(c, actor, semester_id, item['id']))
            items.append(item)
        return dict(items=items, total=total, page=page, page_size=page_size)
