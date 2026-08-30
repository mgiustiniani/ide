import { describe, expect, it } from "vitest";

import {
  validateRefactorChangeIntent,
  type RefactorKitChangeIntent,
} from "../refactorkit";

// REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001: change-intent validation must be
// strict. Every invalid intent (absent, mismatched, whitespace-only, unsafe
// move path) must be refused — never accepted as undefined.
describe("validateRefactorChangeIntent", () => {
  it("refuses whitespace-only rename-class intent", () => {
    const intent: RefactorKitChangeIntent = { operation: "rename-class", newName: "   " };
    expect(validateRefactorChangeIntent("rename-class", intent)).toBeDefined();
  });

  it("refuses whitespace-only rename-member intent", () => {
    const intent: RefactorKitChangeIntent = { operation: "rename-member", newName: "\t" };
    expect(validateRefactorChangeIntent("rename-member", intent)).toBeDefined();
  });

  it("refuses whitespace-only rename-local-variable intent", () => {
    const intent: RefactorKitChangeIntent = {
      operation: "rename-local-variable",
      fromName: "x",
      newName: " \t ",
    };
    expect(validateRefactorChangeIntent("rename-local-variable", intent)).toBeDefined();
  });

  it("refuses absent intent for rename-class", () => {
    expect(validateRefactorChangeIntent("rename-class", undefined)).toBeDefined();
  });

  it("refuses absent intent for rename-member", () => {
    expect(validateRefactorChangeIntent("rename-member", undefined)).toBeDefined();
  });

  it("refuses absent intent for rename-local-variable", () => {
    expect(validateRefactorChangeIntent("rename-local-variable", undefined)).toBeDefined();
  });

  it("refuses absent intent for move-class", () => {
    expect(validateRefactorChangeIntent("move-class", undefined)).toBeDefined();
  });

  it("refuses absent intent for change-method-signature", () => {
    expect(validateRefactorChangeIntent("change-method-signature", undefined)).toBeDefined();
  });

  it("refuses whitespace-only move-class newPackage", () => {
    const intent: RefactorKitChangeIntent = { operation: "move-class", newPackage: "   " };
    expect(validateRefactorChangeIntent("move-class", intent)).toBeDefined();
  });

  it("refuses invalid move-class sourcePath (traversal)", () => {
    const intent: RefactorKitChangeIntent = {
      operation: "move-class",
      newPackage: "com.example",
      sourcePath: "../outside/A.java",
    };
    expect(validateRefactorChangeIntent("move-class", intent)).toBeDefined();
  });

  it("refuses invalid move-class targetPath (absolute)", () => {
    const intent: RefactorKitChangeIntent = {
      operation: "move-class",
      newPackage: "com.example",
      targetPath: "/absolute/path/B.java",
    };
    expect(validateRefactorChangeIntent("move-class", intent)).toBeDefined();
  });

  it("refuses whitespace-only move-class sourcePath", () => {
    const intent: RefactorKitChangeIntent = {
      operation: "move-class",
      newPackage: "com.example",
      sourcePath: "  ",
    };
    expect(validateRefactorChangeIntent("move-class", intent)).toBeDefined();
  });

  it("refuses whitespace-only change-method-signature intent", () => {
    const intent: RefactorKitChangeIntent = {
      operation: "change-method-signature",
      oldParameter: "a",
      newParameter: "  ",
    };
    expect(validateRefactorChangeIntent("change-method-signature", intent)).toBeDefined();
  });

  it("refuses mismatched intent for rename-class", () => {
    const intent: RefactorKitChangeIntent = { operation: "move-class", newPackage: "com.example" };
    expect(validateRefactorChangeIntent("rename-class", intent)).toBeDefined();
  });

  it("refuses any intent for safe-delete", () => {
    const intent: RefactorKitChangeIntent = { operation: "safe-delete" };
    expect(validateRefactorChangeIntent("safe-delete", intent)).toBeDefined();
  });

  it("refuses mismatched safe-delete intent", () => {
    const intent: RefactorKitChangeIntent = { operation: "rename-class", newName: "B" };
    expect(validateRefactorChangeIntent("safe-delete", intent)).toBeDefined();
  });

  // Accept paths — the validator must not over-reject valid requests.
  it("accepts a well-formed rename-class intent", () => {
    const intent: RefactorKitChangeIntent = { operation: "rename-class", newName: "B" };
    expect(validateRefactorChangeIntent("rename-class", intent)).toBeUndefined();
  });

  it("accepts a well-formed move-class intent with safe paths", () => {
    const intent: RefactorKitChangeIntent = {
      operation: "move-class",
      newPackage: "com.example",
      sourcePath: "src/main/java/com/example/A.java",
      targetPath: "src/main/java/com/example/B.java",
    };
    expect(validateRefactorChangeIntent("move-class", intent)).toBeUndefined();
  });

  it("accepts a well-formed change-method-signature intent", () => {
    const intent: RefactorKitChangeIntent = {
      operation: "change-method-signature",
      oldParameter: "a",
      newParameter: "b",
    };
    expect(validateRefactorChangeIntent("change-method-signature", intent)).toBeUndefined();
  });

  it("accepts safe-delete with no intent", () => {
    expect(validateRefactorChangeIntent("safe-delete", undefined)).toBeUndefined();
  });
});
