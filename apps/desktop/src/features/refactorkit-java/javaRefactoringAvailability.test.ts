import { describe, expect, it } from "vitest";
import type { RefactorKitCapabilities } from "@ide/contracts";
import {
  applicableJavaRefactoringOperations,
  availableJavaRefactoringOperations,
  type JavaRefactoringAvailabilityOptions,
} from "./javaRefactoringAvailability";

function capabilities(): RefactorKitCapabilities {
  return {
    api: "refactorkit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaImportExternalClass: {
      supported: false,
      targetDirectory: false,
      preview: false,
      apply: false,
      rollback: false,
      stability: "experimental",
    },
    generalRefactoring: {
      supported: true,
      operations: ["move-package"],
      preview: true,
      apply: true,
      rollback: true,
      discard: true,
      stability: "stable",
    },
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["movePackage"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
    },
    methods: [
      {
        name: "project.context",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
        features: {
          javaRefactoringsUseContextAuthority: true,
          managedMutationAuthority: true,
        },
      },
      {
        name: "refactor.preview",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
      },
      { name: "refactor.apply", stability: "stable", requiresProject: true, writesWorkspace: true },
      { name: "patch.rollback", stability: "stable", requiresProject: true, writesWorkspace: true },
    ],
    languageKernel: {
      available: true,
      schema: {
        schemaVersion: 1,
        adapters: [
          {
            languageId: "java",
            extensions: ["java"],
            backend: "java-test-backend",
            runtime: {
              executionMode: "in-process",
              supportsTimeout: false,
              supportsCancellation: false,
              usesWorkspaceOverlay: false,
              recordsProcessProvenance: false,
              limits: {
                requestTimeoutMillis: null,
                maxInputBytes: null,
                maxOutputBytes: null,
                maxProcesses: null,
              },
            },
            capabilities: [
              {
                operation: "movePackage",
                stability: "stable",
                evidence: "structural-parse",
                mutationAuthority: "managed-stable",
                backend: "java-test-backend",
                runtime: {
                  executionMode: "in-process",
                  supportsTimeout: false,
                  supportsCancellation: false,
                  usesWorkspaceOverlay: false,
                  recordsProcessProvenance: false,
                  limits: {
                    requestTimeoutMillis: null,
                    maxInputBytes: null,
                    maxOutputBytes: null,
                    maxProcesses: null,
                  },
                },
                extensions: ["java"],
              },
            ],
          },
        ],
        vocabulary: {
          stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
          evidence: [
            "compiler",
            "language-server",
            "native-ast",
            "structural-parse",
            "lexical",
            "none",
          ],
          mutationAuthority: ["managed-stable", "proposal-only", "none"],
          executionMode: ["in-process", "external-process"],
        },
      },
    },
  };
}

const baseOptions: Omit<JavaRefactoringAvailabilityOptions, "capabilities"> = {
  sdkSelected: true,
  projectContextAvailable: true,
  projectPath: "sample",
  dirtyPaths: [],
  editorSelection: false,
};

