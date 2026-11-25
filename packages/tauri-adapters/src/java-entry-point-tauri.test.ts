import { describe, it, expect, vi } from "vitest";
import {
  normalizeJavaEntryPointResult,
  TauriJavaEntryPointAdapter,
} from "./java-entry-point-tauri";
import { entryPointRequest, entryPointResult } from "./java-entry-point.test-fixtures";
vi.mock("./errors", () => ({ invokeTauri: vi.fn() }));
import { invokeTauri } from "./errors";

describe("provider-owned entry-point boundary", () => {
  it("preserves nested and secondary binary classes and explicitly partial coverage", () => {
    const result = normalizeJavaEntryPointResult(entryPointResult, entryPointRequest);
    expect(result.discovery?.candidates.map((c) => c.binaryName)).toEqual([
      "demo.Container$Nested",
      "demo.Runner",
      "demo.Secondary",
    ]);
    expect(result.discovery?.complete).toBe(false);
    expect(result.discovery?.coverage.unqualifiedProfiles).toContain("java25-v1");
  });
  it.each([
    ["workspace", (v: any) => (v.workspaceId = "other")],
    ["generation", (v: any) => v.generation++],
    ["request", (v: any) => (v.discovery.requestId = "other")],
    ["snapshot", (v: any) => (v.discovery.snapshotHash = "b".repeat(64))],
    ["context", (v: any) => (v.discovery.contextHash = "b".repeat(64))],
    ["schema", (v: any) => (v.discovery.contextSchemaVersion = "java-project-context-v2")],
    ["module", (v: any) => (v.discovery.scope.moduleId = "other")],
    ["source set", (v: any) => (v.discovery.scope.sourceSetId = "test")],
    ["SDK", (v: any) => (v.discovery.platformIdentities = ["b".repeat(64)])],
    ["false completeness", (v: any) => (v.discovery.complete = true)],
    ["missing coverage", (v: any) => (v.discovery.coverage.unqualifiedProfiles = [])],
    ["count", (v: any) => (v.discovery.returnedCount = 0)],
    ["total", (v: any) => (v.discovery.totalEligibleCount = 0)],
    ["lower bound", (v: any) => (v.discovery.observedEligibleLowerBound = 0)],
    ["duplicate", (v: any) => (v.discovery.candidates[1] = v.discovery.candidates[0])],
    ["path traversal", (v: any) => (v.discovery.candidates[0].source.path = "../Main.java")],
    ["range", (v: any) => (v.discovery.candidates[0].source.range.start.line = 99)],
    ["unsupported main", (v: any) => (v.discovery.candidates[0].invocation = "instance")],
    ["inherited", (v: any) => (v.discovery.candidates[0].inherited = true)],
    ["binary name", (v: any) => (v.discovery.candidates[0].binaryName = "demo/Wrong")],
    [
      "oversized Unicode name",
      (v: any) => (v.discovery.candidates[0].binaryName = "名".repeat(400)),
    ],
  ])("rejects %s instead of offering a launch candidate", (_, mutate) => {
    const value = structuredClone(entryPointResult);
    mutate(value);
    expect(() => normalizeJavaEntryPointResult(value, entryPointRequest)).toThrow(/uncorrelated/);
  });
  it("does not turn an empty partial result into zero-main proof", () => {
    const value = structuredClone(entryPointResult);
    Object.assign(value.discovery!, {
      candidates: [],
      returnedCount: 0,
      totalEligibleCount: 0,
      observedEligibleLowerBound: 0,
    });
    expect(normalizeJavaEntryPointResult(value, entryPointRequest).discovery?.complete).toBe(false);
  });
  it("correlates an optional source filter", () => {
    expect(() =>
      normalizeJavaEntryPointResult(entryPointResult, {
        ...entryPointRequest,
        path: "src/main/java/demo/Other.java",
      }),
    ).toThrow();
  });
  it("preserves unavailable outcomes without candidates", () => {
    expect(
      normalizeJavaEntryPointResult(
        { ...entryPointResult, status: "unavailable", discovery: null },
        entryPointRequest,
      ).status,
    ).toBe("unavailable");
    expect(() =>
      normalizeJavaEntryPointResult(
        { ...entryPointResult, status: "unavailable" },
        entryPointRequest,
      ),
    ).toThrow();
  });
  it("uses the native commands with workspace-scoped cancellation", async () => {
    vi.mocked(invokeTauri).mockResolvedValueOnce(entryPointResult);
    const adapter = new TauriJavaEntryPointAdapter();
    await expect(adapter.query(entryPointRequest)).resolves.toMatchObject({ status: "ready" });
    expect(invokeTauri).toHaveBeenCalledWith("query_refactorkit_java_entry_points", {
      request: entryPointRequest,
    });
    await adapter.cancel(entryPointRequest, entryPointRequest.requestId);
    expect(invokeTauri).toHaveBeenCalledWith("cancel_refactorkit_java_entry_points", {
      workspaceId: "workspace",
      generation: 1,
      requestId: "entry-request",
    });
  });
});

describe("native enclosing-type correlation", () => {
  const request = {
    ...entryPointRequest,
    path: "src/main/java/demo/Runner.java",
    position: { line: 0, character: 80 },
  };
  function selected() {
    const result = structuredClone(entryPointResult);
    const d = result.discovery!;
    d.candidates = d.candidates.filter((c) => c.binaryName === "demo.Runner");
    d.returnedCount = d.totalEligibleCount = d.observedEligibleLowerBound = 1;
    d.selection = {
      mode: "enclosing-type",
      path: request.path,
      position: { ...request.position },
      binaryName: "demo.Runner",
      range: { start: { line: 0, character: 10 }, end: { line: 0, character: 110 } },
    };
    return result;
  }
  it("retains the provider-owned type and correlates the cursor", () => {
    expect(
      normalizeJavaEntryPointResult(selected(), request).discovery?.selection?.binaryName,
    ).toBe("demo.Runner");
  });
  it.each([
    ["missing selection", (v: any) => delete v.discovery.selection],
    ["file", (v: any) => (v.discovery.selection.path = "Other.java")],
    ["position", (v: any) => (v.discovery.selection.position.character = 81)],
    ["owner", (v: any) => (v.discovery.selection.binaryName = "demo.Outer")],
    ["range", (v: any) => (v.discovery.selection.range.start.character = 90)],
    ["exclusive end", (v: any) => (v.discovery.selection.range.end.character = 80)],
    ["method outside type", (v: any) => (v.discovery.selection.range.start.character = 70)],
  ])("rejects %s without falling back to file candidates", (_, mutate) => {
    const value = selected();
    mutate(value);
    expect(() => normalizeJavaEntryPointResult(value, request)).toThrow();
  });
  it("rejects an unsolicited selection on a file-only query", () => {
    expect(() =>
      normalizeJavaEntryPointResult(selected(), { ...request, position: undefined }),
    ).toThrow();
  });
  it("retains a positively selected inner type with zero declared classic mains", () => {
    const value = selected();
    Object.assign(value.discovery!, {
      candidates: [],
      returnedCount: 0,
      totalEligibleCount: 0,
      observedEligibleLowerBound: 0,
    });
    value.discovery!.selection!.binaryName = "demo.Runner$Dormant";
    const normalized = normalizeJavaEntryPointResult(value, request).discovery!;
    expect(normalized.selection?.binaryName).toBe("demo.Runner$Dormant");
    expect(normalized.candidates).toEqual([]);
    expect(normalized.complete).toBe(false);
  });
});
