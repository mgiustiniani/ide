import assert from "node:assert/strict";
import { readFile, readlink } from "node:fs/promises";

export interface OwnedApplicationLocation {
  readonly executable: string;
  readonly sandbox: string;
  readonly workspace: string;
  readonly ideHome: string;
}
export interface OwnedApplicationIdentity extends OwnedApplicationLocation {
  readonly pid: number;
  readonly startTime: string;
}

/** Linux-only acceptance support. Never signal a PID discovered without ownership evidence. */
export async function captureOwnedApplication(
  pid: number,
  expected: OwnedApplicationLocation,
): Promise<OwnedApplicationIdentity> {
  assert.ok(Number.isSafeInteger(pid) && pid > 1, "invalid owned application PID");
  const [executable, environment, stat] = await Promise.all([
    readlink(`/proc/${pid}/exe`),
    readFile(`/proc/${pid}/environ`, "utf8"),
    readFile(`/proc/${pid}/stat`, "utf8"),
  ]);
  const variables = environment.split("\0");
  assert.ok(
    executable === expected.executable &&
      variables.includes(`IDE_STORY_NATIVE_GUI_SANDBOX_PATH=${expected.sandbox}`) &&
      variables.includes(`IDE_WORKSPACE_ROOT=${expected.workspace}`) &&
      variables.includes(`IDE_HOME=${expected.ideHome}`),
    "process is not the owned application",
  );
  // comm (field 2) may contain whitespace and parentheses. starttime is field 22.
  const startTime = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/)[19];
  assert.match(startTime ?? "", /^\d+$/, "owned application start time unavailable");
  return Object.freeze({ ...expected, pid, startTime });
}

export async function signalOwnedApplication(
  identity: OwnedApplicationIdentity,
  signal: NodeJS.Signals,
): Promise<void> {
  const current = await captureOwnedApplication(identity.pid, identity);
  assert.equal(current.startTime, identity.startTime, "owned application identity changed");
  process.kill(identity.pid, signal);
}
