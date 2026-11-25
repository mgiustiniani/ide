import { describe, expect, it } from "vitest";
import { validateRefactorChangeIntent, type RefactorKitChangeIntent } from "../refactorkit";
import { javaContextRefactoringOperation } from "../java-context-refactoring";

const actions = [
  { operation: "organize-imports", path: "project/A.java" },
  { operation: "format-file", path: "project/B.java" },
];
const validate = (value: unknown) => validateRefactorChangeIntent("batch-cleanup", value as RefactorKitChangeIntent);

describe("saved Java batch cleanup intent", () => {
  it("maps the public operation and requires an explicit bounded selection", () => {
    expect(javaContextRefactoringOperation("batch-cleanup")).toBe("batchCleanup");
    expect(validate(undefined)).toBeDefined();
    expect(validate({ operation: "batch-cleanup", actions })).toBeUndefined();
  });
  it.each([
    [], [actions[0]], Array.from({ length: 17 }, (_, i) => ({ ...actions[0], path: `project/F${i}.java` })),
    [actions[0], actions[0]],
    [actions[0], { ...actions[1], path: "../B.java" }],
    [actions[0], { ...actions[1], path: "project/./B.java" }],
    [actions[0], { ...actions[1], path: "project/B.kt" }],
    [actions[0], { ...actions[1], path: "project/B\u0000.java" }],
    [actions[0], { ...actions[1], operation: "safe-delete" }],
    [actions[0], null],
  ].map((actions) => ({ actions })))("refuses malformed, overlapping or unsupported batches %j", ({ actions }) => {
    expect(validate({ operation: "batch-cleanup", actions })).toBeDefined();
  });
  it("rejects undeclared action parameters and mutation intent", () => {
    expect(validate({ operation: "batch-cleanup", actions, newName: "Unexpected" })).toBeDefined();
    expect(validate({ operation: "batch-cleanup", actions: [actions[0], { ...actions[1], symbol: "Anything" }] })).toBeDefined();
  });
});
