"""Gemini shift briefing: deterministic facts in, plain-language manager summary out."""

import json
import threading
import time
from collections import Counter
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from turnwise import gemini
from turnwise.contracts import PartyStatus
from turnwise.domain.board import build_board
from turnwise.domain.context import Context
from turnwise.domain.errors import DomainError
from turnwise.domain.metrics import shift_metrics

PROMPT_VERSION = "shift-briefing-v1"
CHECK_LABEL = {
    "clear_and_set": "clean and set for the next guests (nothing to do)",
    "leftovers": "items left behind that staff should remove",
    "unclear": "too blurry to judge",
}
CACHE_S = 120
PROMPT = (
    "You are the shift assistant for a casual-dining restaurant manager. Using ONLY the JSON facts "
    "below, write a short headline, up to 5 highlights and up to 3 concrete suggestions for the "
    "rest of the shift. Quote numbers exactly as given (durations are minutes). If the data is "
    "sparse or a metric has no samples, say so plainly. Never invent tables, parties, times or "
    "causes; camera evidence is advisory and staff confirm every departure and ready state."
)


class Briefing(BaseModel):
    headline: str = Field(max_length=160)
    highlights: list[str] = Field(max_length=5)
    suggestions: list[str] = Field(max_length=3)


class ShiftBriefing(BaseModel):
    outlet_id: str
    generated_at: datetime
    window_start: datetime
    window_end: datetime
    model: str
    prompt_version: str
    ai_generated: bool = True
    briefing: Briefing
    facts: dict


class Answer(BaseModel):
    answer: str = Field(max_length=700)
    facts_used: list[str] = Field(max_length=5)
    answerable: bool


class ShiftAnswer(BaseModel):
    question: str
    generated_at: datetime
    model: str
    prompt_version: str
    ai_generated: bool = True
    result: Answer


class Recommendation(BaseModel):
    title: str = Field(max_length=90)
    evidence: str = Field(max_length=240)
    expected_impact: str = Field(max_length=200)
    effort: Literal["low", "medium", "high"]


class Insights(BaseModel):
    recommendations: list[Recommendation] = Field(max_length=4)


class ShiftInsights(BaseModel):
    generated_at: datetime
    model: str
    prompt_version: str
    ai_generated: bool = True
    insights: Insights
    facts: dict


ASK_PROMPT = (
    "You answer a restaurant manager's question about the current shift using ONLY the JSON "
    "facts that follow the question. Durations are minutes. If the facts cannot answer it, set "
    "answerable=false and say what data is missing. Name the specific facts you used. Never "
    "invent numbers, tables or causes. Keep the answer under 80 words."
)
INSIGHTS_PROMPT = (
    "You are an operations analyst for a casual-dining restaurant. From ONLY the JSON facts, "
    "propose up to 4 concrete changes that would reduce the time between guests leaving and the "
    "next party being seated (clearing speed, task ownership, seating order, table mix, camera "
    "coverage). For each give the evidence from the facts, the expected impact phrased as a "
    "hypothesis to measure (no percentages or numeric targets unless they appear in the facts), "
    "and the effort. If data is sparse, say so in the evidence and keep recommendations modest. "
    "Never invent numbers."
)


class AiUnavailable(DomainError):
    status_code = 503
    code = "ai_unavailable"

    def __init__(self, what: str) -> None:
        super().__init__(
            f"{what} is unavailable: Gemini is busy or over quota right now. Try again in a minute."
        )


def _minutes(seconds: float | None) -> float | None:
    return None if seconds is None else round(seconds / 60, 1)


