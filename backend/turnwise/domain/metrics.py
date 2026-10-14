"""PRD success metrics, derived only from audit events so every number traces to an event."""

import math
import statistics
from collections import Counter, defaultdict
from datetime import datetime

from turnwise.contracts import AuditEvent, CycleRow, MetricSummary, ShiftMetrics
from turnwise.domain.context import Context

NOTES = [
    (
        "Departure times are staff confirmations, not observer-labelled final departures: "
        "departure_to_ready is reported as confirmed_departure_to_ready (PRD measurement rules)."
    ),
    "review_to_confirmation is the delay between a departure review and the staff confirmation.",
    "ready_to_seated counts only parties that had already arrived when the table became ready.",
    "Cycles are attributed to the window by their starting event; unfinished cycles are omitted.",
]


def summarize(metric: str, values: list[float]) -> MetricSummary:
    if not values:
        return MetricSummary(metric=metric, count=0, median_s=None, p90_s=None)
    ordered = sorted(values)
    p90 = ordered[max(math.ceil(0.9 * len(ordered)) - 1, 0)]  # nearest rank
    return MetricSummary(
        metric=metric,
        count=len(values),
        median_s=round(statistics.median(ordered), 1),
        p90_s=round(p90, 1),
    )


def _row(metric: str, start: AuditEvent, end_at: datetime, **ids) -> CycleRow:
    return CycleRow(
        metric=metric,
        table_id=ids.get("table_id", start.table_id),
        party_id=ids.get("party_id", start.party_id),
        session_id=ids.get("session_id", start.session_id),
        started_at=start.event_time,
        ended_at=end_at,
        seconds=round((end_at - start.event_time).total_seconds(), 1),
    )


def shift_metrics(ctx: Context, start: datetime, end: datetime) -> ShiftMetrics:
    # Stable sort keeps append order for equal timestamps; "after" means later in that order.
    events = [
        e for e in sorted(ctx.repo.list_events(), key=lambda e: e.event_time) if e.event_time < end
    ]
    position = {e.event_id: i for i, e in enumerate(events)}
    in_window = [e for e in events if start <= e.event_time]
    cycles: list[CycleRow] = []

    def after(event: AuditEvent) -> list[AuditEvent]:
        return events[position[event.event_id] + 1 :]

    def first_after(event: AuditEvent, kind: str, **match) -> AuditEvent | None:
        return next(
            (
                e
                for e in after(event)
                if e.event_type == kind and all(getattr(e, k) == v for k, v in match.items())
            ),
            None,
        )

    outcomes: Counter[str] = Counter()
    for e in in_window:
        if e.event_type == "departure_confirmed":
            ready = first_after(e, "ready_confirmed", session_id=e.session_id)
            if ready:
                cycles.append(_row("confirmed_departure_to_ready", e, ready.event_time))
        elif e.event_type == "departure_review_requested":
            outcome = next(
                (
                    x
                    for x in after(e)
                    if x.session_id == e.session_id
                    and x.event_type
                    in (
                        "departure_confirmed",
                        "departure_review_dismissed",
                        "departure_review_withdrawn",
                    )
                ),
                None,
            )
            if outcome and outcome.event_type == "departure_confirmed":
                cycles.append(_row("review_to_confirmation", e, outcome.event_time))
            if e.actor_type == "system" and outcome:
                outcomes[outcome.event_type] += 1
        elif e.event_type == "ready_confirmed":
            seated = first_after(e, "party_seated", table_id=e.table_id)
            party = ctx.repo.get_party(seated.party_id) if seated and seated.party_id else None
            if seated and party and party.arrival_at <= e.event_time:
                cycles.append(
                    _row("ready_to_seated", e, seated.event_time, party_id=party.party_id)
                )
        elif e.event_type == "party_seated" and e.party_id:
            party = ctx.repo.get_party(e.party_id)
            if party is not None:
                cycles.append(
                    CycleRow(
                        metric="queue_wait",
                        table_id=e.table_id,
                        party_id=party.party_id,
                        session_id=e.session_id,
                        started_at=party.arrival_at,
                        ended_at=e.event_time,
                        seconds=round((e.event_time - party.arrival_at).total_seconds(), 1),
                    )
                )

    by_metric: dict[str, list[float]] = defaultdict(list)
    for row in cycles:
        by_metric[row.metric].append(row.seconds)
    by_size: dict[int, list[float]] = defaultdict(list)
    for row in cycles:
        if row.metric == "queue_wait":
            by_size[ctx.repo.get_party(row.party_id).size].append(row.seconds)

    counts = Counter(e.event_type for e in in_window if e.event_type != "state_initialized")
    counts["vision_reviews"] = sum(
        e.event_type == "departure_review_requested" and e.actor_type == "system" for e in in_window
    )
    counts["manual_assignments"] = sum(
        e.event_type == "party_seated" and (e.reason or "").startswith("Manual assignment")
        for e in in_window
    )
    counts["queue_skip_overrides"] = sum(
        e.event_type == "seating_hold_created" and "skips waiting party" in (e.reason or "")
        for e in in_window
    )
    decided = sum(outcomes.values())
    correction = round(outcomes["departure_review_dismissed"] / decided, 3) if decided else None
    return ShiftMetrics(
        outlet_id=ctx.repo.outlet_id,
        window_start=start,
        window_end=end,
        generated_at=ctx.clock.now(),
        durations=[
            summarize(m, by_metric[m])
            for m in (
                "confirmed_departure_to_ready",
                "review_to_confirmation",
                "ready_to_seated",
                "queue_wait",
            )
        ],
        queue_wait_by_size={
            size: summarize(f"queue_wait_size_{size}", v) for size, v in sorted(by_size.items())
        },
        counts=dict(sorted(counts.items())),
        vision_review_correction_rate=correction,
        cycles=sorted(cycles, key=lambda r: r.started_at),
        notes=NOTES,
    )


def to_csv(metrics: ShiftMetrics) -> str:
    import csv
    import io

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(
        ["metric", "table_id", "party_id", "session_id", "started_at", "ended_at", "value"]
    )
    for r in metrics.cycles:
        writer.writerow(
            [
                r.metric,
                r.table_id,
                r.party_id,
                r.session_id,
                r.started_at.isoformat(),
                r.ended_at.isoformat(),
                r.seconds,
            ]
        )
    for name, value in metrics.counts.items():
        writer.writerow(
            [
                f"count:{name}",
                "",
                "",
                "",
                metrics.window_start.isoformat(),
                metrics.window_end.isoformat(),
                value,
            ]
        )
    return out.getvalue()
