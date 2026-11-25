"""Run a real native driver with a private 1 MiB filesystem and filesystem-only probes."""
import errno
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

inside = sys.argv[1] == "--inside"
config_path = Path(sys.argv[2] if inside else sys.argv[1]).resolve(strict=True)
config = json.loads(config_path.read_text())
root = Path(config["root"])
scenario = Path(config["scenario"])
control = Path(config["control"])
assert root.is_absolute() and root.is_relative_to(scenario)
assert control.is_absolute() and control.is_relative_to(scenario)
assert root.is_dir() and control.is_dir()
command = sys.argv[3:] if inside else sys.argv[2:]
if not inside:
    repository = Path(__file__).resolve().parents[3]
    os.execv("/usr/bin/bwrap", ["bwrap", "--ro-bind", "/", "/", "--bind", "/tmp", "/tmp",
             "--bind", str(repository), str(repository), "--dev-bind", "/dev", "/dev",
             "--proc", "/proc", "--size", "1048576", "--tmpfs", str(root), "--",
             "/usr/bin/python3", str(Path(__file__).resolve()), "--inside", str(config_path), *command])


def space():
    stat = os.statvfs(root)
    total = stat.f_blocks * stat.f_frsize
    assert total == 1048576, "The fixture is not the bounded private filesystem"
    return {"totalBytes": total, "freeBytes": stat.f_bavail * stat.f_frsize}


def publish(name, value):
    temporary = control / (name + ".tmp")
    temporary.write_text(json.dumps(value))
    temporary.replace(control / name)


space()
for name, content in config.get("seedFiles", {}).items():
    target = root / name
    assert target.is_relative_to(root) and ".." not in Path(name).parts
    target.write_text(content)
filler = root / "filler.bin"


def inspect():
    files = {}
    for item in sorted(root.rglob("*")):
        assert not item.is_symlink()
        if item.is_file() and item != filler:
            assert item.stat().st_size <= 128 * 1024
            files[str(item.relative_to(root))] = item.read_text()
        assert len(files) <= 128
    return {**space(), "files": files}


child = subprocess.Popen(command)
publish("ready.json", {**space(), "driverPid": child.pid})


def worker():
    previous = None
    while child.poll() is None:
        request = control / "request.json"
        if request.exists():
            message = json.loads(request.read_text())
            identity = message["id"]
            if identity != previous:
                previous = identity
                try:
                    operation = message["operation"]
                    details = {}
                    if operation == "fill":
                        assert not filler.exists()
                        with filler.open("xb", buffering=0) as output:
                            for _ in range(512):
                                try:
                                    output.write(b"x" * 4096)
                                except OSError as error:
                                    assert error.errno == errno.ENOSPC
                                    details["errno"] = error.errno
                                    break
                            else:
                                raise AssertionError("The bounded filesystem did not become full")
                    elif operation == "free":
                        filler.unlink()
                    else:
                        assert operation == "inspect"
                    publish("response.json", {"id": identity, **details, **inspect()})
                except Exception as error:
                    publish("response.json", {"id": identity, "error": str(error)})
        time.sleep(0.02)


threading.Thread(target=worker, daemon=True).start()
sys.exit(child.wait())
