# CaiWen（财问） — Agent-Native Architecture

## Overview

CaiWen（财问）is the campus question-answering deployment of DeepTutor for
南京财经大学 (Nanjing University of Finance and Economics). It keeps
DeepTutor's **agent-native** two-layer model (Tools + Capabilities) with three
entry points — CLI, WebSocket API, and Python SDK — and adds the campus
knowledge bases (学生手册 / 招生政策), the 财问 branding, and a trimmed
frontend entry surface.

> Frontend entry policy lives in `web/lib/features.ts`: the campus deployment
> hides the playground capabilities and most tools from the UI ("收入口不删码"),
> but **the backend code and registrations are all retained**. Do not delete
> those modules when acting on the hiding list.

## Architecture

```
Entry Points:  CLI (Typer)  |  WebSocket /api/v1/ws  |  Python SDK
                    ↓                   ↓                   ↓
              ┌─────────────────────────────────────────────────┐
              │              ChatOrchestrator                    │
              │   routes to ChatCapability (default)             │
              │   or a selected deep Capability                  │
              └──────────┬──────────────┬───────────────────────┘
                         │              │
              ┌──────────▼──┐  ┌────────▼──────────┐
              │ ToolRegistry │  │ CapabilityRegistry │
              │  (Level 1)   │  │   (Level 2)        │
              └──────────────┘  └────────────────────┘
```

### Level 1 — Tools

Lightweight single-function tools the LLM calls on demand. All of them are
defined in `deeptutor/tools/builtin/__init__.py` (`BUILTIN_TOOL_TYPES`):

| Tool                | Description                                    |
| ------------------- | ---------------------------------------------- |
| `rag`               | Knowledge base retrieval (RAG)                 |
| `web_search`        | Web search with citations                      |
| `code_execution`    | Sandboxed Python execution                     |
| `reason`            | Dedicated deep-reasoning LLM call              |
| `brainstorm`        | Breadth-first idea exploration with rationale  |
| `paper_search`      | arXiv academic paper search                    |
| `geogebra_analysis` | Image → GeoGebra commands (4-stage vision pipeline) |

### Level 2 — Capabilities

Multi-step agent pipelines that take over the conversation. All of them live in
`deeptutor/capabilities/` and are registered by class path in
`deeptutor/runtime/bootstrap/builtin_capabilities.py`
(`BUILTIN_CAPABILITY_CLASSES`) — there is **no plugin directory and no
`manifest.yaml` discovery**:

| Capability       | Module                              | Stages                                         |
| ---------------- | ----------------------------------- | ---------------------------------------------- |
| `chat`           | `capabilities/chat.py`              | thinking → acting → observing → responding (tool-augmented) |
| `deep_solve`     | `capabilities/deep_solve.py`        | planning → reasoning → writing                 |
| `deep_question`  | `capabilities/deep_question.py`     | ideation → evaluation → generation → validation |
| `deep_research`  | `capabilities/deep_research.py`     | multi-agent research + reporting               |
| `math_animator`  | `capabilities/math_animator.py`     | Manim animation pipeline                       |
| `visualize`      | `capabilities/visualize.py`         | visual explanation pipeline                    |

## CLI Usage

```bash
# Install CLI
pip install -e ".[cli]"

# Run any capability (agent-first entry point)
deeptutor run chat "Explain Fourier transform"
deeptutor run deep_solve "Solve x^2=4" -t rag --kb my-kb
deeptutor run deep_question "Linear algebra" --config num_questions=5

# Interactive REPL
deeptutor chat
# (inside the REPL: /regenerate or /retry re-runs the last user message)

# Knowledge bases
deeptutor kb list
deeptutor kb create my-kb --doc textbook.pdf

# Inspect registered tools/capabilities, and memory
deeptutor plugin list
deeptutor memory show

# API server (requires .[server])
deeptutor serve --port 8001
```

`deeptutor plugin list` is a **registry inspection command**: it prints the
tools and capabilities currently registered in `ToolRegistry` /
`CapabilityRegistry`. It does not read plugins from disk.

