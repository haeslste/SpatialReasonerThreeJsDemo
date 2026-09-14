"""Supervise two prewarmed, killable SRpy subprocesses without pickle IPC."""

from __future__ import annotations

import json
import os
import queue
import select
import signal
import subprocess
import sys
import threading
import time
from typing import Any


REQUEST_DEADLINE_SECONDS = 2.0
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class EngineTimeout(Exception):
    pass


class EngineUnavailable(Exception):
    pass


class EngineRejected(Exception):
    """The child is healthy, but SRpy rejected this bounded request."""


class EngineChild:
    def __init__(self) -> None:
        self.process = subprocess.Popen(
            [sys.executable, "-m", "app.engine_child"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=0,
            start_new_session=True,
            env={**os.environ, "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"},
        )
        try:
            ready = self._readline(2.0)
            if ready != b'{"ready":true}':
                raise EngineUnavailable()
        except Exception:
            self.stop()
            raise

    def _readline(self, timeout: float) -> bytes:
        if self.process.stdout is None:
            raise EngineUnavailable()
        deadline = time.monotonic() + timeout
        output = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise EngineTimeout()
            readable, _, _ = select.select([self.process.stdout], [], [], remaining)
            if not readable:
                raise EngineTimeout()
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise EngineUnavailable()
            output.extend(chunk)
            if len(output) > MAX_RESPONSE_BYTES:
                raise EngineUnavailable()
            if b"\n" in output:
                line, _, remainder = output.partition(b"\n")
                if remainder:
                    # One child only receives one request at a time. Extra output
                    # would desynchronize the protocol and must not be trusted.
                    raise EngineUnavailable()
                return bytes(line)

    def execute(self, kind: str, request: dict[str, Any]) -> dict[str, Any]:
        if self.process.poll() is not None or self.process.stdin is None:
            raise EngineUnavailable()
        payload = json.dumps({"kind": kind, "request": request}, allow_nan=False, separators=(",", ":")).encode() + b"\n"
        if len(payload) > 64 * 1024:
            raise EngineUnavailable()
        try:
            self.process.stdin.write(payload)
            self.process.stdin.flush()
            response = json.loads(self._readline(REQUEST_DEADLINE_SECONDS))
        except EngineTimeout:
            raise
        except (BrokenPipeError, OSError, ValueError, TypeError) as exc:
            raise EngineUnavailable() from exc
        if isinstance(response, dict) and response.get("ok") is False and response.get("error") == "reasoning_failed":
            raise EngineRejected()
        if not isinstance(response, dict) or response.get("ok") is not True or not isinstance(response.get("result"), dict):
            raise EngineUnavailable()
        return response["result"]

    def stop(self) -> None:
        if self.process.poll() is None:
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        try:
            self.process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self.process.kill()
        for stream in (self.process.stdin, self.process.stdout):
            if stream is not None:
                stream.close()


class EnginePool:
    def __init__(self, size: int = 2) -> None:
        self.idle: queue.Queue[EngineChild] = queue.Queue(maxsize=size)
        self.children: list[EngineChild] = []
        self.repair_lock = threading.Lock()
        self._refill()
        if len(self.children) != size:
            self.close()
            raise EngineUnavailable()

    def _refill(self) -> None:
        # Health probes also repair a child that died while idle. A transient
        # spawn failure is retried on the next probe or request.
        with self.repair_lock:
            for child in list(self.children):
                if child.process.poll() is None:
                    continue
                self.children.remove(child)
                with self.idle.mutex:
                    try:
                        self.idle.queue.remove(child)
                    except ValueError:
                        pass
                child.stop()
            while len(self.children) < self.idle.maxsize:
                try:
                    replacement = EngineChild()
                except Exception:
                    break
                self.children.append(replacement)
                self.idle.put(replacement)

    def run(self, kind: str, request: dict[str, Any]) -> dict[str, Any]:
        self._refill()
        try:
            child = self.idle.get(timeout=0.25)
        except queue.Empty as exc:
            raise EngineUnavailable() from exc
        try:
            return child.execute(kind, request)
        except (EngineTimeout, EngineUnavailable):
            child.stop()
            with self.repair_lock:
                if child in self.children:
                    self.children.remove(child)
            self._refill()
            raise
        finally:
            if child in self.children:
                self.idle.put(child)

    def healthy(self) -> bool:
        self._refill()
        return len(self.children) == self.idle.maxsize and all(child.process.poll() is None for child in self.children)

    def close(self) -> None:
        for child in self.children:
            child.stop()
        self.children.clear()
