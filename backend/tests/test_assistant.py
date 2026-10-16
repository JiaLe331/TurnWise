import json
from typing import ClassVar

import pytest
from fastapi.testclient import TestClient

from turnwise.api.deps import get_services
from turnwise.api.main import app
from turnwise.domain import assistant


@pytest.fixture
def client(services):
    app.dependency_overrides[get_services] = lambda: services
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def model(monkeypatch):
    """Scripted Gemini: each call to the model consumes one step (a list of events or an error)."""
    monkeypatch.setenv("GEMINI_API_KEY", "test")

    class Script:
        steps: ClassVar[list] = []
        calls: ClassVar[list] = []

    def fake(model_name, contents, config):
        Script.calls.append((model_name, contents, config))
        step = Script.steps.pop(0) if len(Script.steps) > 1 else Script.steps[0]
        if isinstance(step, Exception):
            raise step
        yield from step

    monkeypatch.setattr(assistant, "_stream_model", fake)
    Script.steps, Script.calls = [], []
    return Script


def user(text: str, n: int = 1) -> dict:
    return {"id": f"u{n}", "role": "user", "parts": [{"type": "text", "text": text}]}


def chunks(response) -> list[dict]:
    lines = [line[6:] for line in response.text.split("\n\n") if line.startswith("data: ")]
    assert lines[-1] == "[DONE]"
    return [json.loads(line) for line in lines[:-1]]


def post(client, messages, path="/outlets/demo-outlet/assistant", headers=None):
    return client.post(path, json={"id": "chat", "messages": messages}, headers=headers)


def test_assistant_streams_text(client, model):
    model.steps = [[("text", "T4 is "), ("text", "slowest.")]]
    r = post(client, [user("Which table is slowest?")])
    assert r.status_code == 200
    assert r.headers["x-vercel-ai-ui-message-stream"] == "v1"
    out = chunks(r)
    types = [c["type"] for c in out]
    assert types[:3] == ["start", "start-step", "text-start"]
    # The client owns message ids, so a continuation after a confirmed proposal stays one message.
    assert "messageId" not in out[0]
    assert types[-3:] == ["text-end", "finish-step", "finish"]
    assert "".join(c["delta"] for c in out if c["type"] == "text-delta") == "T4 is slowest."


def test_assistant_runs_server_tool_then_answers(client, model):
    model.steps = [[("call", "get_floor_now", {})], [("text", "Two tables need clearing.")]]
    out = chunks(post(client, [user("What is happening?")]))
    call = next(c for c in out if c["type"] == "tool-input-available")
    result = next(c for c in out if c["type"] == "tool-output-available")
    assert call["toolName"] == "get_floor_now"
    assert result["toolCallId"] == call["toolCallId"]
    assert "tables_by_state" in result["output"]
    assert out.index(result) < next(i for i, c in enumerate(out) if c["type"] == "text-delta")
    # The second model call saw the tool's answer.
    assert len(model.calls) == 2


def test_assistant_stops_on_propose_action(client, model):
    proposal = {
        "kind": "table",
        "action": "mark_ready",
        "table_id": "T4",
        "title": "Mark T4 ready",
        "reason": "Cleaned 2 min ago.",
    }
    model.steps = [[("call", "propose_action", proposal)]]
    out = chunks(post(client, [user("Anything to do?")]))
    call = next(c for c in out if c["type"] == "tool-input-available")
    assert call["toolName"] == "propose_action" and call["input"]["table_id"] == "T4"
    assert not [c for c in out if c["type"] == "tool-output-available"]
    assert [c["type"] for c in out][-2:] == ["finish-step", "finish"]
    assert len(model.calls) == 1


def test_assistant_caps_tool_steps(client, model):
    model.steps = [[("call", "get_floor_now", {})]] * 5 + [[("text", "Here is what I have.")]]
    out = chunks(post(client, [user("Dig deep")]))
    assert len([c for c in out if c["type"] == "tool-output-available"]) == 5
    assert len(model.calls) == 6
    assert not model.calls[5][2].tools
    assert any(c["type"] == "text-delta" for c in out)


