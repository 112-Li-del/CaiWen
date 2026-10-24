"""Deterministic synthetic people. Never creates login accounts or overwrites data."""
from datetime import date, timedelta
import random

from .database import PortraitDatabase


def seed_demo(db: PortraitDatabase, seed: int = 20261024) -> dict:
    db.initialize()
    rng = random.Random(seed)
    with db.transaction() as c:
        if c.execute("SELECT 1 FROM demo_datasets WHERE name='campus-100-v1'").fetchone():
            return {"created": False, "students": 90, "teachers": 10, "classes": 10}
        for table in ("students", "teachers", "classes", "semesters", "courses", "colleges"):
            if c.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                raise ValueError("演示生成仅允许空画像库，不覆盖现有数据")
        c.executemany("INSERT INTO colleges VALUES(?,?,?)", [(1, 'DEMO-F', '演示财经学院'), (2, 'DEMO-I', '演示信息学院')])
        for i, name in enumerate(['金融学', '会计学', '计算机科学与技术', '数据科学'], 1):
            c.execute("INSERT INTO majors VALUES(?,?,?,?)", (i, 1 if i<3 else 2, f'DEMO-M{i}', name))
        for i in range(1, 11):
            major = (i-1)%4+1
            c.execute("INSERT INTO classes VALUES(?,?,?,?,?)", (i, f'DEMO-CL{i:02}', f'演示班级{i:02}', major, 2025))
            c.execute("INSERT INTO teachers VALUES(?,?,?,?,1)", (i, f'DEMO-T{i:03}', f'演示教师{i:02}', 1 if major<3 else 2))
        semesters = [(1,'2025-2026-2','2025—2026 第二学期','2026-02-23','2026-07-12'),(2,'2026-2027-1','2026—2027 第一学期','2026-09-01','2027-01-31')]
        c.executemany("INSERT INTO semesters VALUES(?,?,?,?,?)", semesters)
        courses = [('高等数学',5,'公共基础'),('大学英语',3,'公共基础'),('程序设计基础',4,'专业基础'),('经济学原理',3,'专业基础'),('数据分析方法',3,'专业选修'),('大学体育',1,'公共基础')]
        for i,(name,credit,kind) in enumerate(courses,1):
            c.execute("INSERT INTO courses VALUES(?,?,?,?,?,100)",(i,f'DEMO-C{i:02}',name,credit,kind))
        for sid in range(1,91):
            cid=(sid-1)//9+1
            c.execute("INSERT INTO students(id,student_no,name,class_id,enrollment_date,graduation_date,dormitory) VALUES(?,?,?,?,?,?,?)",(sid,f'DEMO-S{sid:03}',f'演示学生{sid:03}',cid,'2025-09-01','2029-06-30',f'演示宿舍 {1+(sid-1)//30}号楼-{100+(sid-1)//4}'))
            baseline=rng.uniform(53,92)
            for sem in (1,2):
                c.execute("INSERT INTO student_class_enrollments VALUES(?,?,?)",(sid,sem,cid))
                for course in range(1,7):
                    score=round(min(99,max(35,rng.gauss(baseline+(sem-1)*2,9))),1)
                    c.execute("INSERT INTO grade_records(student_id,course_id,semester_id,score) VALUES(?,?,?,?)",(sid,course,sem,score))
                start=date(2026,6,1) if sem==1 else date(2026,9,24)
                scheduled_total=attended_total=0
                hours=[]
                for d in range(30):
                    day=start+timedelta(days=d)
                    scheduled=0 if day.weekday()>4 else rng.choice([2,3,4])
                    attended=sum(rng.random()<min(.99,max(.6,baseline/100+.12)) for _ in range(scheduled))
                    study=round(min(9,max(.3,rng.gauss(baseline/22,1.1))),1)
                    sleep=round(min(10,max(4.5,rng.gauss(7.3,.7))),1)
                    internet=round(min(8,max(.3,rng.gauss(3,1.1))),1)
                    c.execute("INSERT INTO daily_behavior(student_id,semester_id,observed_date,scheduled_sessions,attended_sessions,study_hours,sleep_hours,internet_hours,source_kind) VALUES(?,?,?,?,?,?,?,?, 'demo')",(sid,sem,day.isoformat(),scheduled,attended,study,sleep,internet))
                    scheduled_total+=scheduled; attended_total+=attended; hours.append((study,sleep,internet))
                means=[round(sum(h[i] for h in hours)/len(hours),2) for i in range(3)]
                c.execute("INSERT INTO behavior_records(student_id,semester_id,attendance_rate,study_hours_daily,sleep_hours_daily,internet_hours_daily,participation_value,participation_scale,social_activity_value,social_activity_unit,social_activity_period,source_kind) VALUES(?,?,?,?,?,?,?,?,?,'count','month','demo')",(sid,sem,round(attended_total/scheduled_total*100,2),*means,round(rng.uniform(3,10),1),10,rng.randint(0,25)))
        for tid in range(1,11):
            for sem in (1,2):
                c.execute("INSERT INTO teacher_classes VALUES(?,?,?)",(tid,tid,sem))
        c.execute("INSERT INTO demo_datasets(name,seed) VALUES('campus-100-v1',?)",(seed,))
    return {"created": True, "students": 90, "teachers": 10, "classes": 10}


if __name__ == '__main__':
    import json
    print(json.dumps(seed_demo(PortraitDatabase()), ensure_ascii=False))
