"""Authorized portrait projections and deterministic descriptive statistics."""
import statistics
import json
from collections import defaultdict

from fastapi import HTTPException

from .database import PortraitDatabase
from . import directory


def mean(values):
    data=[v for v in values if v is not None]
    return round(statistics.mean(data),2) if data else None


def gpa_point(score):
    for minimum,point in [(90,4),(85,3.7),(82,3.3),(78,3),(75,2.7),(72,2.3),(68,2),(64,1.5),(60,1)]:
        if score>=minimum:
            return point
    return 0.0


def earned_credits(grade):
    """Course credits are awarded only for recorded passing first-attempt grades."""
    if grade['status'] != 'recorded':
        return None
    return grade['credits'] if 100 * grade['score'] / grade['full_score'] >= 60 else 0


def allowed_students(c, actor, semester_id, teacher_id=None):
    source, params, _ = directory.student_source(c, actor, semester_id, teacher_id)
    return {r[0] for r in c.execute('SELECT s.id ' + source, params)}


def can_compare(c,actor):
    if actor is None or actor.role=='admin':
        return True
    from deeptutor.multi_user.identity import get_user_by_id
    record=get_user_by_id(actor.user_id)
    return bool(record and record[1].get('member_type')=='teacher')


def student_rows(c,semester_id,ids):
    rows=c.execute('SELECT s.id,s.name,s.student_no,e.class_id,cl.name class_name FROM students s JOIN student_class_enrollments e ON e.student_id=s.id JOIN classes cl ON cl.id=e.class_id WHERE e.semester_id=? AND s.id IN (SELECT value FROM json_each(?)) ORDER BY s.student_no',(semester_id,json.dumps(sorted(ids)))).fetchall()
    return [dict(r) for r in rows]


def catalog(db, actor, semester_id=None, teacher_id=None, include_students=True):
    with db.connect() as c:
        c.execute('BEGIN')
        semesters = [dict(r) for r in c.execute('SELECT * FROM semesters ORDER BY start_date DESC')]
        selected = semester_id or (semesters[0]['id'] if semesters else None)
        if selected and not any(s['id'] == selected for s in semesters):
            raise HTTPException(404, '学期不存在')
        source, params, teacher = directory.student_source(c, actor, selected, teacher_id)
        fields = 's.id,s.name,s.student_no,e.class_id,cl.name class_name'
        first = c.execute('SELECT ' + fields + ' ' + source + ' ORDER BY s.student_no LIMIT 1', params).fetchone()
        students = [dict(r) for r in c.execute('SELECT ' + fields + ' ' + source + ' ORDER BY s.student_no', params)] if include_students else []
        # Include assigned classes even when no student has enrolled yet.
        if teacher:
            classes = [dict(r) for r in c.execute('SELECT cl.id,cl.name,m.college_id FROM teacher_classes tc JOIN classes cl ON cl.id=tc.class_id JOIN majors m ON m.id=cl.major_id WHERE tc.teacher_id=? AND tc.semester_id=? ORDER BY cl.name', (teacher['id'], selected))]
        else:
            classes = [dict(r) for r in c.execute('SELECT DISTINCT cl.id,cl.name,m.college_id ' + source + ' ORDER BY cl.name', params)]
        colleges = [dict(r) for r in c.execute('SELECT DISTINCT co.id,co.name ' + source + ' ORDER BY co.name', params)]
        if directory.is_admin(actor):
            colleges = [dict(r) for r in c.execute('SELECT id,name FROM colleges ORDER BY name')]
        directory_classes = [dict(r) for r in c.execute('SELECT cl.id,cl.name,m.college_id FROM classes cl JOIN majors m ON m.id=cl.major_id ORDER BY cl.name')] if directory.is_admin(actor) else classes
        return dict(semesters=semesters, semester_id=selected, students=students, directory_classes=directory_classes,
                    first_student=dict(first) if first else None, classes=classes, colleges=colleges,
                    student_count=c.execute('SELECT COUNT(*) ' + source, params).fetchone()[0],
                    teacher=teacher, can_select_teacher=directory.is_admin(actor),
                    can_compare=can_compare(c, actor), demo=bool(c.execute('SELECT 1 FROM demo_datasets LIMIT 1').fetchone()))


