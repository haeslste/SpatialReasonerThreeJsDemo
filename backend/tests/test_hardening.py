import asyncio
import os
import signal

import pytest

from app.engine_pool import EnginePool, EngineRejected, EngineTimeout
from app.scene import PRESETS, default_scene
from app.security import PipelineValidationError, validate_pipeline
from app.work_gate import WorkBusy, WorkGate


def geometry():
    return [
        {key: obj[key] for key in ("id", "position", "width", "height", "depth", "angle")}
        for obj in default_scene()
    ]


def test_all_presets_are_canonicalized_into_the_public_grammar() -> None:
    for preset in PRESETS:
        stages = validate_pipeline(preset["pipeline"])
        assert 1 <= len(stages) <= 12
        assert stages == validate_pipeline(" | ".join(stages))


@pytest.mark.parametrize("pipeline", [
    "filter(width > 10**10000000)",
    "filter(id == 'a' * 10000000)",
    "filter(width > (1 + 2 + 3 + 4 + 5 + 6))",
    "filter(width > 9999999999999999999999999999999999)",
    "filter(width > 1e999)",
    "filter(width > object.__class__)",
    "calc(score = __import__('os').system('id'))",
    "map(label = 'x' * 1000)",
    "pick(left.__class__)",
    "slice(999)",
])
def test_expression_limits_reject_expensive_or_executable_forms(pipeline: str) -> None:
    with pytest.raises(PipelineValidationError):
        validate_pipeline(pipeline)


def test_rate_burst_and_queue_limits() -> None:
    async def exercise_rate() -> None:
        gate = WorkGate(rate=0, burst=24)
        for _ in range(24):
            async with gate.ticket():
                pass
        with pytest.raises(WorkBusy):
            async with gate.ticket():
                pass

    async def exercise_queue() -> None:
        gate = WorkGate(rate=0, burst=24)
        release = asyncio.Event()

        async def job() -> None:
            async with gate.ticket():
                await release.wait()

        jobs = [asyncio.create_task(job()) for _ in range(6)]
        for _ in range(10):
            if gate.pending == 6:
                break
            await asyncio.sleep(0)
        assert gate.pending == 6
        with pytest.raises(WorkBusy):
            async with gate.ticket():
                pass
        release.set()
        await asyncio.gather(*jobs)
        assert gate.pending == 0

    asyncio.run(exercise_rate())
    asyncio.run(exercise_queue())


def test_worker_child_is_replaced_after_timeout_and_recovers() -> None:
    pool = EnginePool(size=1)
    try:
        original = pool.children[0]
        original_pid = original.process.pid
        os.kill(original_pid, signal.SIGSTOP)
        with pytest.raises(EngineTimeout):
            pool.run("reason", {"objects": geometry(), "pipeline": PRESETS[0]["pipeline"]})
        assert pool.healthy()
        assert pool.children[0].process.pid != original_pid
        assert pool.run("reason", {"objects": geometry(), "pipeline": PRESETS[0]["pipeline"]})["success"] is True
    finally:
        pool.close()


def test_worker_child_is_replaced_after_crash_and_recovers() -> None:
    pool = EnginePool(size=1)
    try:
        original = pool.children[0]
        original_pid = original.process.pid
        original.process.kill()
        original.process.wait(timeout=1)
        assert pool.run("relations", {"objects": geometry(), "objectId": "mug"})["success"] is True
        assert pool.healthy()
        assert pool.children[0].process.pid != original_pid
    finally:
        pool.close()


def test_health_probe_repairs_idle_child_crash() -> None:
    pool = EnginePool(size=1)
    try:
        pid = pool.children[0].process.pid
        pool.children[0].process.kill()
        pool.children[0].process.wait(timeout=1)
        assert pool.healthy()
        assert pool.children[0].process.pid != pid
    finally:
        pool.close()


def test_rejected_request_does_not_restart_a_healthy_child() -> None:
    pool = EnginePool(size=1)
    try:
        child = pool.children[0]
        pid = child.process.pid

        def reject(*_):
            raise EngineRejected()

        child.execute = reject
        with pytest.raises(EngineRejected):
            pool.run("reason", {"objects": geometry(), "pipeline": PRESETS[0]["pipeline"]})
        assert pool.healthy()
        assert pool.children[0].process.pid == pid
    finally:
        pool.close()
