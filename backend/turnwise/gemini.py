"""Gemini structured-output calls with timeout, retry and model fallback.

Gemini only describes images or phrases facts; deterministic code still makes every operational
decision. Callers must handle GeminiUnavailable and keep working without it.
"""

import logging
import os
import time

from pydantic import BaseModel

log = logging.getLogger("turnwise.gemini")
# Pinned after the crop benchmark; later entries are fallbacks with separate free-tier quotas
# (20 requests a day per model on the free tier), so a long list keeps the demo answering.
DEFAULT_MODELS = (
    "gemini-2.5-flash,gemini-3.5-flash,gemini-3.6-flash,gemini-flash-latest,"
    "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite"
)
TIMEOUT_S = 30
ATTEMPTS_PER_MODEL = 2


class GeminiUnavailable(RuntimeError):
    pass


def models() -> list[str]:
    return [m.strip() for m in os.environ.get("TURNWISE_GEMINI_MODELS", DEFAULT_MODELS).split(",")]


# The paid-tier key first; the others take over when a key's quota runs out.
KEY_VARS = ("GEMINI_API_KEY_2", "GEMINI_API_KEY_3", "GEMINI_API_KEY")


def keys() -> list[str]:
    return list(dict.fromkeys(v for name in KEY_VARS if (v := os.environ.get(name))))


def configured() -> bool:
    return bool(keys())


# (model, key) pairs Google answered 404 for (model retired for that project); skipped until restart.
_retired: set[tuple[str, str]] = set()


def candidates() -> list[tuple[str, str]]:
    """(model, key) pairs in order: every model on the paid key before any free key."""
    pairs = [(model, key) for key in keys() for model in models()]
    return [p for p in pairs if p not in _retired] or pairs


def give_up_on(model: str, key: str, err: Exception) -> bool:
    """True when retrying this model on this key can't help (quota spent or model retired)."""
    if "NOT_FOUND" in str(err):
        _retired.add((model, key))
    return "RESOURCE_EXHAUSTED" in str(err) or "NOT_FOUND" in str(err)


def key_label(key: str) -> str:
    """Which key, for logs, without the secret."""
    return next((name for name in KEY_VARS if os.environ.get(name) == key), "unknown key")


_clients: dict[str, object] = {}


def _get_client(key: str):
    if key not in _clients:
        from google import genai
        from google.genai import types

        _clients[key] = genai.Client(
            api_key=key, http_options=types.HttpOptions(timeout=TIMEOUT_S * 1000)
        )
    return _clients[key]


def generate[T: BaseModel](contents: list, schema: type[T]) -> tuple[T, str]:
    """Returns (parsed result, model used). Raises GeminiUnavailable after all models fail."""
    if not configured():
        raise GeminiUnavailable("No GEMINI_API_KEY is set.")
    from google.genai import types

    config = types.GenerateContentConfig(
        response_mime_type="application/json", response_schema=schema, temperature=0
    )
    last: Exception | None = None
    for model, key in candidates():
        for attempt in range(ATTEMPTS_PER_MODEL):
            try:
                response = _get_client(key).models.generate_content(
                    model=model, contents=contents, config=config
                )
                if isinstance(response.parsed, schema):
                    return response.parsed, model
                last = ValueError("response did not match the schema")
            except Exception as err:  # noqa: BLE001 - any provider failure falls through
                last = err
                log.warning(
                    "Gemini %s %s attempt %d failed: %s",
                    model,
                    key_label(key),
                    attempt + 1,
                    str(err)[:120],
                )
                if give_up_on(model, key, err):
                    break
            time.sleep(1.5 * (attempt + 1))
    raise GeminiUnavailable(f"All Gemini models failed: {str(last)[:200]}")