def test_assistant_all_models_fail_streams_error(client, model):
    model.steps = [RuntimeError("429 quota")]
    out = chunks(post(client, [user("How did tonight go?")]))
    errors = [c for c in out if c["type"] == "error"]
    assert len(errors) == 1 and "Gemini is busy" in errors[0]["errorText"]


def test_assistant_limits(client, model, monkeypatch):
    model.steps = [[("text", "ok")]]
    many = [user(f"q{i}", i) for i in range(25)]
    assert post(client, many).status_code == 422
    assert post(client, [user("x" * 501)]).status_code == 422
    monkeypatch.setenv("GEMINI_API_KEY", "")
    r = post(client, [user("hello there")])
    assert r.status_code == 503 and r.json()["code"] == "ai_unavailable"


def test_assistant_history_flattens_tool_parts(client, model):
    model.steps = [[("text", "Done.")]]
    history = [
        user("Anything for T4?"),
        {
            "id": "a1",
            "role": "assistant",
            "parts": [
                {"type": "step-start"},
                {
                    "type": "tool-get_floor_now",
                    "toolCallId": "c1",
                    "state": "output-available",
                    "input": {},
                    "output": {"tables_by_state": {}},
                },
                {
                    "type": "tool-propose_action",
                    "toolCallId": "c2",
                    "state": "output-available",
                    "input": {"title": "Mark T4 ready"},
                    "output": {"status": "done", "detail": "T4 marked ready"},
                },
            ],
        },
    ]
    chunks(post(client, history))
    contents = model.calls[0][1]
    texts = [p.text for c in contents for p in c.parts if p.text]
    assert any("T4 marked ready" in t for t in texts)
    assert not [p for c in contents for p in c.parts if p.function_call]
    assert [c.role for c in contents] == ["user", "model", "user"]


def test_assistant_demo_scope(model):
    model.steps = [[("call", "get_floor_now", {})], [("text", "Fine.")]]
    with TestClient(app) as demo_client:
        info = demo_client.post("/demo/sessions").json()
        headers = {"X-Demo-Session": info["session_id"]}
        r = post(
            demo_client, [user("How is it going?")], "/demo/outlets/demo-outlet/assistant", headers
        )
        assert r.status_code == 200
        assert any(c["type"] == "tool-output-available" for c in chunks(r))


def test_floor_now_lists_per_table_timings(services, clock):
    floor = assistant.run_tool(services.ctx, "get_floor_now", {}, clock.now())
    by_id = {t["table"]: t for t in floor["tables"]}
    occupied = [t for t in floor["tables"] if t["state"] == "occupied"]
    assert occupied and all(t["seated_min"] is not None for t in occupied)
    assert by_id["T1"]["seats"] >= 1


def test_chart_after_answer_ends_the_turn(client, model):
    chart = {"title": "Seated", "unit": "min", "bars": [{"label": "T2", "value": 40}]}
    model.steps = [
        [("text", "T2 has waited longest."), ("call", "show_chart", chart)],
        [("text", "again")],
    ]
    out = chunks(post(client, [user("Compare tables")]))
    assert len(model.calls) == 1
    assert "".join(c["delta"] for c in out if c["type"] == "text-delta") == "T2 has waited longest."
    assert any(c["type"] == "tool-output-available" and c["output"] == chart for c in out)


def test_bad_tool_arguments_become_an_error_result(client, model):
    model.steps = [[("call", "get_shift_metrics", {"hours_back": "tonight"})], [("text", "Sorry.")]]
    out = chunks(post(client, [user("How was tonight?")]))
    result = next(c for c in out if c["type"] == "tool-output-available")
    assert "error" in result["output"]
    assert [c["type"] for c in out][-1] == "finish"
