"""Request-local campus execution limits, without server dependencies."""

from contextvars import ContextVar

campus_request = ContextVar("campus_request", default=False)
CAMPUS_TOOLS = frozenset({"rag", "web_search"})
CAMPUS_CAPABILITIES = frozenset({"chat"})


def is_campus_request() -> bool:
    return campus_request.get()


def validate_campus_execution(capability: str, tools: list[str] | None) -> None:
    if capability not in CAMPUS_CAPABILITIES or any(
        tool not in CAMPUS_TOOLS for tool in (tools or [])
    ):
        raise PermissionError("校园服务未开放该能力或工具。")
