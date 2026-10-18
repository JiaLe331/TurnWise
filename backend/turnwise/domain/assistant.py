"""Shift assistant: a Gemini function-calling loop streamed in the Vercel AI SDK UI message
stream protocol (v1), so the web app's `useChat` renders text, tool steps and proposals.

Tools only read. `propose_action` has no server side: the stream ends at it, the manager confirms
or declines in the UI, and the client sends the outcome back as the tool's output.
"""

import json
import logging
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta

from turnwise import gemini
from turnwise.domain.board import build_board
from turnwise.domain.briefing import AiUnavailable, briefing_facts
from turnwise.domain.context import Context, entry_for
from turnwise.domain.errors import BadRequest, DomainError

log = logging.getLogger("turnwise.assistant")
MAX_MESSAGES = 24
MAX_QUESTION = 500
MAX_TOOL_STEPS = 5
BUSY = "Gemini is busy or over quota right now. Try again in a minute."
STREAM_HEADERS = {
    "cache-control": "no-cache",
    "x-vercel-ai-ui-message-stream": "v1",
    "x-accel-buffering": "no",
}

SYSTEM = (
    "You are the shift assistant for a casual-dining restaurant manager, often spoken to on the "
    "floor. Answer in 2 to 4 short sentences that read well aloud. Get every number from a tool; "
    "never invent tables, parties, times or causes, and say plainly when data is thin. Durations "
    "are seconds; quote them in seconds. When comparing three or more numbers, also call show_chart. Call propose_action "
    "only when an action would clearly help and is one its schema allows; the manager must "
    "confirm it, so describe it, don't claim it is done. Camera and Gemini evidence is advisory: "
    "staff confirm every departure and ready state."
)

_OBJ = {"type": "object", "properties": {}}
TOOLS = [
    {
        "name": "get_shift_metrics",
        "description": "Shift timing metrics (median and p90 seconds for departure-to-ready, "
        "review-to-confirmation, ready-to-seated, queue wait), event counts and the camera "
        "review correction rate.",
        "parameters_json_schema": {
            "type": "object",
            "properties": {"hours_back": {"type": "integer", "minimum": 1, "maximum": 24}},
        },
    },
    {
        "name": "get_floor_now",
        "description": "The floor right now: tables by state, blocked tables, waiting parties, "
        "the clearing queue with owners, stale cameras and Gemini table checks.",
        "parameters_json_schema": _OBJ,
    },
    {
        "name": "get_recent_events",
        "description": "The most recent audit events (newest last).",
        "parameters_json_schema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 40}},
        },
    },
    {
        "name": "get_table",
        "description": "One table's session, clearing task and camera evidence.",
        "parameters_json_schema": {
            "type": "object",
            "properties": {"table_id": {"type": "string"}},
            "required": ["table_id"],
        },
    },
    {
        "name": "show_chart",
        "description": "Show a small horizontal bar chart under the answer.",
        "parameters_json_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "unit": {"type": "string"},
                "bars": {
                    "type": "array",
                    "maxItems": 8,
                    "items": {
                        "type": "object",
                        "properties": {"label": {"type": "string"}, "value": {"type": "number"}},
                        "required": ["label", "value"],
                    },
                },
            },
            "required": ["title", "unit", "bars"],
        },
    },
    {
        "name": "propose_action",
        "description": "Propose one action for the manager to confirm. kind=table: action is "
        "confirm_departure, mark_ready, dismiss_review, block or unblock (table_id). kind=task: "
        "claim, start or complete the table's clearing task (table_id, task_id). kind=seat: "
        "action 'seat', seat a waiting party at a ready table (party_id, table_id). kind=party: "
        "cancel or left (party_id).",
        "parameters_json_schema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["table", "task", "seat", "party"]},
                "action": {"type": "string"},
                "table_id": {"type": "string"},
                "task_id": {"type": "string"},
                "party_id": {"type": "string"},
                "title": {"type": "string", "description": "Short imperative, e.g. Mark T4 ready"},
                "reason": {"type": "string", "description": "One line on why, with the numbers"},
            },
            "required": ["kind", "action", "title", "reason"],
        },
    },
]

