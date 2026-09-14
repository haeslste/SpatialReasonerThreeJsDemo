from __future__ import annotations

import asyncio
import threading
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator


class WorkBusy(Exception):
    pass


class WorkGate:
    """One-process global budget for expensive, anonymous API operations."""

    def __init__(self, rate: float = 12.0, burst: int = 24, active: int = 2, waiting: int = 4):
        self.rate = rate
        self.burst = burst
        self.tokens = float(burst)
        self.last_refill = time.monotonic()
        self.max_pending = active + waiting
        self.pending = 0
        self.lock = threading.Lock()
        self.semaphore = asyncio.Semaphore(active)

    @asynccontextmanager
    async def ticket(self) -> AsyncIterator[None]:
        with self.lock:
            now = time.monotonic()
            self.tokens = min(self.burst, self.tokens + (now - self.last_refill) * self.rate)
            self.last_refill = now
            if self.tokens < 1 or self.pending >= self.max_pending:
                raise WorkBusy()
            self.tokens -= 1
            self.pending += 1
        acquired = False
        try:
            try:
                await asyncio.wait_for(self.semaphore.acquire(), timeout=0.25)
                acquired = True
            except asyncio.TimeoutError as exc:
                raise WorkBusy() from exc
            yield
        finally:
            if acquired:
                self.semaphore.release()
            with self.lock:
                self.pending -= 1
