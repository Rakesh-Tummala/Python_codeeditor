import os
import time

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

load_dotenv()

MODEL = "gemini-3.7-flash"

_client: genai.Client | None = None


def strip_code_fence(text: str) -> str:
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.split("\n")
    lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines)


def get_client() -> genai.Client:
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        _client = genai.Client(api_key=api_key)
    return _client


def ask(system_prompt: str, user_prompt: str, max_tokens: int = 600, json_mode: bool = False) -> str:
    client = get_client()
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        max_output_tokens=max_tokens,
        # This task is bounded explanation, not open-ended reasoning - thinking
        # tokens draw from the same max_output_tokens budget as the visible
        # response, so leaving thinking on can silently truncate the answer
        # before it finishes (observed: 333 thinking tokens vs. a 400 budget).
        thinking_config=types.ThinkingConfig(thinking_budget=0),
        # Constrains the response to valid JSON at the API level, rather than
        # just asking nicely in the prompt and hoping - used by callers that
        # need to json.loads() the result (e.g. code review comments).
        response_mime_type="application/json" if json_mode else None,
    )

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = client.models.generate_content(model=MODEL, contents=user_prompt, config=config)
            return response.text
        except errors.ClientError as e:
            # 429 quota-exceeded won't resolve itself in a few seconds like a
            # transient server hiccup does - retrying just burns the same
            # tight daily/per-minute cap that already tripped it.
            if e.code == 429:
                raise RuntimeError(
                    "Gemini API quota exceeded (free tier is capped at 20 requests/day for "
                    "this model). Wait for it to reset or upgrade your plan."
                ) from e
            raise RuntimeError(f"Gemini API rejected the request: {e}") from e
        except errors.ServerError as e:
            last_error = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Gemini API unavailable after retries: {last_error}")
