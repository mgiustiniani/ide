import { describe, expect, it, vi } from "vitest";
import {
  javaClassMoveCommandsForActiveFile,
  type JavaClassMoveCommandOptions,
} from "./javaClassMoveCommands";
import { buildProjectModel, type JavaProjectModel } from "./useJavaProjectModelController";

const file = "service/src/main/java/com/example/Widget.java";
const type = {
  name: "Widget",
  qualifiedName: "com.example.Widget",
  kind: "CLASS",
  path: file,
  line: 3,
};
const model: JavaProjectModel = {
  packages: [],
  classes: [type],
  symbols: [],
  totalSymbolCount: 1,
  presentedSymbolsTruncated: false,
};

function options(overrides: Partial<JavaClassMoveCommandOptions> = {}) {
  return {
    model,
    activeFilePath: file,
    projectPath: "service",
    canReview: () => true,
    onReview: vi.fn(),
    ...overrides,
  } satisfies JavaClassMoveCommandOptions;
}

describe("javaClassMoveCommandsForActiveFile", () => {
  it("offers a reviewed move for the exact active Java type", () => {
    const input = options();
    const [command] = javaClassMoveCommandsForActiveFile(input);

    expect(command).toMatchObject({
      id: `java.refactor.move-class:${encodeURIComponent(file)}:${encodeURIComponent(type.qualifiedName)}`,
      label: `Review move of Java type ${type.qualifiedName} (${file})`,
      category: "Java · Refactor",
    });
    command?.run();
    expect(input.onReview).toHaveBeenCalledWith(type);
  });

  it("offers separate commands for multiple type declarations in the same file", () => {
    const nestedOrSecondaryType = {
      ...type,
      name: "Companion",
      qualifiedName: "com.example.Companion",
      line: 12,
    };
    const commands = javaClassMoveCommandsForActiveFile({
      ...options(),
      model: { ...model, classes: [nestedOrSecondaryType, type] },
    });

    expect(commands.map(({ label }) => label)).toEqual([
      `Review move of Java type ${type.qualifiedName} (${file})`,
      `Review move of Java type ${nestedOrSecondaryType.qualifiedName} (${file})`,
    ]);
  });

  it("uses only RefactorKit type rows and the shared review gate", () => {
    const canReview = vi.fn(() => false);
    const input = options({ canReview });

    expect(javaClassMoveCommandsForActiveFile(input)).toEqual([]);
    expect(canReview).toHaveBeenCalledWith(type);
  });

  it("refuses missing models, paths outside the project, and unsafe paths", () => {
    expect(javaClassMoveCommandsForActiveFile(options({ model: null }))).toEqual([]);
    expect(
      javaClassMoveCommandsForActiveFile(
        options({ activeFilePath: "other/src/main/java/com/example/Widget.java" }),
      ),
    ).toEqual([]);
    expect(
      javaClassMoveCommandsForActiveFile(options({ activeFilePath: "../Widget.java" })),
    ).toEqual([]);
    expect(javaClassMoveCommandsForActiveFile(options({ projectPath: "../service" }))).toEqual([]);
  });

  it("disambiguates duplicate type rows by their source paths", () => {
    const duplicate = {
      ...type,
      path: "service/other/src/main/java/com/example/Widget.java",
    };
    const commands = javaClassMoveCommandsForActiveFile({
      ...options(),
      projectPath: "service",
      model: { ...model, classes: [type, duplicate] },
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.label).toContain(`(${file})`);
  });

  it("does not infer a type from package rows when RefactorKit has no active-file type identity", () => {
    const packageOnlyModel = buildProjectModel([
      {
        kind: "PACKAGE",
        qualifiedName: "com.example",
        path: file,
        line: 1,
      },
    ]);

    expect(javaClassMoveCommandsForActiveFile({ ...options(), model: packageOnlyModel })).toEqual(
      [],
    );
  });
});
