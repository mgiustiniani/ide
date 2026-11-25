import { describe, expect, it, vi } from "vitest";
import {
  javaPackageMoveCommandForActiveFile,
  type JavaPackageMoveCommandOptions,
} from "./javaPackageMoveCommand";
import { buildProjectModel, type JavaProjectModel } from "./useJavaProjectModelController";

const file = "service/src/main/java/com/example/Widget.java";
const pkg = {
  name: "com.example",
  path: file,
  sourcePaths: [file],
  classCount: 1,
  symbolCount: 1,
};
const model: JavaProjectModel = {
  packages: [pkg],
  classes: [],
  symbols: [],
  totalSymbolCount: 1,
  presentedSymbolsTruncated: false,
};

function options(overrides: Partial<JavaPackageMoveCommandOptions> = {}) {
  return {
    model,
    activeFilePath: file,
    projectPath: "service",
    canReview: () => true,
    onReview: vi.fn(),
    ...overrides,
  } satisfies JavaPackageMoveCommandOptions;
}

describe("javaPackageMoveCommandForActiveFile", () => {
  it("offers the capability-gated package review for the exact active source", () => {
    const input = options();
    const command = javaPackageMoveCommandForActiveFile(input);

    expect(command).toMatchObject({
      id: "java.refactor.move-package",
      label: "Review move of package com.example",
      category: "Java · Refactor",
    });
    command?.run();
    expect(input.onReview).toHaveBeenCalledWith(pkg);
  });

  it("does not offer a package move when the operation gate refuses review", () => {
    expect(javaPackageMoveCommandForActiveFile(options({ canReview: () => false }))).toBeNull();
  });

  it("uses the active file's type identity to ignore an unqualified member's default-package grouping", () => {
    const ambiguousModel = buildProjectModel([
      {
        kind: "CLASS",
        qualifiedName: "com.example.Widget",
        path: file,
        line: 1,
      },
      {
        kind: "METHOD",
        qualifiedName: "Widget.render",
        path: file,
        line: 4,
      },
    ]);
    const command = javaPackageMoveCommandForActiveFile(options({ model: ambiguousModel }));

    expect(ambiguousModel.packages.map(({ name }) => name)).toEqual(["(default)", "com.example"]);
    expect(command).toMatchObject({ label: "Review move of package com.example" });
  });

  it("refuses paths outside the selected project and unsafe workspace paths", () => {
    expect(
      javaPackageMoveCommandForActiveFile(
        options({ activeFilePath: "other/src/main/java/com/example/Widget.java" }),
      ),
    ).toBeNull();
    expect(
      javaPackageMoveCommandForActiveFile(options({ activeFilePath: "../Widget.java" })),
    ).toBeNull();
    expect(javaPackageMoveCommandForActiveFile(options({ projectPath: "../service" }))).toBeNull();
  });

  it("refuses missing, default-package, and ambiguous source ownership", () => {
    expect(javaPackageMoveCommandForActiveFile(options({ model: null }))).toBeNull();
    expect(
      javaPackageMoveCommandForActiveFile(
        options({
          model: { ...model, packages: [{ ...pkg, name: "" }] },
        }),
      ),
    ).toBeNull();
    expect(
      javaPackageMoveCommandForActiveFile(
        options({ model: { ...model, packages: [pkg, { ...pkg, name: "com.example.other" }] } }),
      ),
    ).toBeNull();
  });
});
