#!/usr/bin/python3
"""Delay one requested JFR read, then delegate unchanged arguments to the real JDK."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

control = Path(__file__).resolve().parent.parent / "jfr-control"
config = json.loads((control / "config.json").read_text())
mode = sys.argv[1] if len(sys.argv) > 1 else ""
armed = control / "armed"
held = False
try:
    if armed.read_text().strip() == mode:
        armed.rename(control / (mode + ".claimed"))
        held = True
except FileNotFoundError:
    pass

if held:
    (control / (mode + ".ready")).write_text(str(os.getpid()))
    deadline = time.monotonic() + 11
    while not (control / (mode + ".release")).exists():
        if time.monotonic() >= deadline:
            print("The fixture JFR gate was not released in time.", file=sys.stderr)
            sys.exit(97)
        time.sleep(0.01)

code = subprocess.call([config["realJfr"], *sys.argv[1:]])
if held:
    (control / (mode + ".finished")).write_text(str(code))
sys.exit(code)
