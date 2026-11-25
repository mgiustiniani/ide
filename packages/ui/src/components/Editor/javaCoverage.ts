import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { JavaEditorCoverage } from "./Editor";

const MAX_INVALIDATED_COVERAGE_BINDINGS = 256;

function bindingKey(coverage: JavaEditorCoverage, filePath: string) {
  return JSON.stringify([
    coverage.context.workspaceId,
    coverage.context.generation,
    coverage.context.sessionId,
    filePath,
  ]);
}

function invalidate(bindings: Set<string>, key: string) {
  bindings.add(key);
  while (bindings.size > MAX_INVALIDATED_COVERAGE_BINDINGS)
    bindings.delete(bindings.values().next().value!);
}

/** Show only measured JaCoCo lines for the matching Java source, then revoke them on edits. */
export function registerJavaCoverage({
  api,
  editor,
  model,
  filePath,
  coverage,
  invalidated,
}: {
  api: typeof Monaco;
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  filePath: string;
  coverage: JavaEditorCoverage;
  invalidated: Set<string>;
}): Monaco.IDisposable {
  const decorations = editor.createDecorationsCollection();
  const key = bindingKey(coverage, filePath);
  if (!coverage.sourceCurrent) invalidate(invalidated, key);
  if (
    coverage.sourceCurrent &&
    coverage.filePath === filePath &&
    !invalidated.has(key) &&
    !model.isDisposed()
  ) {
    const points: Monaco.editor.IModelDeltaDecoration[] = [];
    for (const line of coverage.lines) {
      if (
        !Number.isSafeInteger(line.number) ||
        line.number < 1 ||
        line.number > model.getLineCount()
      )
        continue;
      const instructions = line.coveredInstructions + line.missedInstructions;
      if (instructions === 0) continue;
      const state =
        line.coveredInstructions === 0
          ? "uncovered"
          : line.missedInstructions === 0
            ? "covered"
            : "partial";
      const branches = line.coveredBranches + line.missedBranches;
      const branchSummary =
        branches > 0
          ? ` Branches: ${line.coveredBranches} of ${branches} covered.`
          : " No branch data was reported for this line.";
      points.push({
        range: new api.Range(line.number, 1, line.number, 1),
        options: {
          isWholeLine: true,
          className: `java-coverage-line-${state}`,
          hoverMessage: {
            value: `JaCoCo: ${line.coveredInstructions} of ${instructions} instructions covered.${branchSummary}`,
          },
          overviewRuler: {
            color: state === "covered" ? "#16a34a" : state === "uncovered" ? "#dc2626" : "#ca8a04",
            position: api.editor.OverviewRulerLane.Right,
          },
          stickiness: api.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }
    decorations.set(points);
  }

  const content = editor.onDidChangeModelContent(() => {
    invalidate(invalidated, key);
    decorations.clear();
  });

  return {
    dispose() {
      content.dispose();
      decorations.clear();
    },
  };
}
