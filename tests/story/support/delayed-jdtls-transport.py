"""Pass real JDT LS frames unchanged, delaying its first formatting response only."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

java, evidence, *arguments = sys.argv[1:]
if "-version" in arguments or "--version" in arguments:
    os.execv(java, [java, *arguments])
root = Path(evidence)
child = subprocess.Popen([java, *arguments], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
requests = {}


def frame(stream):
    headers = []
    length = None
    while True:
        line = stream.readline()
        if not line:
            return None
        headers.append(line)
        if line in (b"\r\n", b"\n"):
            break
        name, value = line.split(b":", 1)
        if name.lower() == b"content-length":
            length = int(value)
    if length is None or not 0 <= length <= 16 * 1024 * 1024:
        raise ValueError("Invalid LSP frame length")
    body = stream.read(length)
    if len(body) != length:
        raise ValueError("Truncated LSP frame")
    return b"".join(headers) + body, json.loads(body)


def forward_requests():
    while (item := frame(sys.stdin.buffer)) is not None:
        raw, message = item
        if "method" in message and "id" in message:
            requests[message["id"]] = message["method"]
        child.stdin.write(raw)
        child.stdin.flush()
    child.stdin.close()


threading.Thread(target=forward_requests, daemon=True).start()
delayed = False
while (item := frame(child.stdout)) is not None:
    raw, message = item
    method = requests.get(message.get("id"))
    if not delayed and method == "textDocument/formatting":
        delayed = True
        proof = {"method": method, "realResponseSha256": hashlib.sha256(raw).hexdigest(),
                 "hasResult": "result" in message, "edits": len(message.get("result") or []),
                 "delaySeconds": 4, "childPid": child.pid}
        (root / "format-response-held.json").write_text(json.dumps(proof))
        time.sleep(4)
    sys.stdout.buffer.write(raw)
    sys.stdout.buffer.flush()
    if method == "textDocument/formatting" and delayed:
        (root / "format-response-forwarded.txt").write_text("forwarded unchanged\n")
sys.exit(child.wait())
