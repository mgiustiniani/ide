import assert from "node:assert/strict";

export const NATIVE_JAVA_IMPORT_REQUIREMENT = "REQ-REFACTORKIT-JAVA-IMPORT-002";
export const NATIVE_JAVA_IMPORT_TARGET_DIRECTORY = "src/main/java/example/imports";
export const NATIVE_JAVA_IMPORT_PRIMARY_FILE = `${NATIVE_JAVA_IMPORT_TARGET_DIRECTORY}/ClipboardImportProof.java`;
export const NATIVE_JAVA_IMPORT_FIRST_PLAN = "native-java-import-plan-001";
export const NATIVE_JAVA_IMPORT_SECOND_PLAN = "native-java-import-plan-002";
export const NATIVE_JAVA_IMPORT_TRANSACTION = "native-java-import-transaction-001";
export const NATIVE_JAVA_IMPORT_FIXTURE = `package example.imports;

public final class ClipboardImportProof {
  public static final String REQUIREMENT = "${NATIVE_JAVA_IMPORT_REQUIREMENT}";
}`;

function pythonLiteral(value: string): string {
  return JSON.stringify(value);
}

export function nativeClipboardOwnerScript(options: {
  readonly fixture: string;
  readonly statePath: string;
}): string {
  assert.equal(options.fixture, NATIVE_JAVA_IMPORT_FIXTURE);
  return `#!/usr/bin/python3
import hashlib
import json
import os
import signal

import gi
gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
from gi.repository import Gdk, GLib, Gtk

FIXTURE = ${pythonLiteral(options.fixture)}
STATE_PATH = ${pythonLiteral(options.statePath)}
SHA256 = hashlib.sha256(FIXTURE.encode("utf-8")).hexdigest()
stopping = False


def write_state(status):
    temporary = STATE_PATH + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump({
            "pid": os.getpid(),
            "status": status,
            "length": len(FIXTURE.encode("utf-8")),
            "sha256": SHA256,
        }, stream, sort_keys=True)
        stream.write("\\n")
    os.replace(temporary, STATE_PATH)


def stop(_signal, _frame):
    global stopping
    stopping = True
    GLib.idle_add(Gtk.main_quit)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
Gtk.init([])
clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
clipboard.set_text(FIXTURE, -1)
Gdk.flush()
write_state("owned")
try:
    Gtk.main()
finally:
    stopping = True
    clipboard.clear()
    Gdk.flush()
    write_state("stopped")
`;
}

