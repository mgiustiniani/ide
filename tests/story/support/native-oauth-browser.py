#!/usr/bin/python3
"""Launch only the owned Story authorization origin in a private external Chromium profile."""
import os
import json
from pathlib import Path
import sys
import urllib.request
from urllib.parse import urlsplit, parse_qs, quote

sandbox = Path(os.environ["IDE_STORY_NATIVE_GUI_SANDBOX_PATH"]).resolve()
root = Path(os.environ["IDE_STORY_OAUTH_BROWSER_ROOT"]).resolve()
if not os.environ.get("DISPLAY") or not root.is_relative_to(sandbox) or root == sandbox:
    raise RuntimeError("an isolated native Story browser root and display are required")
if len(sys.argv) != 2:
    raise RuntimeError("exactly one authorization URL is required")
url = urlsplit(sys.argv[1])
expected = urlsplit(os.environ["IDE_STORY_OAUTH_AUTHORIZATION_ORIGIN"])
params = parse_qs(url.query)
if (url.scheme, url.hostname, url.port, url.path) != ("http", "127.0.0.1", expected.port, "/authorize"):
    raise RuntimeError("browser fixture URL is outside its owned authorization service")
if params.get("code_challenge_method") != ["S256"] or params.get("response_type") != ["code"] or "code_verifier" in params or "client_secret" in params:
    raise RuntimeError("unsupported or sensitive browser fixture URL")
binary = Path(os.environ["IDE_STORY_OAUTH_BROWSER_BINARY"]).resolve()
if binary.name != "chrome" or not binary.is_file():
    raise RuntimeError("the configured owned-fixture Chromium executable is unavailable")
root.mkdir(mode=0o700, parents=True, exist_ok=True)
profile = root / "profile"
# The fixture's registered desktop handler forwards later URL requests to its
# already controlled browser. It never starts a second process on that profile.
active_port = profile / "DevToolsActivePort"
if active_port.is_file():
    port = int(active_port.read_text().splitlines()[0])
    if not 1024 <= port <= 65535:
        raise RuntimeError("invalid private browser control port")
    request = urllib.request.Request("http://127.0.0.1:" + str(port) + "/json/new?" + quote(sys.argv[1], safe=""), method="PUT")
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=3) as response:
        target = json.load(response)
    if target.get("type") != "page":
        raise RuntimeError("the private browser did not create a page")
    raise SystemExit(0)

if not (root / "browser.pid").exists():
    (root / "browser.pid").write_text(str(os.getpid()), encoding="ascii")
    stat_text = Path("/proc/self/stat").read_text()
    namespace_line = next(line for line in Path("/proc/self/status").read_text().splitlines() if line.startswith("NSpid:"))
    (root / "launch-identity.json").write_text(json.dumps({
        "pid": os.getpid(), "startTime": stat_text[stat_text.rfind(")") + 2:].split()[19],
        "namespacePids": [int(value) for value in namespace_line.split()[1:]],
        "executable": str(binary), "profile": str(profile), "scope": str(root),
    }))
arguments = [str(binary), "--no-sandbox", "--enable-automation", "--ozone-platform=x11", "--no-first-run", "--no-default-browser-check",
             "--disable-dev-shm-usage", "--disable-background-networking", "--disable-default-apps", "--disable-component-update",
             "--disable-sync", "--disable-extensions",
             "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--disable-features=Translate", "--password-store=basic",
             "--use-mock-keychain", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
             "--user-data-dir=" + str(profile), sys.argv[1]]
log = os.open(root / "browser-stderr.log", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
os.dup2(log, 2)
os.close(log)
scratch = Path(os.environ["IDE_STORY_OAUTH_BROWSER_TMP"])
if scratch.parent != Path("/tmp") or not scratch.name.startswith("ide-oauth-browser-") or scratch.is_symlink():
    raise RuntimeError("the fixture requires an owned short Chromium scratch directory")
browser_environment = dict(os.environ)
for variable in ("TMPDIR", "TMP", "TEMP"):
    browser_environment[variable] = str(scratch)
os.execve(str(binary), arguments, browser_environment)
