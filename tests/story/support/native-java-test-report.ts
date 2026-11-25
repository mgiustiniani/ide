import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const LIMIT = 128 * 1024;
const PARSER = `import json, sys, xml.etree.ElementTree as ET
with open(sys.argv[1], 'rb') as stream:
    raw = stream.read(131073)
assert len(raw) <= 131072
assert b'<!DOCTYPE' not in raw and b'<!ENTITY' not in raw
root = ET.fromstring(raw)
assert root.tag == 'testsuite' and root.get('name') == sys.argv[3]
cases = root.findall('testcase')
expected = sys.argv[5:]
assert len(cases) == len(expected)
assert all(case.get('classname') == sys.argv[4] for case in cases)
assert sorted(case.get('name').removesuffix('()') for case in cases) == sorted(expected)
failure = next((case.find('failure') for case in cases if case.find('failure') is not None), None)
result = {key: int(root.get(key, '0')) for key in ['tests', 'failures', 'errors', 'skipped']}
assert result['tests'] == len(expected) and result['failures'] in [0, 1]
assert result['errors'] == 0 and result['skipped'] == 0
assert (failure is not None) == (result['failures'] == 1)
result.update(caseFailure=failure is not None, failureMessage=failure.get('message') if failure is not None else None,
              markerObserved=sys.argv[2] in ''.join(root.itertext()))
assert result['markerObserved']
print(json.dumps(result))
`;
export interface NativeJUnitReport {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  caseFailure: boolean;
  failureMessage: string | null;
  markerObserved: boolean;
  sha256: string;
}

/** Independent, bounded read of a real tool-issued report; never creates or repairs it. */
export async function readNativeJUnitReport(
  workspace: string,
  relative: string,
  marker: string,
  suiteName = "MainTest",
  className = "MainTest",
  testName = "savedSource",
  additionalTestNames: readonly string[] = [],
): Promise<NativeJUnitReport> {
  assert.ok(!path.isAbsolute(relative));
  assert.ok(relative.split("/").every((part) => part && part !== "." && part !== ".."));
  const root = await realpath(workspace);
  const file = path.join(root, relative);
  const canonical = await realpath(file);
  assert.equal(canonical, file, "JUnit report contains a symlink");
  const before = await lstat(file);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1);
  assert.ok(before.size <= LIMIT, "JUnit report exceeded the fixture bound");
  const bytes = await readFile(file);
  assert.ok(bytes.length <= LIMIT);
  const { stdout } = await promisify(execFile)(
    "/usr/bin/python3",
    ["-c", PARSER, file, marker, suiteName, className, testName, ...additionalTestNames],
    {
      timeout: 5_000,
      maxBuffer: 8_192,
    },
  );
  const after = await lstat(file);
  assert.equal(after.ino, before.ino);
  assert.equal(after.dev, before.dev);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(file), bytes, "JUnit report changed during observation");
  return {
    ...(JSON.parse(stdout) as Omit<NativeJUnitReport, "sha256">),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
