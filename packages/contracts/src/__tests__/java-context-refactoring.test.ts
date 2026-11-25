import { describe, expect, it } from "vitest";
import type { RefactorKitCapabilities } from "../refactorkit";
import { validateRefactorChangeIntent } from "../refactorkit";
import {
  javaContextRefactoringOffered,
  javaContextRefactoringOperation,
  javaMoveClassTargetModuleSelectionOffered,
  javaRefactoringMutationAuthorized,
  javaSafeDeleteReferenceAnalysisQualified,
} from "../java-context-refactoring";

const sourceRootCapabilities = {
  api: "refactorkit",
  apiVersion: "0.2",
  provider: "refactorkit",
  providerVersion: "0.7.0",
  javaImportExternalClass: {
    supported: false,
    targetDirectory: false,
    preview: false,
    apply: false,
    rollback: false,
    stability: "experimental",
  },
  javaContextRefactoring: {
    schemaVersion: 1,
    operations: ["moveSourceRoot"],
    requiresExplicitContext: true,
    sourceAuthority: "saved-snapshot",
    rollbackAuthority: true,
    renderedDiff: true,
  },
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
            supportsTimeout: true,
            supportsCancellation: true,
            usesWorkspaceOverlay: true,
            recordsProcessProvenance: true,
            limits: {
              requestTimeoutMillis: 30000,
              maxInputBytes: 1048576,
              maxOutputBytes: 1048576,
              maxProcesses: 1,
            },
          },
          capabilities: [
            {
              operation: "moveSourceRoot",
              stability: "stable",
              evidence: "structural-parse",
              mutationAuthority: "managed-stable",
              backend: "java-test-backend",
              runtime: {
                executionMode: "in-process",
                supportsTimeout: true,
                supportsCancellation: true,
                usesWorkspaceOverlay: true,
                recordsProcessProvenance: true,
                limits: {
                  requestTimeoutMillis: 30000,
                  maxInputBytes: 1048576,
                  maxOutputBytes: 1048576,
                  maxProcesses: 1,
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
    {
      name: "refactor.apply",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: true,
    },
    {
      name: "patch.rollback",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: true,
    },
  ],
} as RefactorKitCapabilities;

describe("SDK-bound source-root refactoring", () => {
  it("requires the exact move-class destination-module attestation", () => {
    const capabilities = structuredClone(
      sourceRootCapabilities,
    ) as unknown as RefactorKitCapabilities;
    expect(javaMoveClassTargetModuleSelectionOffered(capabilities)).toBe(false);

    capabilities.javaContextRefactoring!.operationCapabilities = [
      {
        operation: "moveClass",
        targetModuleSelection: {
          schemaVersion: "java-move-class-target-module-v1",
          argument: "targetModuleId",
          identity: "module-id-within-source-provider",
          requiresAvailableContext: true,
          sourceSetKind: "main",
          requiresUniqueNonGeneratedRoot: true,
        },
      },
    ];
    expect(javaMoveClassTargetModuleSelectionOffered(capabilities)).toBe(true);

    const malformed = structuredClone(capabilities);
    Object.assign(
      malformed.javaContextRefactoring!.operationCapabilities![0]!.targetModuleSelection!,
      {
        argument: "targetPath",
      },
    );
    expect(javaMoveClassTargetModuleSelectionOffered(malformed)).toBe(false);
  });

  it("requires the stable daemon lifecycle for Maven module creation", () => {
    const capabilities = {
      api: "refactorkit",
      apiVersion: "0.2",
      provider: "refactorkit-daemon",
      providerVersion: "0.8.0",
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
        stability: "experimental",
      },
      methods: [
        {
          name: "project.context",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: false,
          features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
        },
        {
          name: "refactor.preview",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: false,
        },
        {
          name: "refactor.apply",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: true,
        },
        {
          name: "patch.rollback",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: true,
        },
        {
          name: "java.createMavenModule",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: false,
          features: { preview: true, renderedDiff: true, apply: true, rollback: true },
        },
      ],
    } as unknown as RefactorKitCapabilities;

    expect(javaContextRefactoringOperation("create-maven-module")).toBe("java.createMavenModule");
    expect(javaContextRefactoringOffered(capabilities, "create-maven-module", "preview")).toBe(
      true,
    );
    expect(javaContextRefactoringOffered(capabilities, "create-maven-module", "apply")).toBe(true);
    expect(javaContextRefactoringOffered(capabilities, "create-maven-module", "rollback")).toBe(
      true,
    );
    expect(javaRefactoringMutationAuthorized(capabilities, "create-maven-module")).toBe(true);

    const stale = structuredClone(capabilities);
    stale.methods!.find((method) => method.name === "java.createMavenModule")!.stability =
      "experimental";
    expect(javaContextRefactoringOffered(stale, "create-maven-module", "preview")).toBe(false);
    expect(javaRefactoringMutationAuthorized(stale, "create-maven-module")).toBe(false);
  });

  it("validates Add Module intent without recreating provider path semantics", () => {
    expect(
      validateRefactorChangeIntent("create-maven-module", {
        operation: "create-maven-module",
        moduleName: "catalog-domain",
      }),
    ).toBeUndefined();
    expect(
      validateRefactorChangeIntent("create-maven-module", {
        operation: "create-maven-module",
        moduleName: "../escape",
      }),
    ).toMatch(/without path separators/u);
  });

  it("offers Gradle module creation only for the stable nested-path contract", () => {
    const advertised = structuredClone(sourceRootCapabilities) as RefactorKitCapabilities;
    advertised.apiVersion = "0.2";
    advertised.methods = [
      ...(advertised.methods ?? []),
      {
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
      },
    ];

    expect(javaContextRefactoringOperation("create-gradle-module")).toBe("java.createGradleModule");
    expect(javaContextRefactoringOffered(advertised, "create-gradle-module", "preview")).toBe(true);
    expect(javaContextRefactoringOffered(advertised, "create-gradle-module", "apply")).toBe(true);
    expect(javaContextRefactoringOffered(advertised, "create-gradle-module", "rollback")).toBe(
      true,
    );
    expect(javaRefactoringMutationAuthorized(advertised, "create-gradle-module")).toBe(true);

    advertised.methods.at(-1)!.features!.settingsInferredDsl = false;
    expect(javaContextRefactoringOffered(advertised, "create-gradle-module", "preview")).toBe(
      false,
    );
    expect(javaRefactoringMutationAuthorized(advertised, "create-gradle-module")).toBe(false);
  });

  it("validates Gradle build roots and nested project paths", () => {
    const valid = {
      operation: "create-gradle-module" as const,
      buildRoot: "gradle/included-build",
      projectPath: ":services:catalog",
    };
    expect(validateRefactorChangeIntent("create-gradle-module", valid)).toBeUndefined();
    expect(
      validateRefactorChangeIntent("create-gradle-module", { ...valid, buildRoot: "../outside" }),
    ).toMatch(/workspace-relative buildRoot/u);
    expect(
      validateRefactorChangeIntent("create-gradle-module", { ...valid, buildRoot: "module:other" }),
    ).toMatch(/workspace-relative buildRoot/u);
    expect(
      validateRefactorChangeIntent("create-gradle-module", { ...valid, projectPath: ":foo:.." }),
    ).toMatch(/canonical nested projectPath/u);
    expect(
      validateRefactorChangeIntent("create-gradle-module", { ...valid, projectPath: "foo" }),
    ).toMatch(/canonical nested projectPath/u);
  });

  it("requires explicit bounded names for Extract Interface", () => {
    const valid = {
      operation: "extract-interface" as const,
      interfaceName: "CalculatorOperations",
      methodName: "calculate",
    };
    expect(validateRefactorChangeIntent("extract-interface", valid)).toBeUndefined();
    expect(
      validateRefactorChangeIntent("extract-interface", { ...valid, interfaceName: " " }),
    ).toMatch(/interfaceName and methodName/u);
    expect(
      validateRefactorChangeIntent("extract-interface", { ...valid, methodName: "\0" }),
    ).toMatch(/interfaceName and methodName/u);
  });

  it("requires explicit bounded names for Extract Superclass", () => {
    const valid = {
      operation: "extract-superclass" as const,
      superclassName: "CalculatorBase",
      methodName: "calculate",
    };
    expect(validateRefactorChangeIntent("extract-superclass", valid)).toBeUndefined();
    expect(
      validateRefactorChangeIntent("extract-superclass", { ...valid, superclassName: " " }),
    ).toMatch(/superclassName and methodName/u);
    expect(
      validateRefactorChangeIntent("extract-superclass", { ...valid, methodName: "\0" }),
    ).toMatch(/superclassName and methodName/u);
  });

  it("requires an explicit bounded target type for Pull Up Member", () => {
    const valid = { operation: "pull-up-member" as const, targetType: "fixture.Parent" };
    expect(validateRefactorChangeIntent("pull-up-member", valid)).toBeUndefined();
    expect(validateRefactorChangeIntent("pull-up-member", { ...valid, targetType: " " })).toMatch(
      /targetType/u,
    );
    expect(
      validateRefactorChangeIntent("pull-up-member", { ...valid, targetType: "x".repeat(4097) }),
    ).toMatch(/targetType/u);
  });

  it("requires an explicit bounded target type for Push Down Member", () => {
    const valid = { operation: "push-down-member" as const, targetType: "fixture.Child" };
    expect(validateRefactorChangeIntent("push-down-member", valid)).toBeUndefined();
    expect(validateRefactorChangeIntent("push-down-member", { ...valid, targetType: " " })).toMatch(
      /targetType/u,
    );
    expect(
      validateRefactorChangeIntent("push-down-member", { ...valid, targetType: "x".repeat(4097) }),
    ).toMatch(/targetType/u);
  });

  it("requires Move Member to carry a safe selected destination location", () => {
    const valid = {
      operation: "move-member" as const,
      targetType: "fixture.Destination",
      targetPath: "src/main/java/fixture/Types.java",
      targetPosition: { line: 3, character: 6 },
    };
    expect(validateRefactorChangeIntent("move-member", valid)).toBeUndefined();
    expect(validateRefactorChangeIntent("move-member", { ...valid, targetPath: "../Types.java" })).toMatch(
      /destination source selection/u,
    );
    expect(
      validateRefactorChangeIntent("move-member", {
        ...valid,
        targetPosition: { line: -1, character: 0 },
      }),
    ).toMatch(/destination source selection/u);
    expect(
      validateRefactorChangeIntent("move-member", { ...valid, targetType: "fixture.\0Type" }),
    ).toMatch(/destination source selection/u);
  });

  it("maps the IDE operation to the provider operation", () => {
    expect(javaContextRefactoringOperation("move-source-root")).toBe("moveSourceRoot");
    expect(javaContextRefactoringOperation("move-package")).toBe("movePackage");
    expect(javaContextRefactoringOperation("extract-variable")).toBe("extractVariable");
    expect(javaContextRefactoringOperation("extract-parameter")).toBe("extractParameter");
    expect(javaContextRefactoringOperation("extract-field")).toBe("extractField");
    expect(javaContextRefactoringOperation("extract-interface")).toBe("extractInterface");
    expect(javaContextRefactoringOperation("extract-superclass")).toBe("extractSuperclass");
    expect(javaContextRefactoringOperation("pull-up-member")).toBe("pullUpMember");
    expect(javaContextRefactoringOperation("push-down-member")).toBe("pushDownMember");
    expect(javaContextRefactoringOperation("move-member")).toBe("moveMember");
    expect(javaContextRefactoringOperation("inline-variable")).toBe("inlineVariable");
    expect(javaContextRefactoringOperation("inline-method")).toBe("inlineMethod");
    expect(javaContextRefactoringOperation("inline-constant")).toBe("inlineConstant");
    expect(javaContextRefactoringOperation("encapsulate-field")).toBe("encapsulateField");
    expect(javaContextRefactoringOperation("reorder-method-parameters")).toBe(
      "changeSignature.reorderParameters",
    );
    expect(javaContextRefactoringOperation("remove-method-parameter")).toBe(
      "changeSignature.removeParameter",
    );
    expect(javaContextRefactoringOperation("make-static")).toBe("makeStatic");
    expect(javaContextRefactoringOperation("make-public")).toBe("changeVisibility");
    expect(javaContextRefactoringOperation("change-method-parameter-type")).toBe(
      "changeSignature.changeParameterType",
    );
    expect(javaContextRefactoringOperation("extract-method")).toBe("extractMethod");
  });

  it("offers Extract Method only through its advertised saved-source project context", () => {
    const advertised = structuredClone(sourceRootCapabilities);
    advertised.javaContextRefactoring!.operations = ["extractMethod"];
    const languageKernel = advertised.languageKernel;
    if (!languageKernel?.available) throw new Error("Expected language-kernel capabilities.");
    languageKernel.schema.adapters[0]!.capabilities[0] = {
      ...languageKernel.schema.adapters[0]!.capabilities[0]!,
      operation: "extractMethod",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };

    expect(javaContextRefactoringOffered(advertised, "extract-method", "preview")).toBe(true);
    expect(javaContextRefactoringOffered(advertised, "extract-method", "apply")).toBe(true);

    languageKernel.schema.adapters[0]!.capabilities[0]!.mutationAuthority = "proposal-only";
    expect(javaContextRefactoringOffered(advertised, "extract-method", "preview")).toBe(true);
    expect(javaContextRefactoringOffered(advertised, "extract-method", "apply")).toBe(false);

    advertised.javaContextRefactoring!.operations = [];
    expect(javaContextRefactoringOffered(advertised, "extract-method", "preview")).toBe(false);
  });

  it("offers parameter type changes only with stable managed authority", () => {
    const advertised = structuredClone(sourceRootCapabilities);
    advertised.javaContextRefactoring!.operations = ["changeSignature.changeParameterType"];
    const languageKernel = advertised.languageKernel;
    if (!languageKernel?.available) throw new Error("Expected language-kernel capabilities.");
    languageKernel.schema.adapters[0]!.capabilities[0] = {
      ...languageKernel.schema.adapters[0]!.capabilities[0]!,
      operation: "changeSignature.changeParameterType",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };

    expect(
      javaContextRefactoringOffered(advertised, "change-method-parameter-type", "preview"),
    ).toBe(true);
    expect(javaContextRefactoringOffered(advertised, "change-method-parameter-type", "apply")).toBe(
      true,
    );

    languageKernel.schema.adapters[0]!.capabilities[0]!.mutationAuthority = "proposal-only";
    expect(
      javaContextRefactoringOffered(advertised, "change-method-parameter-type", "preview"),
    ).toBe(true);
    expect(javaContextRefactoringOffered(advertised, "change-method-parameter-type", "apply")).toBe(
      false,
    );
  });

  it("offers parameter reordering only with exact managed provider authority", () => {
    const advertised = structuredClone(sourceRootCapabilities);
    advertised.javaContextRefactoring!.operations = ["changeSignature.reorderParameters"];
    const languageKernel = advertised.languageKernel;
    if (!languageKernel?.available) throw new Error("Expected language-kernel capabilities.");
    languageKernel.schema.adapters[0]!.capabilities[0] = {
      ...languageKernel.schema.adapters[0]!.capabilities[0]!,
      operation: "changeSignature.reorderParameters",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };

    expect(javaContextRefactoringOffered(advertised, "reorder-method-parameters", "preview")).toBe(
      true,
    );
    expect(javaContextRefactoringOffered(advertised, "reorder-method-parameters", "apply")).toBe(
      true,
    );

    languageKernel.schema.adapters[0]!.capabilities[0]!.stability = "experimental";
    languageKernel.schema.adapters[0]!.capabilities[0]!.mutationAuthority = "proposal-only";
    expect(javaContextRefactoringOffered(advertised, "reorder-method-parameters", "preview")).toBe(
      true,
    );
    expect(javaContextRefactoringOffered(advertised, "reorder-method-parameters", "apply")).toBe(
      false,
    );
  });

  it("offers Remove Parameter only with its own managed provider authority", () => {
    const advertised = structuredClone(sourceRootCapabilities);
    advertised.javaContextRefactoring!.operations = ["changeSignature.removeParameter"];
    const languageKernel = advertised.languageKernel;
    if (!languageKernel?.available) throw new Error("Expected language-kernel capabilities.");
    languageKernel.schema.adapters[0]!.capabilities[0] = {
      ...languageKernel.schema.adapters[0]!.capabilities[0]!,
      operation: "changeSignature.removeParameter",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };

    expect(javaContextRefactoringOffered(advertised, "remove-method-parameter", "preview")).toBe(
      true,
    );
    expect(javaContextRefactoringOffered(advertised, "remove-method-parameter", "apply")).toBe(
      true,
    );

    languageKernel.schema.adapters[0]!.capabilities[0]!.mutationAuthority = "proposal-only";
    expect(javaContextRefactoringOffered(advertised, "remove-method-parameter", "preview")).toBe(
      true,
    );
    expect(javaContextRefactoringOffered(advertised, "remove-method-parameter", "apply")).toBe(
      false,
    );
  });

  it("offers package migration only when the Java project-context provider advertises it", () => {
    const packageCapabilities = structuredClone(sourceRootCapabilities);
    packageCapabilities.javaContextRefactoring!.operations = ["movePackage"];
    const languageKernel = packageCapabilities.languageKernel;
    if (!languageKernel?.available) throw new Error("Expected language-kernel capabilities.");
    const operationCapability = languageKernel.schema.adapters[0]?.capabilities[0];
    if (!operationCapability) throw new Error("Expected a language-kernel operation.");
    operationCapability.operation = "movePackage";

    expect(javaContextRefactoringOffered(packageCapabilities, "move-package", "preview")).toBe(
      true,
    );
    expect(javaContextRefactoringOffered(packageCapabilities, "move-package", "apply")).toBe(true);
    expect(javaContextRefactoringOffered(packageCapabilities, "move-package", "rollback")).toBe(
      true,
    );

    packageCapabilities.javaContextRefactoring!.operations = [];
    expect(javaContextRefactoringOffered(packageCapabilities, "move-package", "preview")).toBe(
      false,
    );
  });

  it("offers preview, apply and rollback only when the SDK route advertises them", () => {
    expect(
      javaContextRefactoringOffered(sourceRootCapabilities, "move-source-root", "preview"),
    ).toBe(true);
    expect(javaContextRefactoringOffered(sourceRootCapabilities, "move-source-root", "apply")).toBe(
      true,
    );
    expect(
      javaContextRefactoringOffered(sourceRootCapabilities, "move-source-root", "rollback"),
    ).toBe(true);
    const unavailable = structuredClone(sourceRootCapabilities);
    unavailable.javaContextRefactoring!.operations = [];
    expect(javaContextRefactoringOffered(unavailable, "move-source-root", "preview")).toBe(false);
  });

  it("keeps proposal-only operations reviewable without offering Apply or rollback", () => {
    const proposalOnly = structuredClone(sourceRootCapabilities);
    if (!proposalOnly.languageKernel?.available) throw new Error("Missing Java kernel fixture");
    proposalOnly.languageKernel.schema.adapters[0].capabilities[0].stability = "experimental";
    proposalOnly.languageKernel.schema.adapters[0].capabilities[0].mutationAuthority =
      "proposal-only";
    expect(javaContextRefactoringOffered(proposalOnly, "move-source-root", "preview")).toBe(true);
    expect(javaContextRefactoringOffered(proposalOnly, "move-source-root", "apply")).toBe(false);
    expect(javaContextRefactoringOffered(proposalOnly, "move-source-root", "rollback")).toBe(false);

    const lexical = structuredClone(sourceRootCapabilities);
    if (!lexical.languageKernel?.available) throw new Error("Missing Java kernel fixture");
    lexical.languageKernel.schema.adapters[0].capabilities[0].evidence = "lexical";
    expect(javaContextRefactoringOffered(lexical, "move-source-root", "preview")).toBe(true);
    expect(javaContextRefactoringOffered(lexical, "move-source-root", "apply")).toBe(false);
  });

  it("requires authority for the exact operation before mutation", () => {
    const capabilities = structuredClone(sourceRootCapabilities);
    if (!capabilities.languageKernel?.available) throw new Error("Missing Java kernel fixture");
    capabilities.languageKernel.schema.adapters[0].capabilities.push(
      {
        ...capabilities.languageKernel.schema.adapters[0].capabilities[0],
        operation: "renameClass",
      },
      {
        ...capabilities.languageKernel.schema.adapters[0].capabilities[0],
        operation: "changeSignature.renameParameter",
        stability: "experimental",
        mutationAuthority: "proposal-only",
      },
    );
    expect(javaRefactoringMutationAuthorized(capabilities, "rename-class")).toBe(true);
    expect(javaRefactoringMutationAuthorized(capabilities, "change-method-signature")).toBe(false);
    expect(javaRefactoringMutationAuthorized(capabilities, "rename-local-variable")).toBe(false);

    const missing = structuredClone(capabilities);
    if (!missing.languageKernel?.available) throw new Error("Missing Java kernel fixture");
    missing.languageKernel.schema.adapters[0].capabilities = [];
    expect(javaRefactoringMutationAuthorized(missing, "rename-class")).toBe(false);
  });

  it("keeps safe delete previewable but blocks Apply without complete project reference analysis", () => {
    const safeDelete: RefactorKitCapabilities = structuredClone(sourceRootCapabilities);
    safeDelete.javaContextRefactoring!.operations = ["safeDelete"];
    if (!safeDelete.languageKernel?.available) throw new Error("Missing Java kernel fixture");
    safeDelete.languageKernel.schema.adapters[0]!.capabilities[0] = {
      ...safeDelete.languageKernel.schema.adapters[0]!.capabilities[0]!,
      operation: "safeDelete",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    };

    expect(javaContextRefactoringOffered(safeDelete, "safe-delete", "preview")).toBe(true);
    expect(javaContextRefactoringOffered(safeDelete, "safe-delete", "apply")).toBe(false);
    expect(javaRefactoringMutationAuthorized(safeDelete, "safe-delete")).toBe(false);
    expect(javaSafeDeleteReferenceAnalysisQualified(safeDelete)).toBe(false);

    safeDelete.safeDeleteReferenceAnalysis = "complete-project";
    expect(javaContextRefactoringOffered(safeDelete, "safe-delete", "apply")).toBe(true);
    expect(javaRefactoringMutationAuthorized(safeDelete, "safe-delete")).toBe(true);
    expect(javaSafeDeleteReferenceAnalysisQualified(safeDelete)).toBe(true);

    safeDelete.javaContextRefactoring!.operationCapabilities = [
      {
        operation: "safeDelete",
        referenceAnalysis: {
          schemaVersion: "java-safe-delete-reference-analysis-v1",
          scope: "workspace-text-v1",
          resultField: "referenceAnalysis",
          statusValues: ["complete", "incomplete"],
          managedApplyAuthority: "none",
          completeProject: false,
        },
      },
    ];
    expect(javaSafeDeleteReferenceAnalysisQualified(safeDelete)).toBe(false);
    expect(javaContextRefactoringOffered(safeDelete, "safe-delete", "apply")).toBe(false);

    delete safeDelete.javaContextRefactoring!.operationCapabilities;
    expect(javaContextRefactoringOffered(safeDelete, "safe-delete", "apply")).toBe(true);
  });

  it("accepts engine-managed mutation authority without granting project-context Apply", () => {
    const capabilities = {
      ...sourceRootCapabilities,
      managedJavaMutationOperations: ["format-file"],
      javaContextRefactoring: {
        ...sourceRootCapabilities.javaContextRefactoring,
        operations: ["formatFile"],
      },
      methods: [
        {
          name: "project.context",
          requiresProject: true,
          writesWorkspace: false,
          features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
        },
        { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
        { name: "refactor.apply", requiresProject: true, writesWorkspace: true },
      ],
    } as unknown as RefactorKitCapabilities;

    expect(javaRefactoringMutationAuthorized(capabilities, "format-file")).toBe(true);
    expect(javaContextRefactoringOffered(capabilities, "format-file", "preview")).toBe(true);
    expect(javaContextRefactoringOffered(capabilities, "format-file", "apply")).toBe(false);
  });
});