## Key Files

| Path                          | Purpose                              |
| ----------------------------- | ------------------------------------ |
| `deeptutor/runtime/orchestrator.py` | ChatOrchestrator — unified entry     |
| `deeptutor/core/stream.py`          | StreamEvent protocol                 |
| `deeptutor/core/stream_bus.py`      | Async event fan-out                  |
| `deeptutor/core/tool_protocol.py`   | BaseTool abstract class              |
| `deeptutor/core/capability_protocol.py` | BaseCapability abstract class    |
| `deeptutor/core/context.py`         | UnifiedContext dataclass             |
| `deeptutor/runtime/registry/tool_registry.py` | Tool discovery & registration |
| `deeptutor/runtime/registry/capability_registry.py` | Capability discovery & registration |
| `deeptutor/runtime/bootstrap/builtin_capabilities.py` | Built-in capability class paths |
| `deeptutor/runtime/mode.py`         | RunMode (CLI vs SERVER)              |
| `deeptutor/capabilities/`           | Built-in capability implementations  |
| `deeptutor/tools/builtin/__init__.py` | Built-in tool implementations      |
| `deeptutor_cli/main.py`             | Typer CLI entry point                |
| `deeptutor/api/routers/unified_ws.py` | Unified WebSocket endpoint         |
| `web/`                              | Next.js 16 frontend                  |
| `web/lib/features.ts`               | Frontend entry visibility policy     |

## Adding a Capability

Capabilities are plain classes, registered by import path — no manifest and no
discovery step:

1. Implement the class under `deeptutor/capabilities/<name>.py`, extending
   `BaseCapability` from `deeptutor.core.capability_protocol`.
2. Add its class path to `BUILTIN_CAPABILITY_CLASSES` in
   `deeptutor/runtime/bootstrap/builtin_capabilities.py`.
3. If it should be selectable in the frontend, update `web/lib/features.ts`
   (and the related `ADMIN_ROUTES` / `ADMIN_ONLY_HREFS` lists noted there).

```python
from deeptutor.core.capability_protocol import BaseCapability, CapabilityManifest
from deeptutor.core.context import UnifiedContext
from deeptutor.core.stream_bus import StreamBus

class MyCapability(BaseCapability):
    manifest = CapabilityManifest(
        name="my_capability",
        description="My custom capability",
        stages=["step1", "step2"],
    )

    async def run(self, context: UnifiedContext, stream: StreamBus) -> None:
        async with stream.stage("step1", source=self.name):
            await stream.content("Working on step 1...", source=self.name)
        await stream.result({"response": "Done!"}, source=self.name)
```

## Dependency Layers

Defined in `pyproject.toml` `[project.optional-dependencies]`. Mirrored as flat
lists in `requirements/*.txt` for Docker/CI installs without source code.

```
.[cli]            — CLI full (LLM + RAG + providers + document parsing)
.[server]         — .[cli] + FastAPI/uvicorn (for Web/API)
.[tutorbot]       — .[server] + TutorBot agent engine + channel SDKs
.[matrix]         — Matrix channel for TutorBot (matrix-nio[e2e]; needs libolm)
.[math-animator]  — Manim addon (for `deeptutor animate`)
.[dev]            — .[server] + test/lint tools
.[all]            — Everything above
```

## Repository Notes

- Branch strategy in this fork: `main`, `speed-version`, `ball` (there is **no
  `dev` branch** here).
- Python ≥ 3.11. The local venv is `./.venv` (Windows); `start.bat` runs
  `.venv\Scripts\python.exe scripts\start_web.py`.
- `scripts/start_web.py` **requires `npm` on PATH** and starts the backend
  (`deeptutor.api.run_server`, port 8001) plus the frontend (`next dev`, port
  3782). Ports come from `BACKEND_PORT` / `FRONTEND_PORT` in `.env`.
- Chinese text files in this repo have **no BOM**: read them as UTF-8
  explicitly. Windows PowerShell 5.1 `Get-Content` defaults to the ANSI
  codepage and will produce mojibake.