_FLOOR_KEYS = (
    "now_utc",
    "tables_by_state",
    "blocked_tables",
    "waiting_parties",
    "clearing_queue",
    "unclaimed_clearing_tasks",
    "stale_cameras_on_tables",
    "gemini_table_checks",
)
_METRIC_KEYS = (
    "metrics_seconds",
    "event_counts",
    "vision_review_correction_rate",
    "measurement_notes",
)


def validate(messages: list[dict]) -> None:
    if not messages or len(messages) > MAX_MESSAGES:
        raise BadRequest(f"Send between 1 and {MAX_MESSAGES} messages.")
    last_user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
    if last_user and len(_text(last_user)) > MAX_QUESTION:
        raise BadRequest(f"Keep questions under {MAX_QUESTION} characters.")
    if not gemini.configured():
        raise AiUnavailable("The assistant")


def _text(message: dict) -> str:
    return "".join(
        p.get("text", "") for p in message.get("parts", []) if p.get("type") == "text"
    ).strip()


def _history(messages: list[dict], types) -> list:
    """Past turns as plain prose. Only the current request's loop uses native function calls, so
    thought signatures from earlier requests are never needed. Lookups and charts are left out:
    the model copies any marker it sees in its own past turns back as text."""
    contents = []
    for m in messages:
        if m.get("role") == "user":
            if text := _text(m):
                contents.append(types.Content(role="user", parts=[types.Part(text=text)]))
            continue
        lines, outcomes = [], []
        for p in m.get("parts", []):
            kind = p.get("type", "")
            if kind == "text" and p.get("text"):
                lines.append(p["text"])
            elif kind == "tool-propose_action":
                title = (p.get("input") or {}).get("title", "an action")
                lines.append(f"I proposed: {title}.")
                if out := p.get("output"):
                    outcomes.append(
                        f"Manager's answer to '{title}': {out.get('status')}. {out.get('detail', '')}"
                    )
        if lines:
            contents.append(types.Content(role="model", parts=[types.Part(text="\n".join(lines))]))
        if outcomes:
            contents.append(
                types.Content(role="user", parts=[types.Part(text="\n".join(outcomes))])
            )
    return contents


def run_tool(ctx: Context, name: str, args: dict, end: datetime) -> dict:
    if name == "show_chart":
        return args
    if name == "get_table":
        try:
            return entry_for(ctx, str(args.get("table_id", ""))).model_dump(mode="json")
        except DomainError:
            return {"error": "unknown table"}
    hours = min(max(int(args.get("hours_back", 12)), 1), 24)
    facts = json.loads(
        json.dumps(briefing_facts(ctx, end - timedelta(hours=hours), end), default=str)
    )
    if name == "get_shift_metrics":
        return {"hours_back": hours, **{k: facts[k] for k in _METRIC_KEYS}}
    if name == "get_floor_now":
        return {**{k: facts[k] for k in _FLOOR_KEYS}, "tables": _table_timings(ctx, end)}
    if name == "get_recent_events":
        limit = min(max(int(args.get("limit", 20)), 1), 40)
        return {"events": facts["recent_events"][-limit:]}
    return {"error": f"unknown tool {name}"}


def _table_timings(ctx: Context, now: datetime) -> list[dict]:
    """Per table: state and seconds since it was seated, vacated or made ready."""

    def ago(at: datetime | None) -> float | None:
        return None if at is None else round((now - at).total_seconds())

    return [
        {
            "table": e.table.table_id,
            "seats": e.table.capacity,
            "zone": e.table.zone,
            "state": e.session.operational_state.value,
            "seated_s": ago(e.session.seated_at),
            "departed_s": ago(e.session.departed_at),
            "ready_s": ago(e.session.ready_at),
        }
        for e in build_board(ctx).tables
    ]


