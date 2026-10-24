import bcrypt
import pytest

from deeptutor.multi_user import identity
from deeptutor.portrait import demo_accounts, service
from deeptutor.portrait.database import PortraitDatabase
from deeptutor.portrait.demo import seed_demo
from deeptutor.services.auth import TokenPayload, verify_password


@pytest.fixture
def cohort(tmp_path, monkeypatch):
    monkeypatch.setattr(identity, 'USERS_FILE', tmp_path / 'auth' / 'users.json')
    monkeypatch.setattr(identity, 'LEGACY_USERS_FILE', tmp_path / 'absent.json')
    identity.save_user('owner', 'existing-admin-hash')
    hashed = bcrypt.hashpw(b'11111111', bcrypt.gensalt(rounds=4)).decode()
    monkeypatch.setattr(demo_accounts, 'hash_password', lambda _: hashed)
    db = PortraitDatabase(tmp_path / 'portrait.db')
    seed_demo(db)
    return db


def test_create_real_accounts_and_idempotent_bindings(cohort):
    result = demo_accounts.provision_demo_accounts(cohort, '11111111')
    assert result['created'] == 100
    users = identity.load_users()
    assert len(users) == 101
    for prefix, count, kind in [('stu', 90, 'student'), ('tea', 10, 'teacher')]:
        for i in range(1, count + 1):
            account = users[f'{prefix}{i:03}']
            assert account['role'] == 'user' and account['member_type'] == kind
            assert verify_password('11111111', account['hash'])
    student = users['stu090']
    teacher = users['tea010']
    assert len(service.catalog(cohort, TokenPayload('stu090', 'user', student['id']))['students']) == 1
    assert len(service.catalog(cohort, TokenPayload('tea010', 'user', teacher['id']))['students']) == 9
    assert demo_accounts.provision_demo_accounts(cohort, 'a-new-password')['created'] == 0
    assert identity.load_users() == users
    with cohort.connect() as c:
        assert c.execute('SELECT count(*) FROM account_bindings').fetchone()[0] == 100


def test_conflicting_username_refuses_entire_provision(cohort):
    identity.save_user('stu050', 'unrelated-existing-hash')
    before = identity.USERS_FILE.read_bytes()
    with pytest.raises(ValueError, match='conflicts'):
        demo_accounts.provision_demo_accounts(cohort, '11111111')
    assert identity.USERS_FILE.read_bytes() == before
    with cohort.connect() as c:
        assert c.execute('SELECT count(*) FROM account_bindings').fetchone()[0] == 0
