"""Fixed-window in-memory rate limiter. Per instance (serverless instances do not share it); fails closed when the key table is full."""
from __future__ import annotations

import math
import threading
import time
from typing import Callable


class RateLimiter:
    def __init__(self, limit: int, window_ms: int, max_keys: int = 10_000, clock: Callable[[], float] = lambda: time.time() * 1000):
        if limit < 1 or window_ms <= 0 or max_keys < 1:
            raise ValueError("invalid rate limiter settings")
        self.limit, self.window, self.max_keys, self.clock = limit, window_ms, max_keys, clock
        self._e: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _retry(self, reset_at: float, t: float) -> int:
        return max(1, math.ceil((reset_at - t) / 1000))

    def sweep(self) -> None:
        t = self.clock()
        for k in [k for k, e in self._e.items() if e[1] <= t]:
            del self._e[k]

    def size(self) -> int:
        return len(self._e)

    def check(self, key: str) -> dict:
        with self._lock:
            t = self.clock()
            e = self._e.get(key)
            if e and e[1] <= t:
                del self._e[key]
                e = None
            if e is None:
                if len(self._e) >= self.max_keys:
                    self.sweep()
                    if len(self._e) >= self.max_keys:
                        return {"allowed": False, "remaining": 0, "retry_after": self._retry(self.window + t, t)}
                e = self._e[key] = [0, t + self.window]
            if e[0] >= self.limit:
                return {"allowed": False, "remaining": 0, "retry_after": self._retry(e[1], t)}
            e[0] += 1
            return {"allowed": True, "remaining": self.limit - e[0], "retry_after": 0}
