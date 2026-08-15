import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .ai import ask
from .execution import execute_in_sandbox
from .sessions_store import get_session_dir, resolve_safe_path

router = APIRouter(prefix="/api/sessions", tags=["tests"])

TEST_GEN_SYSTEM = (
    "You are a test-generation assistant embedded in a Python IDE. Given the source of a "
    "Python file, write a self-contained test script that exercises its functions with "
    "realistic inputs and edge cases (empty input, zero, negative numbers, boundary "
    "values - whatever is relevant to this specific code). Requirements:\n"
    "1. Import the target module with a plain `import <module_name>` (module name is the "
    "filename without the .py extension) - it sits in the same directory as this script.\n"
    "2. Write each test as its own function that raises AssertionError on failure.\n"
    "3. At the bottom, run every test function inside its own try/except, and for each one "
    "print exactly one line in this exact format (nothing else on that line): "
    "`PYTRACE_RESULT|<test_name>|PASS` on success, or `PYTRACE_RESULT|<test_name>|FAIL|<short "
    "reason>` on failure. The reason must not contain a `|` character.\n"
    "4. Output ONLY the complete Python script - no markdown fences, no commentary before or "
    "after."
)

_RESULT_LINE = re.compile(r"^PYTRACE_RESULT\|([^|]+)\|(PASS|FAIL)(?:\|(.*))?$")


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.split("\n")
    lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines)


def _test_path_for(source_path: str) -> str:
    if "/" in source_path:
        directory, name = source_path.rsplit("/", 1)
        return f"{directory}/test_{name}"
    return f"test_{source_path}"


class GenerateTestsRequest(BaseModel):
    file: str


class TestCaseResult(BaseModel):
    name: str
    passed: bool
    message: str | None = None


class GenerateTestsResponse(BaseModel):
    test_file: str
    test_code: str
    results: list[TestCaseResult]
    stdout: str
    stderr: str


@router.post("/{session_id}/generate-tests", response_model=GenerateTestsResponse)
def generate_tests(session_id: str, body: GenerateTestsRequest):
    session_dir = get_session_dir(session_id)
    source_target = resolve_safe_path(session_dir, body.file)
    if not source_target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    source = source_target.read_text(encoding="utf-8")

    user_prompt = f"File: {body.file}\n\nSource:\n{source}\n\nGenerate the test script."
    try:
        raw = ask(TEST_GEN_SYSTEM, user_prompt, max_tokens=1500)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    test_code = _strip_code_fence(raw)

    test_path = _test_path_for(body.file)
    test_target = resolve_safe_path(session_dir, test_path)
    test_target.write_text(test_code, encoding="utf-8")

    # Genuinely executed through the same sandboxed pipeline as a normal
    # Run, not just displayed - the whole point of this feature.
    run_result = execute_in_sandbox(session_dir, test_path)

    results: list[TestCaseResult] = []
    for line in run_result.stdout.splitlines():
        match = _RESULT_LINE.match(line.strip())
        if not match:
            continue
        name, status, reason = match.groups()
        results.append(TestCaseResult(name=name, passed=status == "PASS", message=reason or None))

    return GenerateTestsResponse(
        test_file=test_path,
        test_code=test_code,
        results=results,
        stdout=run_result.stdout,
        stderr=run_result.stderr,
    )
