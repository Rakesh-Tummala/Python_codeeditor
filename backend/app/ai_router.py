import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .ai import ask, strip_code_fence

router = APIRouter(prefix="/api/ai", tags=["ai"])


class ExplainErrorRequest(BaseModel):
    file: str
    error: str
    trace_tail: list[dict]
    source: str | None = None


class ExplainErrorResponse(BaseModel):
    explanation: str


class ExplainCodeRequest(BaseModel):
    code: str
    language: str = "python"


class ExplainCodeResponse(BaseModel):
    explanation: str


class FixErrorRequest(BaseModel):
    file: str
    error: str
    trace_tail: list[dict]
    source: str


class FixErrorResponse(BaseModel):
    fixed_code: str


class ReviewCodeRequest(BaseModel):
    file: str
    source: str
    language: str = "python"


class ReviewComment(BaseModel):
    line: int | None
    category: str
    comment: str


class ReviewCodeResponse(BaseModel):
    comments: list[ReviewComment]


EXPLAIN_ERROR_SYSTEM = (
    "You are a debugging assistant embedded in a Python IDE. You are given a real "
    "execution trace captured via sys.settrace, with the actual variable values at "
    "each step leading up to a crash - not just the source code. Ground your "
    "explanation in those concrete values. Name the specific variable and value "
    "that caused the failure. Be concise: 3-5 sentences, no generic advice."
)

EXPLAIN_CODE_SYSTEM = (
    "You are a code-explanation assistant embedded in an IDE. Explain the given "
    "code snippet in plain language for a developer reading it for the first "
    "time. Be concise and concrete about what it does, not generic."
)

FIX_ERROR_SYSTEM = (
    "You are a code-fixing assistant embedded in a Python IDE. You are given a file "
    "that crashed, its traceback, and a real execution trace with the actual variable "
    "values at the point of failure. Output ONLY the complete, corrected version of "
    "the whole file - no explanation, no markdown code fences, no commentary before "
    "or after. Make the minimal change needed to fix the actual bug; do not refactor "
    "or restyle unrelated code."
)


REVIEW_CODE_SYSTEM = (
    "You are a code-review assistant embedded in a Python IDE. Given a source file, "
    "identify concrete issues a careful reviewer would actually flag - not generic advice "
    "like \"add more comments\" or \"consider edge cases\" without naming one. Respond with "
    "ONLY a JSON array (no markdown fences, no commentary) where each element has exactly "
    "these keys: \"line\" (1-based line number the comment applies to, or null if it's about "
    "the file as a whole), \"category\" (one of \"bug-risk\", \"style\", \"complexity\"), and "
    "\"comment\" (one or two concrete sentences naming the specific code and the specific "
    "problem). Only include issues you're genuinely confident about - an empty array is a "
    "valid, honest response for clean code."
)


@router.post("/explain-error", response_model=ExplainErrorResponse)
def explain_error(body: ExplainErrorRequest):
    trace_text = "\n".join(
        f"line {e['line']} in {e['func']} (depth {e['depth']}): locals = {e['locals']}"
        for e in body.trace_tail
    )
    user_prompt = f"A Python script named {body.file} crashed.\n\nTraceback:\n{body.error}\n"
    if body.source:
        user_prompt += f"\nSource code:\n{body.source}\n"
    user_prompt += (
        f"\nExecution trace leading up to the crash (most recent step last):\n{trace_text}\n\n"
        "Explain why this crashed, referencing the actual variable values shown above."
    )
    try:
        explanation = ask(EXPLAIN_ERROR_SYSTEM, user_prompt)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return ExplainErrorResponse(explanation=explanation)


@router.post("/explain-code", response_model=ExplainCodeResponse)
def explain_code(body: ExplainCodeRequest):
    user_prompt = f"Explain this {body.language} code in plain language:\n\n```{body.language}\n{body.code}\n```"
    try:
        explanation = ask(EXPLAIN_CODE_SYSTEM, user_prompt, max_tokens=400)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return ExplainCodeResponse(explanation=explanation)


@router.post("/fix-error", response_model=FixErrorResponse)
def fix_error(body: FixErrorRequest):
    trace_text = "\n".join(
        f"line {e['line']} in {e['func']} (depth {e['depth']}): locals = {e['locals']}"
        for e in body.trace_tail
    )
    user_prompt = (
        f"File: {body.file}\n\nCurrent source:\n{body.source}\n\n"
        f"Traceback:\n{body.error}\n\n"
        f"Execution trace leading up to the crash (most recent step last):\n{trace_text}\n\n"
        "Output the complete corrected file."
    )
    try:
        raw = ask(FIX_ERROR_SYSTEM, user_prompt, max_tokens=2000)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return FixErrorResponse(fixed_code=strip_code_fence(raw))


@router.post("/review-code", response_model=ReviewCodeResponse)
def review_code(body: ReviewCodeRequest):
    user_prompt = f"File: {body.file}\n\n```{body.language}\n{body.source}\n```\n\nReview this code."
    try:
        raw = ask(REVIEW_CODE_SYSTEM, user_prompt, max_tokens=1200, json_mode=True)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Gemini returned malformed review JSON")

    comments = [
        ReviewComment(line=item.get("line"), category=item.get("category", "style"), comment=item.get("comment", ""))
        for item in parsed
    ]
    return ReviewCodeResponse(comments=comments)
