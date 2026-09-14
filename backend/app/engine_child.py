"""Single-purpose SRpy child. Its protocol is bounded newline-delimited JSON."""

from __future__ import annotations

import json
import sys


def main() -> None:
    # Linux's address-space limit applies to each untrusted evaluation process.
    try:
        import resource

        budget = 384 * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (budget, budget))
    except (ImportError, OSError, ValueError):
        pass

    from .models import ReasonRequest, RelationsRequest
    from .srpy_adapter import reason_scene, relations_for_object

    sys.stdout.write('{"ready":true}\n')
    sys.stdout.flush()
    for line in sys.stdin:
        try:
            if len(line.encode("utf-8")) > 64 * 1024:
                raise ValueError("Internal request too large")
            job = json.loads(line)
            if job.get("kind") == "reason":
                result = reason_scene(ReasonRequest.model_validate(job["request"]))
            elif job.get("kind") == "relations":
                result = relations_for_object(RelationsRequest.model_validate(job["request"]))
            else:
                raise ValueError("Invalid internal operation")
            output = {"ok": True, "result": result.model_dump(mode="json")}
        except Exception:
            # SRpy includes full tracebacks in some errors. Never transmit them.
            output = {"ok": False, "error": "reasoning_failed"}
        try:
            sys.stdout.write(json.dumps(output, allow_nan=False, separators=(",", ":")) + "\n")
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            break


if __name__ == "__main__":
    main()