describe("Java refactoring availability", () => {
  it("offers stable Add Module preview from project context and blocks Apply for dirty buffers", () => {
    const advertised = capabilities();
    advertised.methods!.push({
      name: "java.createMavenModule",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
      features: { preview: true, renderedDiff: true, apply: true, rollback: true },
    });

    expect(
      availableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
    ).toContain("create-maven-module");
    expect(
      applicableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
    ).toContain("create-maven-module");

    const dirty = {
      ...baseOptions,
      capabilities: advertised,
      dirtyPaths: ["sample/src/main/java/example/App.java"],
    };
    expect(availableJavaRefactoringOperations(dirty)).toContain("create-maven-module");
    expect(applicableJavaRefactoringOperations(dirty)).not.toContain("create-maven-module");
  });

  it("offers Pull Up only for a clean saved method selection with compiler-backed managed authority", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["pullUpMember"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const languageKernel = advertised.languageKernel;
    if (!languageKernel?.available) throw new Error("Expected language-kernel capabilities.");
    languageKernel.schema.adapters[0]!.capabilities.push({
      ...languageKernel.schema.adapters[0]!.capabilities[0]!,
      operation: "pullUpMember",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    });
    const savedSelection = {
      ...baseOptions,
      capabilities: advertised,
      editorSelection: true,
    };

    expect(availableJavaRefactoringOperations(savedSelection)).toContain("pull-up-member");
    expect(applicableJavaRefactoringOperations(savedSelection)).toContain("pull-up-member");
    expect(
      availableJavaRefactoringOperations({ ...savedSelection, editorSelection: false }),
    ).not.toContain("pull-up-member");
    expect(
      availableJavaRefactoringOperations({
        ...savedSelection,
        dirtyPaths: ["sample/src/main/java/fixture/Hierarchy.java"],
      }),
    ).not.toContain("pull-up-member");
  });

  it("offers Push Down only for a clean saved method selection with managed provider authority", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["pushDownMember"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const languageKernel = advertised.languageKernel;
    if (!languageKernel?.available) throw new Error("Expected language-kernel capabilities.");
    languageKernel.schema.adapters[0]!.capabilities.push({
      ...languageKernel.schema.adapters[0]!.capabilities[0]!,
      operation: "pushDownMember",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    });
    const savedSelection = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(savedSelection)).toContain("push-down-member");
    expect(applicableJavaRefactoringOperations(savedSelection)).toContain("push-down-member");
    expect(
      availableJavaRefactoringOperations({ ...savedSelection, editorSelection: false }),
    ).not.toContain("push-down-member");
    expect(
      availableJavaRefactoringOperations({
        ...savedSelection,
        dirtyPaths: ["sample/src/main/java/fixture/Hierarchy.java"],
      }),
    ).not.toContain("push-down-member");
  });

  it("offers Move Member only when both provider selection and Java type search are available", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["moveMember"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const languageKernel = advertised.languageKernel;
    if (!languageKernel?.available) throw new Error("Expected language-kernel capabilities.");
    languageKernel.schema.adapters[0]!.capabilities.push({
      ...languageKernel.schema.adapters[0]!.capabilities[0]!,
      operation: "moveMember",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    });
    const savedSelection = {
      ...baseOptions,
      capabilities: advertised,
      editorSelection: true,
      javaWorkspaceSymbolsAvailable: true,
    };

    expect(availableJavaRefactoringOperations(savedSelection)).toContain("move-member");
    expect(applicableJavaRefactoringOperations(savedSelection)).toContain("move-member");
    expect(
      availableJavaRefactoringOperations({
        ...savedSelection,
        javaWorkspaceSymbolsAvailable: false,
      }),
    ).not.toContain("move-member");
    expect(
      availableJavaRefactoringOperations({ ...savedSelection, editorSelection: false }),
    ).not.toContain("move-member");
    expect(
      availableJavaRefactoringOperations({
        ...savedSelection,
        dirtyPaths: ["sample/src/main/java/fixture/Types.java"],
      }),
    ).not.toContain("move-member");
  });

  it("offers managed inline previews only for a clean selected Java identifier in a full project context", () => {
    const advertised = capabilities();
    advertised.generalRefactoring!.operations = ["inline-variable", "inline-constant"];
    advertised.javaContextRefactoring!.operations = ["inlineVariable", "inlineConstant"];
    const languageKernel = advertised.languageKernel;
    if (!languageKernel?.available || !languageKernel.schema)
      throw new Error("Expected Java language-kernel capabilities.");
    const javaKernel = languageKernel.schema.adapters.find(
      (adapter) => adapter.languageId === "java",
    )!;
    javaKernel.capabilities.push(
      { ...javaKernel.capabilities[0]!, operation: "inlineVariable" },
      { ...javaKernel.capabilities[0]!, operation: "inlineConstant" },
    );
    const selected = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(selected)).toEqual(
      expect.arrayContaining(["inline-variable", "inline-constant"]),
    );
    expect(applicableJavaRefactoringOperations(selected)).toEqual(
      expect.arrayContaining(["inline-variable", "inline-constant"]),
    );
    expect(availableJavaRefactoringOperations({ ...selected, editorSelection: false })).not.toEqual(
      expect.arrayContaining(["inline-variable", "inline-constant"]),
    );
    expect(
      availableJavaRefactoringOperations({ ...selected, dirtyPaths: ["sample/A.java"] }),
    ).not.toEqual(expect.arrayContaining(["inline-variable", "inline-constant"]));
    expect(availableJavaRefactoringOperations({ ...selected, sdkSelected: false })).not.toEqual(
      expect.arrayContaining(["inline-variable", "inline-constant"]),
    );
  });

  it("allows Add Module from partial Maven context without enabling other context refactorings", () => {
    const advertised = capabilities();
    advertised.methods!.push({
      name: "java.createMavenModule",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
      features: { preview: true, renderedDiff: true, apply: true, rollback: true },
    });
    const partialMaven = {
      ...baseOptions,
      projectContextAvailable: false,
      partialMavenProjectContextAvailable: true,
      capabilities: advertised,
    };

    const preview = availableJavaRefactoringOperations(partialMaven);
    expect(preview).toContain("create-maven-module");
    expect(preview).not.toContain("move-class");
    expect(applicableJavaRefactoringOperations(partialMaven)).toContain("create-maven-module");
  });

  it("offers Gradle Add Module from its synchronized provider and blocks dirty-buffer Apply", () => {
    const advertised = capabilities();
    advertised.apiVersion = "0.2";
    advertised.methods!.push({
      name: "java.createGradleModule",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
      features: {
        preview: true,
        renderedDiff: true,
        apply: true,
        rollback: true,
        workspaceRelativeBuildRoot: true,
        canonicalNestedProjectPath: true,
        settingsInferredDsl: true,
      },
    });
    const gradle = {
      ...baseOptions,
      capabilities: advertised,
      projectContextAvailable: false,
      partialGradleProjectContextAvailable: true,
      dirtyPaths: ["sample/src/main/java/example/App.java"],
    };

    expect(availableJavaRefactoringOperations(gradle)).toContain("create-gradle-module");
    expect(applicableJavaRefactoringOperations(gradle)).not.toContain("create-gradle-module");
    expect(applicableJavaRefactoringOperations({ ...gradle, dirtyPaths: [] })).toContain(
      "create-gradle-module",
    );
    expect(availableJavaRefactoringOperations(gradle)).not.toContain("create-maven-module");
  });

  it("gates Add Parameter on saved-source selection and exact managed provider authority", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["changeSignature.addParameter"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    advertised.languageKernel!.schema!.adapters[0].capabilities = [
      {
        ...advertised.languageKernel!.schema!.adapters[0].capabilities[0],
        operation: "changeSignature.addParameter",
        stability: "stable",
        evidence: "compiler",
        mutationAuthority: "managed-stable",
      },
    ];
    const cursor = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(cursor)).toContain("add-method-parameter");
    expect(applicableJavaRefactoringOperations(cursor)).toContain("add-method-parameter");
    expect(availableJavaRefactoringOperations({ ...cursor, editorSelection: false })).not.toContain(
      "add-method-parameter",
    );
    expect(
      availableJavaRefactoringOperations({ ...cursor, dirtyPaths: ["sample/A.java"] }),
    ).not.toContain("add-method-parameter");

    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-editor-mutation-selection-v1";
    expect(availableJavaRefactoringOperations(cursor)).not.toContain("add-method-parameter");
  });

  it("gates Remove Parameter on a clean saved method cursor and its own capability", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["changeSignature.removeParameter"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    advertised.languageKernel!.schema!.adapters[0].capabilities = [
      {
        ...advertised.languageKernel!.schema!.adapters[0].capabilities[0],
        operation: "changeSignature.removeParameter",
        stability: "stable",
        evidence: "compiler",
        mutationAuthority: "managed-stable",
      },
    ];
    const cursor = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(cursor)).toContain("remove-method-parameter");
    expect(applicableJavaRefactoringOperations(cursor)).toContain("remove-method-parameter");
    expect(availableJavaRefactoringOperations({ ...cursor, editorSelection: false })).not.toContain(
      "remove-method-parameter",
    );
    expect(
      availableJavaRefactoringOperations({ ...cursor, dirtyPaths: ["sample/A.java"] }),
    ).not.toContain("remove-method-parameter");
  });

  it("offers package moves through the advertised SDK context route only", () => {
    const advertised = capabilities();
    expect(
      availableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
    ).toContain("move-package");
    expect(
      applicableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
    ).toContain("move-package");

    expect(
      availableJavaRefactoringOperations({
        ...baseOptions,
        capabilities: advertised,
        sdkSelected: false,
        projectContextAvailable: false,
      }),
    ).not.toContain("move-package");
  });

  it("offers parameter reordering only for a clean synchronized project and managed operation", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["changeSignature.reorderParameters"];
    const adapter = advertised.languageKernel?.available
      ? advertised.languageKernel.schema.adapters[0]
      : undefined;
    if (!adapter) throw new Error("Expected Java language-kernel capabilities.");
    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      operation: "changeSignature.reorderParameters",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };

    expect(
      availableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
    ).toContain("reorder-method-parameters");
    expect(
      applicableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
    ).toContain("reorder-method-parameters");
    expect(
      availableJavaRefactoringOperations({
        ...baseOptions,
        capabilities: advertised,
        dirtyPaths: ["sample/A.java"],
      }),
    ).not.toContain("reorder-method-parameters");

    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      operation: "changeSignature.reorderParameters",
      stability: "experimental",
      evidence: "compiler",
      mutationAuthority: "proposal-only",
    };
    expect(
      availableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
    ).toContain("reorder-method-parameters");
    expect(
      applicableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
    ).not.toContain("reorder-method-parameters");
  });

  it("offers parameter rename from a clean cursor only with the synchronized mutation-selection capability", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["changeSignature.renameParameter"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const adapter = advertised.languageKernel!.schema!.adapters[0]!;
    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      operation: "changeSignature.renameParameter",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };
    const cursor = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(cursor)).toContain("change-method-signature");
    expect(applicableJavaRefactoringOperations(cursor)).toContain("change-method-signature");
    expect(availableJavaRefactoringOperations({ ...cursor, editorSelection: false })).not.toContain(
      "change-method-signature",
    );
    expect(
      availableJavaRefactoringOperations({ ...cursor, dirtyPaths: ["sample/A.java"] }),
    ).not.toContain("change-method-signature");

    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-editor-mutation-selection-v1";
    expect(availableJavaRefactoringOperations(cursor)).not.toContain("change-method-signature");

    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      stability: "experimental",
      mutationAuthority: "proposal-only",
    };
    expect(availableJavaRefactoringOperations(cursor)).toContain("change-method-signature");
    expect(applicableJavaRefactoringOperations(cursor)).not.toContain("change-method-signature");
  });

  it("requires saved cursor selection authority when reordering from the editor cursor", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["changeSignature.reorderParameters"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const adapter = advertised.languageKernel!.schema!.adapters[0]!;
    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      operation: "changeSignature.reorderParameters",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };
    const cursor = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(cursor)).toContain("reorder-method-parameters");
    expect(applicableJavaRefactoringOperations(cursor)).toContain("reorder-method-parameters");
    expect(availableJavaRefactoringOperations({ ...cursor, editorSelection: false })).toContain(
      "reorder-method-parameters",
    );
    expect(
      availableJavaRefactoringOperations({ ...cursor, dirtyPaths: ["sample/A.java"] }),
    ).not.toContain("reorder-method-parameters");

    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-editor-mutation-selection-v1";
    expect(availableJavaRefactoringOperations(cursor)).not.toContain("reorder-method-parameters");
  });

  it("offers Make Static only for a clean cursor selection with managed provider authority", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["makeStatic"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const adapter = advertised.languageKernel!.schema!.adapters[0]!;
    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      operation: "makeStatic",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };
    const cursor = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(cursor)).toContain("make-static");
    expect(applicableJavaRefactoringOperations(cursor)).toContain("make-static");
    expect(
      availableJavaRefactoringOperations({ ...cursor, dirtyPaths: ["sample/A.java"] }),
    ).not.toContain("make-static");
    expect(availableJavaRefactoringOperations({ ...cursor, editorSelection: false })).not.toContain(
      "make-static",
    );

    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      stability: "experimental",
      mutationAuthority: "proposal-only",
    };
    expect(availableJavaRefactoringOperations(cursor)).toContain("make-static");
    expect(applicableJavaRefactoringOperations(cursor)).not.toContain("make-static");
  });

  it("offers Make Public only for a clean cursor selection with managed provider authority", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["changeVisibility"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const adapter = advertised.languageKernel!.schema!.adapters[0]!;
    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      operation: "changeVisibility",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };
    const cursor = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(cursor)).toContain("make-public");
    expect(applicableJavaRefactoringOperations(cursor)).toContain("make-public");
    expect(
      availableJavaRefactoringOperations({ ...cursor, dirtyPaths: ["sample/A.java"] }),
    ).not.toContain("make-public");
    expect(availableJavaRefactoringOperations({ ...cursor, editorSelection: false })).not.toContain(
      "make-public",
    );

    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      stability: "experimental",
      mutationAuthority: "proposal-only",
    };
    expect(availableJavaRefactoringOperations(cursor)).toContain("make-public");
    expect(applicableJavaRefactoringOperations(cursor)).not.toContain("make-public");
  });

  it.each([
    ["inline-method", "inlineMethod"],
    ["introduce-parameter-object", "introduceParameterObject"],
    ["extract-delegate", "extractDelegate"],
  ] as const)("offers %s only through the clean saved-cursor route with managed authority", (operation, providerName) => {
    const advertised = capabilities();
    expect(availableJavaRefactoringOperations({
      ...baseOptions, capabilities: advertised, editorSelection: true,
    })).not.toContain(operation);
    advertised.javaContextRefactoring!.operations = [providerName];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const adapter = advertised.languageKernel!.schema!.adapters[0]!;
    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      operation: providerName,
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };
    const cursor = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(cursor)).toContain(operation);
    expect(applicableJavaRefactoringOperations(cursor)).toContain(operation);
    expect(availableJavaRefactoringOperations({ ...cursor, editorSelection: false })).not.toContain(
      operation,
    );
    expect(
      availableJavaRefactoringOperations({ ...cursor, dirtyPaths: ["sample/A.java"] }),
    ).not.toContain(operation);

    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-editor-mutation-selection-v1";
    expect(availableJavaRefactoringOperations(cursor)).not.toContain(operation);

    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      stability: "experimental",
      mutationAuthority: "proposal-only",
    };
    expect(availableJavaRefactoringOperations(cursor)).toContain(operation);
    expect(applicableJavaRefactoringOperations(cursor)).not.toContain(operation);

    advertised.generalRefactoring!.operations = [operation];
    expect(
      availableJavaRefactoringOperations({
        ...cursor,
        sdkSelected: false,
        projectContextAvailable: false,
      }),
    ).not.toContain(operation);
  });

  it("offers parameter type changes only from a clean saved cursor with managed authority", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["changeSignature.changeParameterType"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const adapter = advertised.languageKernel!.schema!.adapters[0]!;
    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      operation: "changeSignature.changeParameterType",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };
    const cursor = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(cursor)).toContain("change-method-parameter-type");
    expect(applicableJavaRefactoringOperations(cursor)).toContain("change-method-parameter-type");
    expect(availableJavaRefactoringOperations({ ...cursor, editorSelection: false })).not.toContain(
      "change-method-parameter-type",
    );
    expect(
      availableJavaRefactoringOperations({ ...cursor, dirtyPaths: ["sample/A.java"] }),
    ).not.toContain("change-method-parameter-type");

    adapter.capabilities[0] = {
      ...adapter.capabilities[0]!,
      stability: "experimental",
      mutationAuthority: "proposal-only",
    };
    expect(availableJavaRefactoringOperations(cursor)).toContain("change-method-parameter-type");
    expect(applicableJavaRefactoringOperations(cursor)).not.toContain(
      "change-method-parameter-type",
    );
  });

  it("hides package moves when the provider withdraws the project-context operation", () => {
    const withdrawn = capabilities();
    withdrawn.javaContextRefactoring!.operations = [];

    expect(
      availableJavaRefactoringOperations({ ...baseOptions, capabilities: withdrawn }),
    ).not.toContain("move-package");
  });

  it.each([
    ["extract-constant", "extractConstant"],
    ["extract-variable", "extractVariable"],
    ["extract-method", "extractMethod"],
    ["extract-parameter", "extractParameter"],
    ["extract-field", "extractField"],
  ] as const)(
    "offers %s through the saved-source route for an editor selection",
    (operation, providerOperation) => {
      const advertised = capabilities();
      const selection = { ...baseOptions, capabilities: advertised, editorSelection: true };
      expect(availableJavaRefactoringOperations(selection)).not.toContain(operation);

      advertised.generalRefactoring!.operations = [operation];
      advertised.javaContextRefactoring!.operations = [providerOperation];
      const provider = advertised.languageKernel!.schema!.adapters[0].capabilities[0]!;
      provider.operation = providerOperation;
      provider.stability = "stable";
      provider.evidence = "compiler";
      provider.mutationAuthority = "managed-stable";

      expect(availableJavaRefactoringOperations(selection)).toContain(operation);
      expect(applicableJavaRefactoringOperations(selection)).toContain(operation);
      expect(
        availableJavaRefactoringOperations({ ...selection, editorSelection: false }),
      ).not.toContain(operation);
      expect(
        availableJavaRefactoringOperations({ ...selection, sdkSelected: false }),
      ).not.toContain(operation);
      expect(
        availableJavaRefactoringOperations({ ...selection, projectContextAvailable: false }),
      ).not.toContain(operation);
      expect(
        availableJavaRefactoringOperations({
          ...selection,
          dirtyPaths: ["sample/src/main/java/Example.java"],
        }),
      ).not.toContain(operation);

      provider.mutationAuthority = "proposal-only";
      expect(availableJavaRefactoringOperations(selection)).toContain(operation);
      expect(applicableJavaRefactoringOperations(selection)).not.toContain(operation);
    },
  );

  it("offers Extract Interface only for an exact saved Java class selection", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["extractInterface"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const provider = advertised.languageKernel!.schema!.adapters[0].capabilities[0]!;
    provider.operation = "extractInterface";
    provider.stability = "stable";
    provider.evidence = "compiler";
    provider.mutationAuthority = "managed-stable";
    const selection = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(selection)).toContain("extract-interface");
    expect(applicableJavaRefactoringOperations(selection)).toContain("extract-interface");
    expect(
      availableJavaRefactoringOperations({ ...selection, editorSelection: false }),
    ).not.toContain("extract-interface");
    expect(
      availableJavaRefactoringOperations({
        ...selection,
        dirtyPaths: ["sample/src/main/java/Example.java"],
      }),
    ).not.toContain("extract-interface");

    provider.mutationAuthority = "proposal-only";
    expect(availableJavaRefactoringOperations(selection)).toContain("extract-interface");
    expect(applicableJavaRefactoringOperations(selection)).not.toContain("extract-interface");
  });

  it("offers Extract Superclass only for an exact saved Java class selection", () => {
    const advertised = capabilities();
    advertised.javaContextRefactoring!.operations = ["extractSuperclass"];
    advertised.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    advertised.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    advertised.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const provider = advertised.languageKernel!.schema!.adapters[0].capabilities[0]!;
    provider.operation = "extractSuperclass";
    provider.stability = "stable";
    provider.evidence = "compiler";
    provider.mutationAuthority = "managed-stable";
    const selection = { ...baseOptions, capabilities: advertised, editorSelection: true };

    expect(availableJavaRefactoringOperations(selection)).toContain("extract-superclass");
    expect(applicableJavaRefactoringOperations(selection)).toContain("extract-superclass");
    expect(
      availableJavaRefactoringOperations({ ...selection, editorSelection: false }),
    ).not.toContain("extract-superclass");
    expect(
      availableJavaRefactoringOperations({
        ...selection,
        dirtyPaths: ["sample/src/main/java/Example.java"],
      }),
    ).not.toContain("extract-superclass");

    provider.mutationAuthority = "proposal-only";
    expect(availableJavaRefactoringOperations(selection)).toContain("extract-superclass");
    expect(applicableJavaRefactoringOperations(selection)).not.toContain("extract-superclass");
  });

  it.each([
    ["encapsulate-field", "encapsulateField"],
  ] as const)(
    "offers %s only when the provider advertises its bounded cell",
    (operation, provider) => {
      const advertised = capabilities();
      expect(
        availableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
      ).not.toContain(operation);
      advertised.javaContextRefactoring!.operations = [provider];
      advertised.languageKernel!.schema!.adapters[0].capabilities[0].operation = provider;

      expect(
        availableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
      ).toContain(operation);
      expect(
        applicableJavaRefactoringOperations({ ...baseOptions, capabilities: advertised }),
      ).toContain(operation);
      expect(
        availableJavaRefactoringOperations({
          ...baseOptions,
          capabilities: advertised,
          sdkSelected: false,
          projectContextAvailable: false,
        }),
      ).not.toContain(operation);
      expect(
        availableJavaRefactoringOperations({
          ...baseOptions,
          capabilities: advertised,
          dirtyPaths: ["sample/src/main/java/Example.java"],
        }),
      ).not.toContain(operation);
    },
  );
});
