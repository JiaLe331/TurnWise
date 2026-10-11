import pytest
from conftest import ANA, table_req

from turnwise.contracts import TableAction
from turnwise.domain.errors import IdempotencyConflict, VersionConflict


def test_replayed_key_returns_original_result_without_new_events(services):
    request = table_req(TableAction.CONFIRM_DEPARTURE, 1)
    first = services.tables.act("T1", request, ANA, "same-key")
    events = len(services.ctx.repo.list_events())

    second = services.tables.act("T1", request, ANA, "same-key")

    assert second == first
    assert len(services.ctx.repo.list_events()) == events
    assert services.ctx.repo.get_session("T1").state_version == 2


def test_key_reused_for_different_request_is_rejected(services):
    services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 1), ANA, "k")
    with pytest.raises(IdempotencyConflict):
        services.tables.act("T2", table_req(TableAction.CONFIRM_DEPARTURE, 1), ANA, "k")


def test_failed_request_is_not_cached(services):
    request = table_req(TableAction.CONFIRM_DEPARTURE, 99)
    for _ in range(2):
        with pytest.raises(VersionConflict):
            services.tables.act("T1", request, ANA, "k")
    entry = services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 1), ANA, "k")
    assert entry.session.state_version == 2
