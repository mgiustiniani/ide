"""Run the real daemon and interrupt one editor Apply confirmation exchange."""
import json
from pathlib import Path
import subprocess
import sys
import threading

daemon, evidence, dropped_frame, *arguments = sys.argv[1:]
if dropped_frame not in {"request", "response"}:
    raise ValueError("Expected the confirmation request or response")
marker = Path(evidence)
child = subprocess.Popen([daemon, *arguments], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
confirmations = set()


def record_drop(request_id, transaction_id, **details):
    with marker.open("x") as report:
        json.dump({
            "daemon": daemon,
            "requestId": request_id,
            "transactionId": transaction_id,
            "droppedFrame": dropped_frame,
            **details,
        }, report)


def forward_requests():
    try:
        for frame in sys.stdin.buffer:
            request = json.loads(frame)
            if request.get("method") == "refactor.editor.confirm":
                if dropped_frame == "request":
                    record_drop(request["id"], request["params"]["transactionId"])
                    child.kill()
                    return
                confirmations.add(request["id"])
            child.stdin.write(frame)
            child.stdin.flush()
    except BrokenPipeError:
        pass
    finally:
        child.stdin.close()


threading.Thread(target=forward_requests, daemon=True).start()
try:
    for frame in child.stdout:
        response = json.loads(frame)
        if response.get("id") in confirmations:
            result = response.get("result") or {}
            if result.get("status") == "applied":
                record_drop(response["id"], result["transactionId"], status=result["status"])
                child.terminate()
                child.wait(timeout=5)
                sys.exit(0)
        sys.stdout.buffer.write(frame)
        sys.stdout.buffer.flush()
    child.wait(timeout=5)
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
