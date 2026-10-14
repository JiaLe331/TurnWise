"""Deliver observation summaries to the API with bounded retry."""

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from datetime import UTC, datetime, timedelta

from turnwise.contracts import ObservationSubmission

log = logging.getLogger("turnwise.publisher")
RETRY_BUFFER = timedelta(minutes=10)  # PRD maximum; the API rejects anything older anyway
MAX_PENDING = 2_000


class ObservationPublisher:
    def __init__(self, api_url: str, token: str) -> None:
        self._url = api_url.rstrip("/") + "/observations"
        self._token = token
        self._pending: deque[ObservationSubmission] = deque(maxlen=MAX_PENDING)
        self._wake = threading.Event()
        self._stop = threading.Event()
        self.sent = self.rejected = self.expired = 0
        self._thread = threading.Thread(target=self._run, name="publisher", daemon=True)
        self._thread.start()

    def publish(self, submission: ObservationSubmission) -> None:
        self._pending.append(submission)
        self._wake.set()

    def close(self, timeout: float = 5.0) -> None:
        self._stop.set()
        self._wake.set()
        self._thread.join(timeout)

    def _run(self) -> None:
        backoff = 0.5
        while not (self._stop.is_set() and not self._pending):
            if not self._pending:
                self._wake.wait(1.0)
                self._wake.clear()
                continue
            sub = self._pending[0]
            if datetime.now(UTC) - sub.observed_at > RETRY_BUFFER:
                self._pending.popleft()
                self.expired += 1
                continue
            outcome = self._send(sub)
            if outcome == "retry":
                if self._stop.is_set():
                    return
                time.sleep(backoff)
                backoff = min(backoff * 2, 10.0)
                continue
            backoff = 0.5
            self._pending.popleft()

    def _send(self, sub: ObservationSubmission) -> str:
        request = urllib.request.Request(
            self._url,
            data=sub.model_dump_json().encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._token}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=5):
                self.sent += 1
                return "ok"
        except urllib.error.HTTPError as err:
            if err.code >= 500 or err.code == 429:
                return "retry"
            # 4xx: the API judged it (stale run, reset boundary, mapping). Retrying cannot help.
            self.rejected += 1
            detail = err.read()[:300]
            try:
                detail = json.loads(detail).get("code", detail)
            except ValueError:
                pass
            log.warning("observation %s rejected: %s %s", sub.observation_id, err.code, detail)
            return "drop"
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            log.warning("API unreachable (%s); retrying", err)
            return "retry"
