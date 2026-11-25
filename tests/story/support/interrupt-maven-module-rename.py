"""Create an interrupted saved-file transaction using the selected real daemon."""
import json
from pathlib import Path
import select
import subprocess
import sys
import time


def send(daemon, request_id, method, **params):
    frame = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
    daemon.stdin.write(json.dumps(frame) + "\n")
    daemon.stdin.flush()


def result(daemon, request_id):
    readable, _, _ = select.select([daemon.stdout], [], [], 75)
    if not readable:
        raise TimeoutError("RefactorKit did not respond")
    response = json.loads(daemon.stdout.readline())
    if response.get("id") != request_id or "result" not in response:
        raise RuntimeError(f"Unexpected RefactorKit response: {response.get('error')}")
    return response["result"]


def interrupt(executable, project):
    daemon = subprocess.Popen(
        [executable], cwd=project, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
    )
    try:
        send(daemon, 1, "project.open", root=str(project), resolveDependencies=False)
        result(daemon, 1)
        send(
            daemon, 2, "refactor.preview", operation="renameMavenModule", languageId="java",
            arguments={"oldModuleDir": "app", "newModuleDir": "app-preview", "newArtifactId": "app-preview"},
        )
        preview = result(daemon, 2)
        if preview["status"] != "PREVIEW" or len(preview["structuredDiff"]) < 512:
            raise RuntimeError("Expected a reviewed Maven rename with hundreds of real file moves")
        if (project / "app-preview").exists():
            raise RuntimeError("The preview changed the project")
        send(daemon, 3, "refactor.apply", planId=preview["planId"])
        first_moved = project / "app-preview/src/main/java/pkg/RecoveryProbe000.java"
        deadline = time.monotonic() + 75
        while not first_moved.is_file():
            if daemon.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError("The first Maven source did not move before exit or deadline")
            time.sleep(0.001)
        daemon.kill()
        daemon.wait(timeout=10)
    finally:
        if daemon.poll() is None:
            daemon.kill()
            daemon.wait(timeout=10)
        daemon.stdin.close()
        daemon.stdout.close()
    if not first_moved.is_file() or not any((project / "app/src/main/java").rglob("*.java")):
        raise RuntimeError("The interruption did not leave a partial source move")
    journal, = (project / ".refactorkit/transactions").glob("*.json")
    if json.loads(journal.read_text())["state"] != "APPLYING":
        raise RuntimeError("The saved-file journal is not interrupted in APPLYING")
    return {"journal": str(journal.relative_to(project)), "firstMoved": str(first_moved.relative_to(project))}


if __name__ == "__main__":
    print(json.dumps(interrupt(sys.argv[1], Path(sys.argv[2]))))