def _scoped_rows(c, query, semester_id, ids):
    """Filter in SQLite and bound parameter counts for larger class scopes."""
    result = []
    ordered = sorted(ids)
    for start in range(0, len(ordered), 900):
        chunk = ordered[start:start + 900]
        placeholders = ','.join('?' for _ in chunk)
        result.extend(dict(row) for row in c.execute(
            query.format(scope=placeholders), (semester_id, *chunk)
        ))
    return result


def _grades(c,semester_id,ids):
    return _scoped_rows(c,
        'SELECT g.*,co.code,co.name,co.credits,co.course_type,co.full_score FROM grade_records g JOIN courses co ON co.id=g.course_id WHERE g.semester_id=? AND g.student_id IN ({scope}) AND g.attempt_no=1 ORDER BY co.code',
        semester_id, ids)


def _behavior(c,semester_id,ids):
    return _scoped_rows(c, 'SELECT * FROM behavior_records WHERE semester_id=? AND student_id IN ({scope})', semester_id, ids)


def _metrics(grades,behaviors):
    scores=[100*g['score']/g['full_score'] for g in grades if g['status']=='recorded']
    participation=[100*b['participation_value']/b['participation_scale'] for b in behaviors if b['participation_value'] is not None and b['participation_scale']]
    social=[b['social_activity_value'] for b in behaviors if b['social_activity_value'] is not None and b['social_activity_unit']=='count' and b['social_activity_period']=='month']
    return dict(average=mean(scores),stddev=round(statistics.pstdev(scores),2) if len(scores)>1 else None,
                score_range=round(max(scores)-min(scores),2) if len(scores)>1 else None,
                attendance=mean([b['attendance_rate'] for b in behaviors]),study=mean([b['study_hours_daily'] for b in behaviors]),
                sleep=mean([b['sleep_hours_daily'] for b in behaviors]),internet=mean([b['internet_hours_daily'] for b in behaviors]),
                participation=mean(participation),social=mean(social))


def _tags(m):
    tags=[]
    def add(code,name,value,weight):
        if value is not None: tags.append(dict(code=code,name=name,value=value,weight=weight))
    x=m['average']
    if x is not None:
        add('score_level','成绩等级',next(label for floor,label in [(90,'优秀'),(80,'良好'),(70,'中等'),(60,'及格'),(0,'待提升')] if x>=floor),3)
    x=m['attendance']
    if x is not None: add('attendance_level','考勤表现','出勤稳定' if x>=85 else '关注出勤',2)
    x=m['score_range']
    if x is not None: add('imbalance_level','课程差异','分差较小' if x<=20 else '分差较大',2)
    add('study_hours','日均学习',f"{m['study']:g} 小时" if m['study'] is not None else None,1)
    add('sleep_hours','日均睡眠',f"{m['sleep']:g} 小时" if m['sleep'] is not None else None,1)
    add('participation','课堂参与',f"{m['participation']:g} / 100" if m['participation'] is not None else None,1)
    add('social_activity','月度活动',f"{m['social']:g} 次" if m['social'] is not None else None,1)
    return tags