def briefing_facts(ctx: Context, start: datetime, end: datetime) -> dict:
    now = ctx.clock.now()
    board = build_board(ctx)
    metrics = shift_metrics(ctx, start, end)
    waiting = [p for p in board.waitlist if p.status is PartyStatus.WAITING]
    unclaimed = [e for e in board.clearing_queue if e.task is not None and e.task.owner_id is None]
    return {
        "now_utc": now.isoformat(timespec="minutes"),
        "tables_by_state": dict(Counter(e.session.operational_state.value for e in board.tables)),
        "blocked_tables": [e.table.table_id for e in board.tables if e.table.blocked],
        "waiting_parties": [
            {
                "code": p.queue_code,
                "size": p.size,
                "waiting_min": round((now - p.arrival_at).total_seconds() / 60, 1),
                "needs": p.requirements,
            }
            for p in waiting
        ],
        "clearing_queue": [
            {
                "table": e.table.table_id,
                "state": e.session.operational_state.value,
                "owner": e.task.owner_id if e.task else None,
                "why_first": e.task.priority_reason if e.task else None,
            }
            for e in board.clearing_queue
        ],
        "unclaimed_clearing_tasks": len(unclaimed),
        "stale_cameras_on_tables": [
            e.table.table_id for e in board.tables if e.evidence and e.evidence.stale
        ],
        # Plain-language labels: the raw "clear_and_set" reads like an instruction to a model.
        "gemini_table_checks": {
            e.table.table_id: {
                "looks": CHECK_LABEL[e.evidence.table_check.state],
                "items_seen": e.evidence.table_check.items,
                "table_state": e.session.operational_state.value,
            }
            for e in board.tables
            if e.evidence and e.evidence.table_check
        },
        "metrics_minutes": {
            d.metric: {"samples": d.count, "median": _minutes(d.median_s), "p90": _minutes(d.p90_s)}
            for d in metrics.durations
        },
        "event_counts": metrics.counts,
        "vision_review_correction_rate": metrics.vision_review_correction_rate,
        "measurement_notes": metrics.notes,
        "recent_events": [
            {
                "minutes_ago": round((now - e.event_time).total_seconds() / 60, 1),
                "type": e.event_type,
                "table": e.table_id,
                "actor": e.actor_type,
                "detail": (e.reason or "")[:120],
            }
            for e in ctx.repo.list_events()[-40:]
            if e.event_type != "state_initialized"
        ],
    }


class BriefingService:
    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx
        self._cache: dict[tuple, tuple[float, ShiftBriefing]] = {}
        self._lock = threading.Lock()

    def generate(self, start: datetime, end: datetime) -> ShiftBriefing:
        key = (start.replace(second=0, microsecond=0), end.replace(second=0, microsecond=0))
        with self._lock:
            hit = self._cache.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1]
        facts = briefing_facts(self.ctx, start, end)
        try:
            briefing, model = gemini.generate([PROMPT, json.dumps(facts, default=str)], Briefing)
        except gemini.GeminiUnavailable as err:
            raise AiUnavailable("The shift briefing") from err
        result = ShiftBriefing(
            outlet_id=self.ctx.repo.outlet_id,
            generated_at=self.ctx.clock.now(),
            window_start=start,
            window_end=end,
            model=model,
            prompt_version=PROMPT_VERSION,
            briefing=briefing,
            facts=facts,
        )
        with self._lock:
            # ponytail: tiny per-window cache bounds Gemini calls; one entry per minute window.
            self._cache = {k: v for k, v in self._cache.items() if v[0] > time.monotonic()}
            self._cache[key] = (time.monotonic() + CACHE_S, result)
        return result

    def ask(self, question: str, start: datetime, end: datetime) -> ShiftAnswer:
        facts = briefing_facts(self.ctx, start, end)
        try:
            result, model = gemini.generate(
                [ASK_PROMPT, f"QUESTION: {question}", json.dumps(facts, default=str)], Answer
            )
        except gemini.GeminiUnavailable as err:
            raise AiUnavailable("Ask-the-shift") from err
        return ShiftAnswer(
            question=question,
            generated_at=self.ctx.clock.now(),
            model=model,
            prompt_version="shift-ask-v1",
            result=result,
        )

    def insights(self, start: datetime, end: datetime) -> ShiftInsights:
        key = (
            "insights",
            start.replace(second=0, microsecond=0),
            end.replace(second=0, microsecond=0),
        )
        with self._lock:
            hit = self._cache.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1]
        facts = briefing_facts(self.ctx, start, end)
        try:
            result, model = gemini.generate(
                [INSIGHTS_PROMPT, json.dumps(facts, default=str)], Insights
            )
        except gemini.GeminiUnavailable as err:
            raise AiUnavailable("Efficiency insights") from err
        out = ShiftInsights(
            generated_at=self.ctx.clock.now(),
            model=model,
            prompt_version="shift-insights-v1",
            insights=result,
            facts=facts,
        )
        with self._lock:
            self._cache[key] = (time.monotonic() + CACHE_S, out)
        return out
