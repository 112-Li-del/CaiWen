from deeptutor.api.utils.task_id_manager import TaskIDManager


def test_get_task_status_returns_metadata_copy():
    manager = TaskIDManager()
    task_id = manager.generate_task_id("kb_reindex", "kb:test")

    status = manager.get_task_status(task_id)

    assert status is not None
    assert status["status"] == "running"
    status["status"] = "modified-by-caller"
    assert manager.get_task_status(task_id)["status"] == "running"


def test_get_task_status_returns_empty_mapping_for_unknown_task():
    manager = TaskIDManager()

    assert manager.get_task_status("missing") == {}
