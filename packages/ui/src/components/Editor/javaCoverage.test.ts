import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import { describe, expect, it, vi } from "vitest";
import type { JavaEditorCoverage } from "./Editor";
import { registerJavaCoverage } from "./javaCoverage";

function harness() {
  let changed!: () => void;
  const collection = { clear: vi.fn(), set: vi.fn() };
  const model = {
    getLineCount: () => 3,
    isDisposed: () => false,
  } as unknown as Monaco.editor.ITextModel;
  const editor = {
    createDecorationsCollection: () => collection,
    onDidChangeModelContent: (listener: () => void) => {
      changed = listener;
      return { dispose: vi.fn() };
    },
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  }
  const api = {
    Range,
    editor: {
      OverviewRulerLane: { Right: 4 },
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    },
  } as unknown as typeof Monaco;
  const coverage: JavaEditorCoverage = {
    context: { workspaceId: "workspace", generation: 2, sessionId: "coverage-run" },
    filePath: "src/main/java/example/Choice.java",
    sourceCurrent: true,
    lines: [
      {
        number: 1,
        missedInstructions: 0,
        coveredInstructions: 3,
        missedBranches: 0,
        coveredBranches: 0,
      },
      {
        number: 2,
        missedInstructions: 2,
        coveredInstructions: 0,
        missedBranches: 1,
        coveredBranches: 0,
      },
      {
        number: 3,
        missedInstructions: 1,
        coveredInstructions: 2,
        missedBranches: 1,
        coveredBranches: 1,
      },
      {
        number: 4,
        missedInstructions: 1,
        coveredInstructions: 0,
        missedBranches: 0,
        coveredBranches: 0,
      },
    ],
  };
  const invalidated = new Set<string>();
  return {
    api,
    editor,
    model,
    collection,
    coverage,
    invalidated,
    edit: () => changed(),
    register: (value = coverage) =>
      registerJavaCoverage({
        api,
        editor,
        model,
        filePath: coverage.filePath,
        coverage: value,
        invalidated,
      }),
  };
}

describe("Java coverage Monaco decorations", () => {
  it("marks measured covered, uncovered and partial lines and omits out-of-range lines", () => {
    const h = harness();
    const registration = h.register();
    const points = h.collection.set.mock.calls[0]![0];

    expect(
      points.map((point: Monaco.editor.IModelDeltaDecoration) => point.options.className),
    ).toEqual([
      "java-coverage-line-covered",
      "java-coverage-line-uncovered",
      "java-coverage-line-partial",
    ]);
    expect(points[2]?.options.hoverMessage).toEqual({
      value: "JaCoCo: 2 of 3 instructions covered. Branches: 1 of 2 covered.",
    });
    registration.dispose();
  });

  it("revokes coverage immediately after an edit and keeps it retired for that measured session", () => {
    const h = harness();
    const registration = h.register();
    expect(h.collection.set).toHaveBeenCalledTimes(1);
    h.edit();
    expect(h.collection.clear).toHaveBeenCalledTimes(1);
    registration.dispose();

    h.collection.set.mockClear();
    h.register();
    expect(h.collection.set).not.toHaveBeenCalled();
    h.register({ ...h.coverage, context: { ...h.coverage.context, sessionId: "next-run" } });
    expect(h.collection.set).toHaveBeenCalledTimes(1);
  });

  it("refuses stale source before drawing and does not restore it after a later save", () => {
    const h = harness();
    h.register({ ...h.coverage, sourceCurrent: false });
    expect(h.collection.set).not.toHaveBeenCalled();
    h.register();
    expect(h.collection.set).not.toHaveBeenCalled();
  });
});
