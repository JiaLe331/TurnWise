"""Gemini table-reset check: a masked crop of a vacant table is sent to Gemini off the replay
loop; the structured answer travels with the next observation summary as advisory evidence."""

import logging
import os
import queue
import threading
import time
from datetime import datetime

from turnwise.camera_manifest import TableRegion
from turnwise.contracts import TableCheck, TableCheckResult, VisualStatus

log = logging.getLogger("turnwise.table_check")
PROMPT_VERSION = "table-check-v1"
PROMPT = (
    "CCTV crop of one restaurant table and its seats (everything else blacked out). "
    "Is it ready for new guests? clear_and_set = empty or only a clean place setting or decor "
    "(lamps, menus, clean glassware set out). leftovers = used dishes, food, used glasses, litter "
    "or personal belongings left behind. unclear = too small, blurred or blocked to judge. "
    "people_present = anyone seated at it. List only items you can actually see; "
    "keep reason under 20 words."
)
CHECK_AFTER_VACANT_S = 10.0  # media seconds a table must look vacant before it is checked
RECHECK_S = 120.0  # wall seconds between checks of the same table


def crop_table(cv2, frame, table: TableRegion, scale: int = 3) -> bytes:
    """Table and seat zone only; everything else blacked out (privacy and focus)."""
    import numpy as np

    points = np.int32([*table.tabletop, *(p for seat in table.seats for p in seat)])
    hull = cv2.convexHull(points)
    x, y, w, h = cv2.boundingRect(hull)
    pad = 10
    x0, y0 = max(x - pad, 0), max(y - pad, 0)
    crop = frame[y0 : y + h + pad, x0 : x + w + pad].copy()
    mask = np.zeros(crop.shape[:2], np.uint8)
    cv2.fillPoly(mask, [hull - [x0, y0]], 255)
    crop[cv2.dilate(mask, np.ones((9, 9), np.uint8)) == 0] = 0
    crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    return cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes()


class TableChecker:
    def __init__(self, daily_cap: int | None = None) -> None:
        self.daily_cap = daily_cap or int(os.environ.get("TURNWISE_GEMINI_DAILY_CAP", "300"))
        self._latest: dict[str, TableCheck] = {}
        self._vacant_since: dict[str, float] = {}
        self._last_request: dict[str, float] = {}
        self._pending: set[str] = set()
        self._lock = threading.Lock()
        self._jobs: queue.Queue = queue.Queue(maxsize=4)
        self._day = time.strftime("%Y-%m-%d")
        self.calls = 0
        threading.Thread(target=self._work, name="table-check", daemon=True).start()

    def latest(self, table_id: str) -> TableCheck | None:
        with self._lock:
            return self._latest.get(table_id)

    def consider(self, cv2, frame, tables, shown, media_s: float, at: datetime) -> None:
        """Called per processed frame; cheap unless a table is due for a check."""
        now = time.monotonic()
        for table in tables:
            if shown.get(table.table_id) is not VisualStatus.VACANT:
                self._vacant_since.pop(table.table_id, None)
                continue
            since = self._vacant_since.setdefault(table.table_id, media_s)
            due = now - self._last_request.get(table.table_id, -RECHECK_S) >= RECHECK_S
            if media_s - since < CHECK_AFTER_VACANT_S or not due or not self._budget():
                continue
            with self._lock:
                if table.table_id in self._pending:
                    continue
            try:
                self._jobs.put_nowait((table.table_id, crop_table(cv2, frame, table), at))
            except queue.Full:
                return
            with self._lock:
                self._pending.add(table.table_id)
            self._last_request[table.table_id] = now

    def _budget(self) -> bool:
        today = time.strftime("%Y-%m-%d")
        if today != self._day:
            self._day, self.calls = today, 0
        return self.calls < self.daily_cap

    def _work(self) -> None:
        from turnwise import gemini

        while True:
            table_id, jpeg, at = self._jobs.get()
            self.calls += 1
            try:
                from google.genai import types

                image = types.Part.from_bytes(data=jpeg, mime_type="image/jpeg")
                result, model = gemini.generate([image, PROMPT], TableCheckResult)
                check = TableCheck(
                    **result.model_dump(),
                    checked_at=at,
                    model=model,
                    prompt_version=PROMPT_VERSION,
                )
                with self._lock:
                    self._latest[table_id] = check
                log.info("Gemini %s on %s: %s %s", model, table_id, check.state, check.items)
            except gemini.GeminiUnavailable as err:
                log.warning("table check for %s skipped: %s", table_id, err)
            finally:
                with self._lock:
                    self._pending.discard(table_id)