export function nativeRefactorKitDaemonScript(options: {
  readonly fixture: string;
  readonly workspacePath: string;
  readonly transcriptPath: string;
  readonly statePath: string;
}): string {
  assert.equal(options.fixture, NATIVE_JAVA_IMPORT_FIXTURE);
  const targetPath = `${options.workspacePath}/${NATIVE_JAVA_IMPORT_PRIMARY_FILE}`;
  const sourceLines = options.fixture.split("\n");
  const renderedDiff = [
    "--- /dev/null",
    `+++ b/${NATIVE_JAVA_IMPORT_PRIMARY_FILE}`,
    `@@ -0,0 +1,${sourceLines.length} @@`,
    ...sourceLines.map((line) => `+${line}`),
  ].join("\n");
  const structuredHunk = sourceLines.map((line) => `+${line}`);

  return `#!/usr/bin/python3
import hashlib
import json
import os
import sys

FIXTURE = ${pythonLiteral(options.fixture)}
WORKSPACE = ${pythonLiteral(options.workspacePath)}
TARGET_DIRECTORY = ${pythonLiteral(NATIVE_JAVA_IMPORT_TARGET_DIRECTORY)}
TARGET_PATH = ${pythonLiteral(targetPath)}
TRANSCRIPT_PATH = ${pythonLiteral(options.transcriptPath)}
STATE_PATH = ${pythonLiteral(options.statePath)}
FIRST_PLAN = ${pythonLiteral(NATIVE_JAVA_IMPORT_FIRST_PLAN)}
SECOND_PLAN = ${pythonLiteral(NATIVE_JAVA_IMPORT_SECOND_PLAN)}
TRANSACTION = ${pythonLiteral(NATIVE_JAVA_IMPORT_TRANSACTION)}
SHA256 = hashlib.sha256(FIXTURE.encode("utf-8")).hexdigest()
SOURCE_LENGTH = len(FIXTURE.encode("utf-8"))
EXPECTED_METHODS = [
    "server.capabilities",
    "project.open",
    "java.importExternalClass",
    "refactor.discard",
    "java.importExternalClass",
    "refactor.apply",
]
sequence = 0
write_count = 0


def write_state(status):
    temporary = STATE_PATH + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump({
            "pid": os.getpid(),
            "status": status,
            "sequence": sequence,
            "writeCount": write_count,
        }, stream, sort_keys=True)
        stream.write("\\n")
    os.replace(temporary, STATE_PATH)


def record(request_id, method, plan=None, target=None, length=None, sha256=None, params=None, change=None, primary=None, recorded_write_count=None):
    event = {"id": request_id, "method": method}
    if plan is not None:
        event["plan"] = plan
    if target is not None:
        event["target"] = target
    if length is not None:
        event["length"] = length
    if sha256 is not None:
        event["sha256"] = sha256
    if params is not None:
        event["params"] = params
    if change is not None:
        event["change"] = change
    if primary is not None:
        event["primary"] = primary
    if recorded_write_count is not None:
        event["writeCount"] = recorded_write_count
    with open(TRANSCRIPT_PATH, "a", encoding="utf-8") as stream:
        stream.write(json.dumps(event, sort_keys=True, separators=(",", ":")) + "\\n")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def respond(request_id, result):
    frame = {"jsonrpc": "2.0", "id": request_id, "result": result}
    sys.stdout.write(json.dumps(frame, sort_keys=True, separators=(",", ":")) + "\\n")
    sys.stdout.flush()


def plan(plan_id):
    return {
        "planId": plan_id,
        "status": "preview",
        "summary": "Create ClipboardImportProof.java in the selected Java package",
        "confidence": 1,
        "riskLevel": "high",
        "evidence": [{
            "kind": "package-placement",
            "summary": "Package placement verified",
            "detail": "Source root src/main/java; package example.imports; module app",
        }],
        "affectedFiles": [{
            "change": "create",
            "path": ${pythonLiteral(NATIVE_JAVA_IMPORT_PRIMARY_FILE)},
            "primary": True,
        }],
        "placement": {
            "sourceRoot": "src/main/java",
            "packageName": "example.imports",
            "moduleName": "app",
        },
        "packageChanges": [{
            "path": ${pythonLiteral(NATIVE_JAVA_IMPORT_PRIMARY_FILE)},
            "fromPackage": None,
            "toPackage": "example.imports",
        }],
        "renderedDiff": ${pythonLiteral(renderedDiff)},
        "structuredDiff": [{
            "path": ${pythonLiteral(NATIVE_JAVA_IMPORT_PRIMARY_FILE)},
            "change": "create",
            "hunks": [{
                "oldStart": 0,
                "oldLines": 0,
                "newStart": 1,
                "newLines": ${sourceLines.length},
                "lines": ${JSON.stringify(structuredHunk)},
            }],
        }],
        "warnings": ["Unknown clipboard-source license requires acknowledgement."],
        "diagnosticsAfterPreview": [{
            "severity": "information",
            "code": "RK-JAVA-IMPORT-002",
            "message": "Package placement verified",
            "path": ${pythonLiteral(NATIVE_JAVA_IMPORT_PRIMARY_FILE)},
        }],
        "provenance": {
            "sourceKind": "clipboard",
            "sourceUrl": None,
            "detectedLicense": "unknown",
            "licensePolicy": "warn",
            "notices": ["Review the unknown license before applying."],
        },
        "unresolvedDependencies": [],
        "conflicts": [],
        "refusalReasons": [],
        "applyEligibility": {"eligible": True, "blockers": []},
        "staleness": {"stale": False, "reasons": []},
        "provider": {"name": "refactorkit-native-story-fixture", "version": "0.2.0"},
    }


write_state("ready")
try:
    for raw_line in sys.stdin.buffer:
        require(raw_line.endswith(b"\\n"), "request is not newline framed")
        require(len(raw_line) <= 2162688, "request exceeds fixture bound")
        request = json.loads(raw_line)
        require(type(request) is dict, "request must be an object")
        require(set(request) == {"jsonrpc", "id", "method", "params"}, "unexpected request fields")
        require(request["jsonrpc"] == "2.0", "invalid JSON-RPC version")
        require(type(request["id"]) is int and request["id"] > 0, "invalid request id")
        require(type(request["params"]) is dict, "params must be an object")
        require(sequence < len(EXPECTED_METHODS), "unexpected extra request")
        method = request["method"]
        require(method == EXPECTED_METHODS[sequence], "unexpected method sequence")
        sequence += 1
        request_id = request["id"]
        params = request["params"]

        if method == "server.capabilities":
            require(params == {}, "capabilities params must be empty")
            record(request_id, method)
            respond(request_id, {
                "apiVersion": "0.2",
                "protocol": "json-rpc-2.0",
                "transport": "stdio",
                "version": "0.2.0-native-story-fixture",
                "methods": [
                    {"name": "java.importExternalClass", "stability": "experimental", "features": {
                        "targetDirectory": True,
                        "preview": True,
                        "apply": True,
                        "discard": True,
                        "rollback": True,
                    }},
                    {"name": "refactor.apply"},
                    {"name": "refactor.discard"},
                    {"name": "patch.rollback"},
                ],
                "safety": {
                    "previewBeforeApply": True,
                    "snapshotValidation": True,
                    "transactionRollback": True,
                    "workspaceScopedWrites": True,
                },
            })
        elif method == "project.open":
            require(params == {"root": WORKSPACE}, "project.open root mismatch")
            require(os.getcwd() == WORKSPACE, "daemon cwd is not the authorized workspace")
            record(request_id, method, target=WORKSPACE)
            respond(request_id, {"root": WORKSPACE})
        elif method == "java.importExternalClass":
            expected = {
                "code": FIXTURE,
                "targetDirectory": TARGET_DIRECTORY,
                "sourceKind": "clipboard",
                "sourceUrl": None,
                "licensePolicy": "warn",
            }
            require(params == expected, "preview request mismatch")
            require(not os.path.exists(TARGET_PATH), "preview observed an existing target")
            plan_id = FIRST_PLAN if sequence == 3 else SECOND_PLAN
            record(request_id, method, plan=plan_id, target=TARGET_DIRECTORY, length=SOURCE_LENGTH, sha256=SHA256)
            respond(request_id, plan(plan_id))
        elif method == "refactor.discard":
            require(params == {"planId": FIRST_PLAN}, "discard did not correlate the first plan")
            require(not os.path.exists(TARGET_PATH), "discard observed a target write")
            record(request_id, method, plan=FIRST_PLAN)
            respond(request_id, {"planId": FIRST_PLAN, "discarded": True})
        elif method == "refactor.apply":
            require(params == {"planId": SECOND_PLAN}, "apply did not use the fresh plan")
            require(not os.path.exists(TARGET_PATH), "target existed before daemon Apply")
            with open(TARGET_PATH, "xb") as target:
                target.write(FIXTURE.encode("utf-8"))
                target.flush()
                os.fsync(target.fileno())
            write_count += 1
            record(
                request_id,
                method,
                plan=SECOND_PLAN,
                target=${pythonLiteral(NATIVE_JAVA_IMPORT_PRIMARY_FILE)},
                length=SOURCE_LENGTH,
                sha256=SHA256,
                params=params,
                change="create",
                primary=True,
                recorded_write_count=write_count,
            )
            respond(request_id, {
                "transactionId": TRANSACTION,
                "planId": SECOND_PLAN,
                "changedFiles": [{
                    "change": "create",
                    "path": ${pythonLiteral(NATIVE_JAVA_IMPORT_PRIMARY_FILE)},
                    "primary": True,
                }],
                "primaryFile": ${pythonLiteral(NATIVE_JAVA_IMPORT_PRIMARY_FILE)},
                "diagnostics": [],
                "provider": {"name": "refactorkit-native-story-fixture", "version": "0.2.0"},
            })
        write_state("serving")
finally:
    write_state("stopped")
`;
}