def _stream_model(model: str, contents: list, config) -> Iterator[tuple]:
    """Yields ("text", str) and ("call", name, args, part) from one streamed Gemini call."""
    client = gemini._get_client()
    for chunk in client.models.generate_content_stream(
        model=model, contents=contents, config=config
    ):
        for candidate in chunk.candidates or []:
            for part in (candidate.content.parts if candidate.content else None) or []:
                if part.thought:
                    continue
                if part.function_call:
                    call = part.function_call
                    yield ("call", call.name, dict(call.args or {}), part)
                elif part.text:
                    yield ("text", part.text)


def _sse(chunk: dict | str) -> str:
    return f"data: {chunk if isinstance(chunk, str) else json.dumps(chunk, default=str)}\n\n"


def chat_stream(ctx: Context, messages: list[dict], end: datetime) -> Iterator[str]:
    from google.genai import types

    contents = _history(messages, types)
    declarations = [types.FunctionDeclaration(**t) for t in TOOLS]
    # No messageId: the client keeps its own, so a continuation after a confirmed proposal
    # extends the same assistant message instead of starting a copy.
    yield _sse({"type": "start"})
    # The last turn is already answered (a stale client resending after a chart): nothing to ask.
    if not contents or contents[-1].role == "model":
        yield _sse({"type": "finish"})
        yield _sse("[DONE]")
        return
    for step in range(MAX_TOOL_STEPS + 1):
        config = types.GenerateContentConfig(
            system_instruction=SYSTEM,
            temperature=0.2,
            tools=[types.Tool(function_declarations=declarations)]
            if step < MAX_TOOL_STEPS
            else None,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        yield _sse({"type": "start-step"})
        text_id, text, calls, failed = None, "", [], True
        for model in gemini.models():
            try:
                for event in _stream_model(model, contents, config):
                    if event[0] == "text":
                        if text_id is None:
                            text_id = uuid.uuid4().hex
                            yield _sse({"type": "text-start", "id": text_id})
                        text += event[1]
                        yield _sse({"type": "text-delta", "id": text_id, "delta": event[1]})
                    else:
                        calls.append(event)
                failed = False
                break
            except Exception as err:  # noqa: BLE001 - any provider failure falls through
                log.warning("assistant %s failed: %s", model, str(err)[:160])
                if text_id is not None or calls:
                    break  # output already started; don't replay it from another model
        if failed:
            yield _sse({"type": "error", "errorText": BUSY})
            yield _sse("[DONE]")
            return
        if text_id is not None:
            yield _sse({"type": "text-end", "id": text_id})

        model_parts = [types.Part(text=text)] if text else []
        responses, stop = [], False
        for _, name, args, *raw in calls:
            call_id = uuid.uuid4().hex
            yield _sse(
                {
                    "type": "tool-input-available",
                    "toolCallId": call_id,
                    "toolName": name,
                    "input": args,
                }
            )
            if name == "propose_action":
                stop = True
                continue
            try:
                output = run_tool(ctx, name, args, end)
            except Exception as err:  # noqa: BLE001 - a bad argument is the model's to fix
                log.warning("assistant tool %s failed: %s", name, err)
                output = {"error": f"{name} could not run with {args}"}
            yield _sse({"type": "tool-output-available", "toolCallId": call_id, "output": output})
            model_parts.append(
                raw[0]
                if raw and raw[0] is not None
                else types.Part(function_call=types.FunctionCall(name=name, args=args))
            )
            responses.append(types.Part.from_function_response(name=name, response=output))
        yield _sse({"type": "finish-step"})
        # A chart drawn under an answer already written needs nothing more from the model.
        if text and all(call[1] == "show_chart" for call in calls):
            stop = True
        if stop or not responses:
            break
        contents.append(types.Content(role="model", parts=model_parts))
        contents.append(types.Content(role="user", parts=responses))
    yield _sse({"type": "finish"})
    yield _sse("[DONE]")
