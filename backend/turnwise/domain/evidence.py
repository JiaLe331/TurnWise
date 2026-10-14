from datetime import timedelta

from turnwise.contracts import CameraState, OperationalState, TableEvidence, TableSession

STALE_AFTER = timedelta(seconds=60)


def is_stale(state: CameraState, now) -> bool:
    return state.last_observed_at is None or now - state.last_observed_at > STALE_AFTER


def evidence_for(state: CameraState | None, session: TableSession, now) -> TableEvidence | None:
    if state is None:
        return None
    latest = state.latest
    review = (
        state.review_version == session.state_version
        and session.operational_state is OperationalState.DEPARTURE_REVIEW
    )
    return TableEvidence(
        camera_id=state.camera_id,
        source_mode=latest.source_mode if latest else None,
        visual_status=latest.visual_status if latest else None,
        object_flags=latest.object_flags if latest else [],
        occlusion=latest.occlusion if latest else False,
        reason=latest.reason if latest else None,
        uncertainty_reasons=latest.uncertainty_reasons if latest else [],
        model_version=latest.model_version if latest else None,
        last_observed_at=state.last_observed_at,
        vacant_since=state.vacant_since,
        stale=is_stale(state, now),
        review_source="observation" if review else None,
        table_check=state.table_check,
    )
