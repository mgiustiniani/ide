import { describe, expect, it } from "vitest";

import { validateRefactorChangeIntent, type RefactorKitChangeIntent } from "../refactorkit";

// REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001: change-intent validation must be
// strict. Every invalid intent (absent, mismatched, whitespace-only, unsafe
// move path) must be refused — never accepted as undefined.
describe("validateRefactorChangeIntent", () => {
  it("requires a type name and two distinct ordered parameters for Introduce Parameter Object", () => {
    const operation = "introduce-parameter-object";
    expect(validateRefactorChangeIntent(operation, {
      operation, typeName: "Arguments", parameters: ["left", "right"],
    })).toBeUndefined();
    expect(validateRefactorChangeIntent(operation, {
      operation, typeName: "Arguments", parameters: ["left", "left"],
    })).toMatch(/two different parameter names/u);
    expect(validateRefactorChangeIntent(operation, {
      operation, typeName: " ", parameters: ["left", "right"],
    })).toMatch(/type name/u);
  });

  it("requires a delegate type and a group of distinct members", () => {
    const operation = "extract-delegate";
    const intent = { operation, typeName: "Calculation", members: ["OFFSET", "adjust", "compute"] } as const;
    expect(validateRefactorChangeIntent(operation, { ...intent, members: [...intent.members] })).toBeUndefined();
    expect(validateRefactorChangeIntent(operation, { ...intent, members: ["adjust", "adjust"] })).toMatch(/distinct member names/u);
    expect(validateRefactorChangeIntent(operation, { ...intent, members: ["compute"] })).toMatch(/at least two/u);
  });

  it("accepts Make Static without a change-intent payload", () => {
    expect(validateRefactorChangeIntent("make-static", undefined)).toBeUndefined();
  });

  it("accepts Make Public without a change-intent payload", () => {
    expect(validateRefactorChangeIntent("make-public", undefined)).toBeUndefined();
  });

  it("accepts Encapsulate Field without intent and refuses supplied intent", () => {
    expect(validateRefactorChangeIntent("encapsulate-field", undefined)).toBeUndefined();
    expect(
      validateRefactorChangeIntent("encapsulate-field", {
        operation: "safe-delete",
      }),
    ).toMatch(/does not accept any change intent/u);
  });

  it.each(["inline-variable", "inline-method", "inline-constant"] as const)(
    "accepts %s without mutation intent because the selected target supplies its name",
    (operation) => {
      expect(validateRefactorChangeIntent(operation, undefined)).toBeUndefined();
    },
  );

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

  it.each([
    { operation: "move-package", fromPackage: " ", toPackage: "example.services" },
    { operation: "move-package", fromPackage: "example", toPackage: "\t" },
  ] as const)("refuses incomplete package-move intent", (intent) => {
    expect(validateRefactorChangeIntent("move-package", intent)).toBeDefined();
  });

  it("accepts a safe move-source-root destination", () => {
    expect(
      validateRefactorChangeIntent("move-source-root", {
        operation: "move-source-root",
        to: "app/src/main/java-relocated",
      }),
    ).toBeUndefined();
  });

  it.each(["", "../outside", "/absolute", "C:/absolute", "app//java", " app/java "])(
    "refuses unsafe move-source-root destination %j",
    (to) => {
      expect(
        validateRefactorChangeIntent("move-source-root", { operation: "move-source-root", to }),
      ).toBeDefined();
    },
  );

  it("refuses absent intent for change-method-signature", () => {
    expect(validateRefactorChangeIntent("change-method-signature", undefined)).toBeDefined();
  });

  it("accepts a bounded parameter type change intent", () => {
    expect(
      validateRefactorChangeIntent("change-method-parameter-type", {
        operation: "change-method-parameter-type",
        parameterName: "count",
        newType: "java.lang.Integer",
      }),
    ).toBeUndefined();
  });

  it.each([
    { operation: "change-method-parameter-type", parameterName: "", newType: "Integer" },
    { operation: "change-method-parameter-type", parameterName: "count", newType: " \t " },
    { operation: "change-method-parameter-type", parameterName: "count", newType: "I\0nteger" },
    {
      operation: "change-method-parameter-type",
      parameterName: "count",
      newType: "x".repeat(4097),
    },
  ] as const)("refuses incomplete or unbounded parameter type intent", (intent) => {
    expect(validateRefactorChangeIntent("change-method-parameter-type", intent)).toBeDefined();
  });

  it.each(["extract-constant", "extract-variable", "extract-parameter", "extract-field"] as const)(
    "refuses empty %s name",
    (operation) => {
      for (const name of ["", " \t "]) {
        expect(validateRefactorChangeIntent(operation, { operation, name })).toBeDefined();
      }
    },
  );

  it("accepts only a non-empty, bounded Extract Method name", () => {
    expect(
      validateRefactorChangeIntent("extract-method", {
        operation: "extract-method",
        methodName: "calculateTotal",
      }),
    ).toBeUndefined();
    for (const methodName of ["", " \t ", "x".repeat(257), "bad\0name"]) {
      expect(
        validateRefactorChangeIntent("extract-method", {
          operation: "extract-method",
          methodName,
        }),
      ).toBeDefined();
    }
    expect(validateRefactorChangeIntent("extract-method", undefined)).toBeDefined();
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

  it("accepts a distinct comma-separated reorder parameter list", () => {
    expect(
      validateRefactorChangeIntent("reorder-method-parameters", {
        operation: "reorder-method-parameters",
        newOrder: " second, first ",
      }),
    ).toBeUndefined();
  });

  it.each(["", "first", "first,", "first,first", "first,second,first", "first,\0second"])(
    "refuses an incomplete or ambiguous reorder parameter list %j",
    (newOrder) => {
      expect(
        validateRefactorChangeIntent("reorder-method-parameters", {
          operation: "reorder-method-parameters",
          newOrder,
        }),
      ).toBeDefined();
    },
  );

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
      targetModuleId: "library",
    };
    expect(validateRefactorChangeIntent("move-class", intent)).toBeUndefined();
  });

  it("refuses unsafe explicit move-class module identities", () => {
    expect(
      validateRefactorChangeIntent("move-class", {
        operation: "move-class",
        newPackage: "com.example",
        targetModuleId: " \n ",
      }),
    ).toMatch(/targetModuleId/);
  });

  it("accepts a complete package-move intent", () => {
    expect(
      validateRefactorChangeIntent("move-package", {
        operation: "move-package",
        fromPackage: "com.example",
        toPackage: "com.example.services",
      }),
    ).toBeUndefined();
  });

  it("accepts a well-formed change-method-signature intent", () => {
    const intent: RefactorKitChangeIntent = {
      operation: "change-method-signature",
      oldParameter: "a",
      newParameter: "b",
    };
    expect(validateRefactorChangeIntent("change-method-signature", intent)).toBeUndefined();
  });

  it("accepts only a complete Add Parameter intent", () => {
    const intent: RefactorKitChangeIntent = {
      operation: "add-method-parameter",
      parameterType: "int",
      parameterName: "count",
      defaultExpression: "0",
    };
    expect(validateRefactorChangeIntent("add-method-parameter", intent)).toBeUndefined();
    expect(
      validateRefactorChangeIntent("add-method-parameter", {
        ...intent,
        defaultExpression: "  ",
      }),
    ).toContain("defaultExpression");
    expect(
      validateRefactorChangeIntent("add-method-parameter", {
        ...intent,
        parameterName: "x\0y",
      }),
    ).toContain("parameterName");
  });

  it("requires a bounded parameter name for Remove Parameter", () => {
    const intent: RefactorKitChangeIntent = {
      operation: "remove-method-parameter",
      parameterName: "unused",
    };
    expect(validateRefactorChangeIntent("remove-method-parameter", intent)).toBeUndefined();
    expect(
      validateRefactorChangeIntent("remove-method-parameter", {
        ...intent,
        parameterName: "  ",
      }),
    ).toContain("parameterName");
    expect(
      validateRefactorChangeIntent("remove-method-parameter", {
        ...intent,
        parameterName: "x".repeat(4097),
      }),
    ).toContain("parameterName");
    expect(
      validateRefactorChangeIntent("remove-method-parameter", {
        ...intent,
        parameterName: "x\0y",
      }),
    ).toContain("parameterName");
    expect(validateRefactorChangeIntent("remove-method-parameter", undefined)).toContain(
      "requires operation-specific change intent",
    );
  });

  it("accepts a non-empty extract-constant name", () => {
    expect(
      validateRefactorChangeIntent("extract-constant", {
        operation: "extract-constant",
        name: "MAX_RETRIES",
      }),
    ).toBeUndefined();
  });

  it("accepts a non-empty extract-variable name", () => {
    expect(
      validateRefactorChangeIntent("extract-variable", {
        operation: "extract-variable",
        name: "doubled",
      }),
    ).toBeUndefined();
  });

  it.each(["extract-parameter", "extract-field"] as const)(
    "accepts a non-empty %s name",
    (operation) => {
      expect(validateRefactorChangeIntent(operation, { operation, name: "value" })).toBeUndefined();
    },
  );

  it("accepts safe-delete with no intent", () => {
    expect(validateRefactorChangeIntent("safe-delete", undefined)).toBeUndefined();
  });
});

describe("field type change intent", () => {
  it("requires an explicit requested type", () => {
    expect(validateRefactorChangeIntent("change-field-type", undefined)).toBeDefined();
    expect(validateRefactorChangeIntent("change-field-type", { operation: "change-field-type", newType: "long" })).toBeUndefined();
  });
  it.each(["", " ", "x".repeat(4097), "\0"])("refuses an empty or unbounded type request", newType => {
    expect(validateRefactorChangeIntent("change-field-type", { operation: "change-field-type", newType })).toBeDefined();
  });
});