def overview(db: PortraitDatabase,actor,semester_id,student_id=None,class_id=None,dimension='student',board_mode='date',days=30,teacher_id=None):
    with db.connect() as c:
        c.execute('BEGIN')
        semester=c.execute('SELECT * FROM semesters WHERE id=?',(semester_id,)).fetchone()
        if not semester: raise HTTPException(404,'学期不存在')
        allowed=allowed_students(c,actor,semester_id,teacher_id)
        teacher=directory.teacher_context(c,actor,semester_id,teacher_id)
        candidates=student_rows(c,semester_id,allowed)
        if dimension=='scope':
            if not can_compare(c,actor): raise HTTPException(403,'学生只能查看自己的画像')
            ids={s['id'] for s in candidates if class_id is None or s['class_id']==class_id}
            if class_id is not None and not ids: raise HTTPException(404,'没有可查看的班级画像')
        elif dimension=='class':
            if not can_compare(c,actor): raise HTTPException(403,'学生只能查看自己的画像')
            class_id=class_id or (candidates[0]['class_id'] if candidates else None)
            ids={s['id'] for s in candidates if s['class_id']==class_id}
        else:
            student_id=student_id or (candidates[0]['id'] if candidates else None)
            ids={student_id} if student_id in allowed else set()
        if not ids and dimension!='scope': raise HTTPException(404,'没有可查看的画像，请联系管理员绑定档案和班级')
        selected=[s for s in candidates if s['id'] in ids]
        grades=_grades(c,semester_id,ids); behaviors=_behavior(c,semester_id,ids); m=_metrics(grades,behaviors)
        grouped=defaultdict(list)
        for grade in grades: grouped[grade['course_id']].append(grade)
        courses=[]
        for group in grouped.values():
            g=group[0]; valid=[v for v in group if v['status']=='recorded']
            courses.append(dict(id=g['course_id'],name=g['name'],code=g['code'],credits=g['credits'],earned_credits=mean([earned_credits(v) for v in valid]),kind=g['course_type'],score=mean([v['score'] for v in valid]),full_score=g['full_score'],status=g['status'] if len(group)==1 else 'recorded',sample_count=len(valid)))
        person_gpa=[]; passed=[]
        student_grades=defaultdict(list)
        for g in grades:
            if g['status']=='recorded': student_grades[g['student_id']].append(g)
        for sid in ids:
            gs=student_grades[sid]
            if gs: person_gpa.append(mean([gpa_point(100*g['score']/g['full_score']) for g in gs]))
            if gs: passed.append(sum(earned_credits(g) for g in gs))
        profile=None
        if dimension=='student':
            r=c.execute('SELECT s.*,m.name major_name,co.name college_name FROM students s JOIN student_class_enrollments e ON e.student_id=s.id JOIN classes cl ON cl.id=e.class_id JOIN majors m ON m.id=cl.major_id JOIN colleges co ON co.id=m.college_id WHERE s.id=? AND e.semester_id=?',(student_id,semester_id)).fetchone()
            profile=dict(r);profile['class_name']=selected[0]['class_name']
        radar=[]
        for key,label,maximum,unit in [('average','学业均分',100,'分'),('attendance','出勤率',100,'%'),('study','学习时长',6,'小时/日'),('sleep','睡眠时长',10,'小时/日'),('participation','课堂参与',100,'/100'),('social','社会活动',30,'次/月')]:
            value=m[key]
            radar.append(dict(key=key,label=label,raw=value,unit=unit,maximum=maximum,value=round(min(100,value/maximum*100),2) if value is not None else None))
        points=[]
        if board_mode=='date':
            daily=_scoped_rows(c, 'SELECT * FROM daily_behavior WHERE semester_id=? AND student_id IN ({scope}) ORDER BY observed_date', semester_id, ids)
            dates=sorted({r['observed_date'] for r in daily})[-days:]
            for d in dates:
                values=[r for r in daily if r['observed_date']==d]
                sessions=sum(r['scheduled_sessions'] or 0 for r in values)
                attended=sum(r['attended_sessions'] or 0 for r in values)
                points.append(dict(label=d,attendance=round(attended/sessions*100,2) if sessions else None,study=mean([r['study_hours'] for r in values]),sleep=mean([r['sleep_hours'] for r in values]),internet=mean([r['internet_hours'] for r in values])))
        else:
            for sem in c.execute('SELECT * FROM semesters ORDER BY start_date').fetchall():
                historical=allowed_students(c,actor,sem['id'],teacher_id)
                if dimension=='student': historical &= ids
                if dimension=='class' or (dimension=='scope' and class_id is not None):
                    historical &= {r[0] for r in c.execute('SELECT student_id FROM student_class_enrollments WHERE semester_id=? AND class_id=?',(sem['id'],class_id))}
                if not historical: continue
                bm=_metrics([], _behavior(c,sem['id'],historical))
                points.append(dict(label=sem['name'],attendance=bm['attendance'],study=bm['study'],sleep=bm['sleep'],internet=bm['internet']))
        title = selected[0]['name'] if dimension=='student' else selected[0]['class_name'] if dimension=='class' else '所管学生汇总' if teacher else '全部学生汇总'
        return dict(dimension=dimension,title=title,teacher=teacher,student_id=student_id,class_id=class_id,semester=dict(semester),profile=profile,
                    summary=dict(average=m['average'],gpa=mean(person_gpa),passed_credits=mean(passed) if grades else None,total_credits=sum(g['credits'] for g in courses),course_count=len(courses),student_count=len(ids),behavior_coverage=len(behaviors)),
                    courses=courses,metrics=m,radar=radar,tags=_tags(m),board=dict(mode=board_mode,points=points),
                    demo=bool(c.execute('SELECT 1 FROM demo_datasets LIMIT 1').fetchone()),
                    revision=c.execute('SELECT data_revision FROM portrait_meta').fetchone()[0],
                    calculation='portrait-descriptive-v1 / 首次考试 / 原项目算术平均绩点')
