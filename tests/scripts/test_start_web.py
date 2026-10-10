from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types


def _load_start_web_module():
    project_root = Path(__file__).resolve().parents[2]
    scripts_dir = project_root / "scripts"
    module_path = scripts_dir / "start_web.py"
    sys.path.insert(0, str(scripts_dir))
    try:
        spec = importlib.util.spec_from_file_location("start_web_under_test", module_path)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.modules.pop("start_web_under_test", None)
        try:
            sys.path.remove(str(scripts_dir))
        except ValueError:
            pass


def test_start_web_translation_uses_interface_language() -> None:
    start_web = _load_start_web_module()

    assert start_web._t("zh", "backend") == "后端"
    assert start_web._t("en", "frontend") == "Frontend"


def test_state_round_trip(tmp_path: Path) -> None:
    start_web = _load_start_web_module()
    state_path = tmp_path / "start_web_state.json"
    fake_process = types.SimpleNamespace(pid=12345)
    managed = start_web.ManagedProcess(name="backend", process=fake_process, pgid=67890)

    start_web._write_state(
        [managed],
        backend_port=8101,
        frontend_port=4100,
        path=state_path,
    )

    state = start_web._read_state(state_path)
    assert state["backend_port"] == 8101
    assert state["frontend_port"] == 4100
    assert state["processes"]["backend"]["pid"] == 12345
    assert state["processes"]["backend"]["pgid"] == 67890


def test_conflict_matches_recorded_state_by_pid() -> None:
    start_web = _load_start_web_module()
    state = {"processes": {"backend": {"pid": 12345, "pgid": None}}}
    conflict = start_web.PortConflict(
        name="Backend",
        port=8101,
        owners=[start_web.PortOwner(command="python", pid=12345)],
    )

    assert start_web._conflicts_match_state([conflict], state) is True


def test_windows_owner_parsing_uses_netstat_and_tasklist(monkeypatch) -> None:
    """Windows has no lsof; owners must come from netstat + tasklist."""
    start_web = _load_start_web_module()

    netstat_out = (
        "  TCP    0.0.0.0:8001     0.0.0.0:0    LISTENING    21656\n"
        "  TCP    0.0.0.0:8001     0.0.0.0:0    ESTABLISHED  999\n"
        "  TCP    [::]:3782        [::]:0       LISTENING    30268\n"
        "  TCP    0.0.0.0:18001    0.0.0.0:0    LISTENING    11111\n"
    )
    tasklist_out = (
        '"python.exe","21656","Console","1","1,000 K"\n'
        '"node.exe","30268","Console","1","2,000 K"\n'
    )

    class _Result:
        def __init__(self, stdout: str) -> None:
            self.stdout = stdout

    class _FakeSubprocess:
        PIPE = -1
        DEVNULL = -3

        @staticmethod
        def run(command, **_kwargs):
            if command[0] == "netstat":
                return _Result(netstat_out)
            if command[0] == "tasklist":
                return _Result(tasklist_out)
            raise AssertionError(command)

    monkeypatch.setattr(start_web, "subprocess", _FakeSubprocess)

    # Port 18001 must not be mistaken for port 8001.
    assert start_web._windows_listening_owners(8001) == [
        start_web.PortOwner(command="python.exe", pid=21656)
    ]
    assert start_web._windows_listening_owners(3782) == [
        start_web.PortOwner(command="node.exe", pid=30268)
    ]


def test_state_records_listener_pids(tmp_path: Path) -> None:
    """The processes that bound the ports are persisted, not just the parents."""
    start_web = _load_start_web_module()
    state_path = tmp_path / "start_web_state.json"
    managed = start_web.ManagedProcess(
        name="backend", process=types.SimpleNamespace(pid=111), pgid=None
    )

    start_web._write_state(
        [managed],
        backend_port=8001,
        frontend_port=3782,
        path=state_path,
        listeners={"backend": [start_web.PortOwner(command="python.exe", pid=333)]},
    )

    state = start_web._read_state(state_path)
    assert state["listeners"]["backend"][0]["pid"] == 333
    assert (111, None) in start_web._state_process_records(state)
    assert (333, None) in start_web._state_process_records(state)


def test_stale_launch_detected_by_listener_when_parent_died() -> None:
    """Orphaned children keep the ports after the spawned parent dies."""
    start_web = _load_start_web_module()
    state = {
        "processes": {
            "backend": {"pid": 111, "pgid": None},
            "frontend": {"pid": 222, "pgid": None},
        },
        "listeners": {"backend": [{"command": "python.exe", "pid": 333}]},
    }
    conflict = start_web.PortConflict(
        name="Backend",
        port=8001,
        owners=[start_web.PortOwner(command="python.exe", pid=333)],
    )

    assert start_web._conflicts_match_state([conflict], state) is True
