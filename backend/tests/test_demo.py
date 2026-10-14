from fastapi.testclient import TestClient

from turnwise.api.main import app
from turnwise.demo import registry

client = TestClient(app)
STAFF = {"X-Actor-Id": "staff-ana", "X-Actor-Role": "floor_staff"}


def start():
    info = client.post("/demo/sessions").json()
    return info, {"X-Demo-Session": info["session_id"]}


def play(info, until, step=0.25, frm=0.0):
    t = frm
    while t < until:
        t = min(t + step, until)
        client.post(f"/demo/sessions/{info['session_id']}/tick", json={"media_s": t})


def events(info):
    return [e.event_type for e in registry.get(info["session_id"]).services.ctx.repo.list_events()]


def board(headers):
    return client.get("/demo/outlets/demo-outlet/board", headers=headers).json()


def state(headers, table_id):
    return next(e for e in board(headers)["tables"] if e["table"]["table_id"] == table_id)


def test_session_replays_story_beats_on_demo_clock():
    info, headers = start()
    assert 14.9 < info["duration_s"] <= 15.0 and info["camera_id"] == "cam-02"
    assert state(headers, "T2")["session"]["operational_state"] == "occupied"

    play(info, 6.0)
    assert [p["queue_code"] for p in board(headers)["waitlist"]] == ["W1", "W2"]
    assert state(headers, "T2")["session"]["operational_state"] == "occupied"

    play(info, 8.0, frm=6.0)  # T2 guests left at ~6.1 s; 30 sim s = 1.5 media s later
    t2 = state(headers, "T2")
    assert t2["session"]["operational_state"] == "departure_review"
    assert t2["evidence"]["review_source"] == "observation"

    play(info, 15.0, frm=8.0)
    kinds = events(info)
    # A waiter passing T2's chair withdraws the review; it is requested again after 30 s.
    assert kinds.count("departure_review_requested") == 2
    assert "departure_review_withdrawn" in kinds
    assert "occupancy_on_ready_table" in kinds  # party sat at T4 while it was still ready
    assert "ready_table_leftovers_seen" in kinds  # Gemini: bag left on ready T1
    assert state(headers, "T1")["evidence"]["table_check"]["items"] == ["belongings"]


def test_viewer_actions_use_the_session_and_are_isolated():
    info, headers = start()
    _other, other_headers = start()
    play(info, 8.0)
    version = state(headers, "T2")["session"]["state_version"]
    r = client.post(
        "/demo/tables/T2/actions",
        json={"action": "confirm_departure", "expected_version": version},
        headers={**headers, **STAFF, "Idempotency-Key": "k1"},
    )
    assert r.status_code == 200
    assert r.json()["session"]["operational_state"] == "needs_clearing"
    assert state(other_headers, "T2")["session"]["operational_state"] == "occupied"
    live = client.get("/outlets/demo-outlet/board").json()
    assert len(live["tables"]) == 14  # the live outlet is untouched


def test_clock_only_moves_forward_and_expired_session_is_404():
    info, _headers = start()
    play(info, 4.0)
    r = client.post(f"/demo/sessions/{info['session_id']}/tick", json={"media_s": 1.0}).json()
    assert r["media_s"] == 4.0
    missing = client.get("/demo/outlets/demo-outlet/board", headers={"X-Demo-Session": "nope"})
    assert missing.status_code == 404 and missing.json()["code"] == "demo_session_expired"


def start_mode(mode):
    info = client.post("/demo/sessions", json={"mode": mode}).json()
    return info, {"X-Demo-Session": info["session_id"]}


def states(info):
    repo = registry.get(info["session_id"]).services.ctx.repo
    return {t: repo.get_session(t).operational_state.value for t in ("T1", "T2", "T3", "T4")}


def test_autoplay_follows_the_footage():
    info, headers = start_mode("autoplay")
    assert info["mode"] == "autoplay"
    play(info, 3.5)
    assert states(info)["T3"] == "cleaning"  # guests left ~3 s; autopilot confirmed and cleans
    play(info, 4.5, frm=3.5)
    assert states(info)["T3"] == "occupied"  # W1 seated as the footage shows a new couple
    play(info, 8.75, frm=4.5)
    assert states(info)["T4"] == "occupied"  # W2 (6) seated just before they sit on camera
    play(info, 15.0, frm=8.75)
    assert states(info) == {"T1": "ready", "T2": "ready", "T3": "occupied", "T4": "occupied"}
    seated = {p["queue_code"] for p in board(headers)["waitlist"]}
    assert seated == {"W3"}  # only the window party is still waiting
    tick = client.post(f"/demo/sessions/{info['session_id']}/tick", json={"media_s": 15.0}).json()
    texts = [n["text"] for n in tick["narration"]]
    assert any("W2 sits down at T4" in t for t in texts)
    assert any(t.startswith("Gemini: T1") for t in texts)
    assert not any("skipped" in t for t in texts)


def test_guided_mode_never_acts_for_the_viewer():
    info, _ = start_mode("guided")
    play(info, 15.0)
    assert states(info)["T3"] == "occupied" and states(info)["T4"] == "ready"
    assert "departure_confirmed" not in events(info)


def test_switching_to_autoplay_mid_way_skips_past_steps():
    info, _ = start_mode("guided")
    play(info, 5.0)
    r = client.post(f"/demo/sessions/{info['session_id']}/mode", json={"mode": "autoplay"})
    assert r.json()["mode"] == "autoplay"
    play(info, 15.0, frm=5.0)
    s = states(info)
    assert s["T3"] == "occupied" and s["T4"] == "occupied" and s["T2"] == "ready"
    assert events(info).count("departure_confirmed") == 1  # T2 only; T3's step had passed
