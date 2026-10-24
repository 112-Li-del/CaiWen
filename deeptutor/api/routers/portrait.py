"""Portrait read APIs. Scope is resolved server-side from verified accounts."""
from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, Depends, Query
from deeptutor.api.routers.auth import require_auth, require_admin
from deeptutor.services.auth import TokenPayload
from deeptutor.portrait.database import PortraitDatabase
from deeptutor.portrait import service

router = APIRouter()


@lru_cache(maxsize=1)
def get_database():
    db = PortraitDatabase()
    db.initialize()
    return db


@router.get('/account-links')
def account_links(_: TokenPayload | None = Depends(require_admin), db: PortraitDatabase = Depends(get_database)):
    with db.connect() as c:
        students = c.execute('SELECT b.account_user_id, s.name, s.student_no code, cl.name class_name FROM account_bindings b JOIN students s ON s.id=b.student_id LEFT JOIN classes cl ON cl.id=s.class_id').fetchall()
        teachers = c.execute("SELECT b.account_user_id, t.name, t.teacher_no code, GROUP_CONCAT(DISTINCT cl.name) class_name FROM account_bindings b JOIN teachers t ON t.id=b.teacher_id LEFT JOIN teacher_classes tc ON tc.teacher_id=t.id LEFT JOIN classes cl ON cl.id=tc.class_id GROUP BY b.account_user_id").fetchall()
        return {**{r['account_user_id']: dict(r, kind='student') for r in students},
                **{r['account_user_id']: dict(r, kind='teacher') for r in teachers}}


@router.get('/catalog')
def catalog(semester_id: int | None = Query(None, ge=1), actor: TokenPayload | None = Depends(require_auth), db: PortraitDatabase = Depends(get_database)):
    return service.catalog(db, actor, semester_id)


@router.get('/overview')
def overview(semester_id: int = Query(...,ge=1), student_id: int | None = Query(None,ge=1), class_id: int | None = Query(None,ge=1),
             dimension: Literal['student','class']='student', board_mode: Literal['date','semester']='date', days: int=Query(30,ge=7,le=90),
             actor: TokenPayload | None = Depends(require_auth), db: PortraitDatabase = Depends(get_database)):
    return service.overview(db,actor,semester_id,student_id,class_id,dimension,board_mode,days)
