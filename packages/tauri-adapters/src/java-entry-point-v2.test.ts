import { expect, it } from "vitest";
import { normalizeJavaEntryPointResult } from "./java-entry-point-tauri";
import { entryPointRequest, entryPointResult } from "./java-entry-point.test-fixtures";
import {
  modernEntryPointRequest as request,
  modernEntryPointResult as result,
} from "./java-entry-point-v2.test-fixtures";

it("admits explicit Java25 instance/compact and inherited owners with separate snapshots", () => {
  const value = normalizeJavaEntryPointResult(result, request);
  expect(value).toEqual(result);
  expect(value.discovery?.candidates[0].binaryName).toBe("record");
  expect(value.discovery?.snapshotHash).not.toBe(result.discovery.analysis.snapshotHash);
  expect(() => normalizeJavaEntryPointResult(result, entryPointRequest)).toThrow();
  expect(() => normalizeJavaEntryPointResult(entryPointResult, request)).toThrow();
  expect(() => normalizeJavaEntryPointResult(entryPointResult, { ...entryPointRequest, entryPointSchemaVersion: "unknown" as any })).toThrow();
  expect(() => normalizeJavaEntryPointResult(result, { ...request, launchProfile: "classic-declared-v1" })).toThrow();
});
it.each([
  [
    "schema",
    (v: any) => {
      v.discovery.schemaVersion = "java-entry-points-v3";
    },
  ],
  [
    "provider",
    (v: any) => {
      v.discovery.providerId = "java-jdt-bindings-v1";
    },
  ],
  [
    "backend",
    (v: any) => {
      v.discovery.backend = "engine-jvm";
    },
  ],
  [
    "global snapshot",
    (v: any) => {
      v.discovery.snapshotHash = v.discovery.analysis.snapshotHash;
    },
  ],
  [
    "context",
    (v: any) => {
      v.discovery.contextHash = "0".repeat(64);
    },
  ],
  [
    "scope",
    (v: any) => {
      v.discovery.scope.moduleId = "other";
    },
  ],
  [
    "platform",
    (v: any) => {
      v.discovery.platformIdentities = ["0".repeat(64)];
    },
  ],
  [
    "launcher platform",
    (v: any) => {
      v.discovery.launcher.platformIdentity = "0".repeat(64);
    },
  ],
  [
    "launcher executable",
    (v: any) => {
      v.discovery.launcher.executable = "/other/bin/java";
    },
  ],
  [
    "compiler hash",
    (v: any) => {
      v.discovery.launcher.compilerSha256 = "unknown";
    },
  ],
  [
    "worker hash",
    (v: any) => {
      v.discovery.analysis.workerSha256 = "unknown";
    },
  ],
  [
    "source level",
    (v: any) => {
      v.discovery.analysis.sourceLevel = 24;
    },
  ],
  [
    "preview",
    (v: any) => {
      v.discovery.coverage.qualifiedCell.preview = true;
    },
  ],
  [
    "profile",
    (v: any) => {
      v.discovery.launchProfile = "inherited-v1";
    },
  ],
  [
    "missing construction",
    (v: any) => {
      delete v.discovery.candidates[0].construction;
    },
  ],
  [
    "wrong construction",
    (v: any) => {
      v.discovery.candidates[0].construction.binaryName = "Other";
    },
  ],
  [
    "static construction",
    (v: any) => {
      v.discovery.candidates[1].construction = { binaryName: "demo.Child", descriptor: "()V" };
    },
  ],
  [
    "inherited owner",
    (v: any) => {
      v.discovery.candidates[1].inherited = false;
    },
  ],
  [
    "declaration traversal",
    (v: any) => {
      v.discovery.candidates[1].declaration.path = "../Parent.java";
    },
  ],
  [
    "empty source range",
    (v: any) => {
      v.discovery.candidates[0].source.range.end = { line: 0, character: 0 };
    },
  ],
  [
    "duplicate candidate",
    (v: any) => {
      v.discovery.candidates[1] = v.discovery.candidates[0];
    },
  ],
  [
    "excluded candidate",
    (v: any) => {
      v.discovery.ineligibleTypes[0].binaryName = "record";
    },
  ],
  [
    "ineligible reason",
    (v: any) => {
      v.discovery.ineligibleTypes[0].reason = "unknown";
    },
  ],
  [
    "eligible count",
    (v: any) => {
      v.discovery.totalEligibleCount = 0;
    },
  ],
  [
    "false completeness",
    (v: any) => {
      v.discovery.complete = false;
    },
  ],
  [
    "false truncation",
    (v: any) => {
      v.discovery.ineligibleTypesTruncated = true;
    },
  ],
  [
    "extra frame field",
    (v: any) => {
      v.discovery.command = "run";
    },
  ],
  [
    "extra source field",
    (v: any) => {
      v.discovery.candidates[0].source.guessed = true;
    },
  ],
])("refuses %s before offering a launch target", (_, change) => {
  const value = structuredClone(result);
  change(value);
  expect(() => normalizeJavaEntryPointResult(value, request)).toThrow(/uncorrelated/);
});
it("binds binary declarations to their attested inputs and preserves URI without invented source", () => {
  const value = structuredClone(result);
  value.discovery.analysis.classpathInputs = [{ path: "/deps/base.jar", sha256: "9".repeat(64) }];
  value.discovery.candidates[1].declaration = {
    kind: "binary",
    originKind: "classpath",
    uri: "jar:file:///deps/base.jar!/demo/Parent.class",
    inputPath: "/deps/base.jar",
    inputSha256: "9".repeat(64),
  };
  expect(normalizeJavaEntryPointResult(value, request)).toEqual(value);
  value.discovery.candidates[1].declaration.inputSha256 = "8".repeat(64);
  expect(() => normalizeJavaEntryPointResult(value, request)).toThrow();
});
it("retains exact totals when candidate or excluded-type lists are truncated", () => {
  const value = structuredClone(result);
  Object.assign(value.discovery, {
    complete: false,
    totalEligibleCount: 3,
    observedEligibleLowerBound: 3,
    truncated: true,
    ineligibleCount: 4,
    ineligibleTypesTruncated: true,
  });
  expect(normalizeJavaEntryPointResult(value, request).discovery?.complete).toBe(false);
});
