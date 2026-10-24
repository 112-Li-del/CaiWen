"""Provision real local login accounts for the existing synthetic portrait cohort."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import shutil

from deeptutor.multi_user import identity
from deeptutor.services.auth import hash_password

from .database import PortraitDatabase


def provision_demo_accounts(db: PortraitDatabase, password: str, *, progress=None) -> dict:
    if len(password) < 8:
        raise ValueError("Password must contain at least eight characters")
    db.initialize()
    users = identity.load_users()
    if not any(u['role'] == 'admin' for u in users.values()):
        raise ValueError("Create the real administrator account before demo accounts")
    plans = []
    with db.connect() as c:
        if not c.execute("SELECT 1 FROM demo_datasets WHERE name='campus-100-v1'").fetchone():
            raise ValueError("Expected the existing campus-100-v1 synthetic dataset")
        for kind, prefix, code_prefix, count, table, field in [
            ('student', 'stu', 'DEMO-S', 90, 'students', 'student_no'),
            ('teacher', 'tea', 'DEMO-T', 10, 'teachers', 'teacher_no'),
        ]:
            for number in range(1, count + 1):
                username = f'{prefix}{number:03}'
                row = c.execute(f'SELECT id FROM {table} WHERE {field}=?',
                                (f'{code_prefix}{number:03}',)).fetchone()
                if row is None:
                    raise ValueError(f'Missing synthetic profile: {username}')
                target = (row[0], None) if kind == 'student' else (None, row[0])
                binding = c.execute(
                    'SELECT * FROM account_bindings WHERE student_id=? OR teacher_id=?', target
                ).fetchone()
                existing = users.get(username)
                if existing:
                    if (existing['role'] != 'user' or existing.get('member_type') != kind
                            or existing.get('disabled') or existing.get('status') != 'active'
                            or not binding or binding['account_user_id'] != existing['id']):
                        raise ValueError(f'Existing account conflicts; not modified: {username}')
                elif binding:
                    raise ValueError(f'Profile already belongs to another account: {username}')
                plans.append((username, kind, target, existing))

    pending = [p for p in plans if p[3] is None]
    backup_dir = None
    if pending:
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup_dir = db.path.parent / 'backups' / f'before-demo-accounts-{stamp}'
        backup_dir.mkdir(parents=True, exist_ok=False)
        shutil.copy2(identity.USERS_FILE, backup_dir / 'users.json')
        db.backup(backup_dir / 'portrait.db')
    created = 0
    for username, kind, (student_id, teacher_id), existing in plans:
        if existing:
            continue
        # Each account receives its own bcrypt salt. Plain passwords are never persisted.
        record = identity.save_user(username, hash_password(password), create_only=True)
        identity.set_member_type(username, kind)
        db.bind_account(record['id'], student_id=student_id, teacher_id=teacher_id)
        created += 1
        if progress and created % 10 == 0:
            progress(created, len(pending))
    return {'created': created, 'existing': 100 - created, 'bound': 100,
            'backup': str(backup_dir) if backup_dir else None}


if __name__ == '__main__':
    import getpass
    import json

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--password', help='Initial password; omit to enter it without echo')
    args = parser.parse_args()
    result = provision_demo_accounts(
        PortraitDatabase(), args.password or getpass.getpass('Initial password: '),
        progress=lambda done, total: print(f'Created and bound {done}/{total}', flush=True),
    )
    print(json.dumps(result, ensure_ascii=False))
