"""Gemini structured-output calls with timeout, retry and model fallback.

Gemini only describes images or phrases facts; deterministic code still makes every operational
decision. Callers must handle GeminiUnavailable and keep working without it.
"""

import logging
import os
import time

from pydantic import BaseModel

log = logging.getLogger("turnwise.gemini")
# Pinned after the crop benchmark; later entries are fallbacks with separate free-tier quotas.
DEFAULT_MODELS = "gemini-2.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-flash-latest"
TIMEOUT_S = 30
ATTEMPTS_PER_MODEL = 2


class GeminiUnavailable(RuntimeError):
    pass


def models() -> list[str]:
    return [m.strip() for m in os.environ.get("TURNWISE_GEMINI_MODELS", DEFAULT_MODELS).split(",")]


def configured() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


_client = None


def _get_client():
    global _client
    if _client is None:
        from google import genai
        from google.genai import types

        _client = genai.Client(http_options=types.HttpOptions(timeout=TIMEOUT_S * 1000))
    return _client


def generate[T: BaseModel](contents: list, schema: type[T]) -> tuple[T, str]:
    """Returns (parsed result, model used). Raises GeminiUnavailable after all models fail."""
    if not configured():
        raise GeminiUnavailable("GEMINI_API_KEY is not set.")
    from google.genai import types

    config = types.GenerateContentConfig(
        response_mime_type="application/json", response_schema=schema, temperature=0
    )
    last: Exception | None = None
    for model in models():
        for attempt in range(ATTEMPTS_PER_MODEL):
            try:
                response = _get_client().models.generate_content(
                    model=model, contents=contents, config=config
                )
                if isinstance(response.parsed, schema):
                    return response.parsed, model
                last = ValueError("response did not match the schema")
            except Exception as err:  # noqa: BLE001 - any provider failure falls through
                last = err
                log.warning("Gemini %s attempt %d failed: %s", model, attempt + 1, str(err)[:120])
            time.sleep(1.5 * (attempt + 1))
    raise GeminiUnavailable(f"All Gemini models failed: {str(last)[:200]}")
