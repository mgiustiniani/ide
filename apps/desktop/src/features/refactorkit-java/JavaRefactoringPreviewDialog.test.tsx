import "@testing-library/jest-dom/vitest";
import type {
  JavaEffectiveProjectContext,
  JavaWorkspaceSymbolsResponse,
  RefactorKitCapabilities,
  RefactorKitChangeIntent,
  RefactorPreviewResult,
  RefactoringOperation,
} from "@ide/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { JavaRefactoringPreviewDialog } from "./JavaRefactoringPreviewDialog";
import type { JavaRefactoringDialogState } from "./useJavaRefactoringController";
import {
  JAVA_REFACTORING_OPERATIONS,
  javaRefactoringTargetKind,
} from "./javaRefactoringAvailability";

function state(operation: RefactoringOperation): JavaRefactoringDialogState {
  const path = "A.java";
  const targetKind = javaRefactoringTargetKind(operation);
  const targetPath = targetKind === "source-root" ? "app/src/main/java" : path;
  return {
    status: "idle",
    operation,
    target: {
      kind: targetKind,
      path: targetPath,
      identity:
        targetKind === "file" || targetKind === "source-root"
          ? targetPath
          : targetKind === "package"
            ? "example"
            : "example.A",
    },
    selection: null,
    plan: null,
    result: null,
    rollback: null,
  };
}

function moveClassContext(): JavaEffectiveProjectContext {
  const sourceSet = (root: string) => ({
    id: "main",
    kind: "main" as const,
    sourceLevel: 17,
    release: 17,
    sourceRoots: [root],
    generatedSourceRoots: [],
    outputDirectories: [],
    analysisSourceRoots: [],
    compileClasspath: [],
    runtimeClasspath: [],
    moduleDependencies: [],
  });
  return {
    schemaVersion: "java-project-context-v5",
    status: "available",
    snapshotHash: "a".repeat(64),
    contextHash: "b".repeat(64),
    sdk: [],
    providers: [
      {
        providerId: "maven-effective-v1",
        status: "available",
        strategy: "effective-model",
        buildCodeExecution: "denied",
        credentialsAccess: "denied",
        networkAccess: "denied",
        diagnostics: [],
      },
    ],
    modules: [
      {
        providerId: "maven-effective-v1",
        id: "app",
        name: "app",
        root: "app",
        sourceSets: [sourceSet("app/src/main/java")],
      },
      {
        providerId: "maven-effective-v1",
        id: "library",
        name: "library",
        root: "library",
        sourceSets: [sourceSet("library/src/main/java")],
      },
    ],
    buildEvidence: [],
    selectedSource: null,
    analysis: null,
    refusal: null,
  };
}

function targetModuleSelectionCapabilities(): RefactorKitCapabilities {
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
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["moveClass"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      operationCapabilities: [
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
      ],
    },
  };
}

function readyPlan(): RefactorPreviewResult {
  return {
    planId: "plan-apply-gate",
    operation: "rename-class",
    target: state("rename-class").target,
    status: "ready",
    summary: "Rename A to B",
    confidence: 1,
    riskLevel: "low",
    risks: [],
    evidence: [],
    affectedFiles: [{ change: "edit", path: "A.java", primary: true }],
    renderedDiff: "--- a/A.java\n+++ b/A.java",
    structuredDiff: [],
    warnings: [],
    diagnosticsAfterPreview: [],
    conflicts: [],
    refusalReasons: [],
    applyEligibility: { eligible: true, blockers: [] },
    staleness: { stale: false, reasons: [] },
    grantsApplyAuthority: false,
    authority: { workspaceId: "workspace", workspaceGeneration: 1 },
    selectionGeneration: 1,
    requestId: "request-apply-gate",
    provider: "RefactorKit",
    providerVersion: "0.7.0",
  };
}

function Form({
  operation,
  observe,
  capabilities,
  projectContext,
  projectPath,
  searchJavaTypes,
  targetIdentity,
}: {
  operation: RefactoringOperation;
  observe: (intent: RefactorKitChangeIntent | undefined) => void;
  capabilities?: RefactorKitCapabilities;
  projectContext?: JavaEffectiveProjectContext;
  projectPath?: string;
  searchJavaTypes?: (query: string, signal?: AbortSignal) => Promise<JavaWorkspaceSymbolsResponse>;
  targetIdentity?: string;
}) {
  const initial = state(operation);
  if (targetIdentity !== undefined) initial.target.identity = targetIdentity;
  if (operation === "move-class" && projectContext)
    initial.target.path = "/workspace/project/app/src/main/java/example/A.java";
  const [dialog, setDialog] = useState<JavaRefactoringDialogState>({
    ...initial,
    changeIntent:
      operation === "move-package"
        ? { operation, fromPackage: initial.target.identity, toPackage: "" }
        : undefined,
  });
  return (
    <JavaRefactoringPreviewDialog
      dialog={dialog}
      capabilities={capabilities}
      projectContext={projectContext}
      projectPath={projectPath}
      searchJavaTypes={searchJavaTypes}
      availableOperations={JAVA_REFACTORING_OPERATIONS}
      applicableOperations={[]}
      applyAuthorityAvailable={false}
      rollbackAdvertised={false}
      onSetOperation={(next) => setDialog({ ...dialog, operation: next, changeIntent: undefined })}
      onSetTarget={(target) => setDialog({ ...dialog, target })}
      onSetChangeIntent={(intent) => {
        observe(intent);
        setDialog({ ...dialog, changeIntent: intent });
      }}
      onPreview={vi.fn()}
      onApply={vi.fn()}
      onRollback={vi.fn()}
      onDiscard={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

describe("Java refactoring change form", () => {
  it("locks the parameter rename target to the selected Java cursor", () => {
    render(<Form operation="change-method-signature" targetIdentity="@cursor" observe={vi.fn()} />);

    expect(screen.getByLabelText("Element identity")).toHaveValue("@cursor");
    expect(screen.getByLabelText("Element identity")).toBeDisabled();
    expect(screen.getByLabelText("Element identity")).toHaveAttribute(
      "placeholder",
      "Selected from the Java cursor",
    );
  });

  it("locks the provider selection identity for cursor-based Extract Interface", () => {
    render(<Form operation="extract-interface" targetIdentity="@cursor" observe={vi.fn()} />);

    expect(screen.getByLabelText("Element identity")).toHaveValue("@cursor");
    expect(screen.getByLabelText("Element identity")).toBeDisabled();
    expect(screen.getByLabelText("Element identity")).toHaveAttribute(
      "placeholder",
      "Selected from the Java cursor",
    );
  });

  it("locks the provider selection identity for cursor-based Extract Superclass", () => {
    render(<Form operation="extract-superclass" targetIdentity="@cursor" observe={vi.fn()} />);

    expect(screen.getByLabelText("Element identity")).toHaveValue("@cursor");
    expect(screen.getByLabelText("Element identity")).toBeDisabled();
    expect(screen.getByLabelText("Element identity")).toHaveAttribute(
      "placeholder",
      "Selected from the Java cursor",
    );
  });

  it("collects the explicit target type and explains the bounded Pull Up Method slice", () => {
    const observe = vi.fn();
    render(<Form operation="pull-up-member" targetIdentity="@cursor" observe={observe} />);

    expect(screen.getByLabelText("Element identity")).toBeDisabled();
    expect(
      screen.getByText(/This high-risk provider slice accepts a final, no-argument int method/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Inspect warnings for reflective or external consumers before Apply/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Target supertype (fully qualified name)"), {
      target: { value: "fixture.Parent" },
    });
    expect(observe).toHaveBeenLastCalledWith({
      operation: "pull-up-member",
      targetType: "fixture.Parent",
    });
  });

  it("collects the explicit target subtype and explains the bounded Push Down Method slice", () => {
    const observe = vi.fn();
    render(<Form operation="push-down-member" targetIdentity="@cursor" observe={observe} />);

    expect(screen.getByLabelText("Element identity")).toBeDisabled();
    expect(
      screen.getByText(
        /This high-risk provider slice accepts one protected final int literal method/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Inspect warnings for reflective or external consumers before Apply/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Target subtype (fully qualified name)"), {
      target: { value: "fixture.Child" },
    });
    expect(observe).toHaveBeenLastCalledWith({
      operation: "push-down-member",
      targetType: "fixture.Child",
    });
  });

  it("selects a same-file Move Member destination using JDT locations", async () => {
    const observe = vi.fn();
    const searchJavaTypes = vi.fn().mockResolvedValue({
      ok: true,
      requestId: "workspace-symbol-query",
      result: {
        workspaceId: "workspace",
        generation: 1,
        symbols: [
          {
            name: "Destination",
            kind: "class",
            path: "A.java",
            range: {
              start: { line: 3, character: 6 },
              end: { line: 7, character: 1 },
            },
            containerName: "fixture",
          },
          {
            name: "OtherFile",
            kind: "class",
            path: "OtherFile.java",
            range: {
              start: { line: 0, character: 6 },
              end: { line: 3, character: 1 },
            },
            containerName: "fixture",
          },
        ],
        isTruncated: false,
      },
    } as unknown as JavaWorkspaceSymbolsResponse);
    render(
      <Form
        operation="move-member"
        targetIdentity="@cursor"
        observe={observe}
        searchJavaTypes={searchJavaTypes}
      />,
    );

    expect(
      screen.getByText(/This high-risk provider slice moves one package-private static/),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText("Search destination Java type in the current source file"),
      {
        target: { value: "Dest" },
      },
    );
    const target = await screen.findByRole("button", {
      name: "fixture.Destination · A.java:4",
    });
    fireEvent.click(target);

    expect(searchJavaTypes).toHaveBeenCalledWith("Dest", expect.any(AbortSignal));
    expect(observe).toHaveBeenLastCalledWith({
      operation: "move-member",
      targetType: "fixture.Destination",
      targetPath: "A.java",
      targetPosition: { line: 3, character: 6 },
    });
    expect(screen.queryByText(/OtherFile/u)).not.toBeInTheDocument();
  });

  it("keeps the selected Gradle build root and edits a nested canonical project path", () => {
    const dialog: JavaRefactoringDialogState = {
      ...state("create-gradle-module"),
      target: {
        kind: "file",
        path: "included/settings.gradle.kts",
        identity: "included/settings.gradle.kts",
      },
      changeIntent: {
        operation: "create-gradle-module",
        buildRoot: "included",
        projectPath: ":new-module",
      },
    };
    const onSetChangeIntent = vi.fn();
    render(
      <JavaRefactoringPreviewDialog
        dialog={dialog}
        availableOperations={["create-gradle-module"]}
        applicableOperations={["create-gradle-module"]}
        applyAuthorityAvailable
        rollbackAdvertised
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={onSetChangeIntent}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Add Gradle Module" })).toBeInTheDocument();
    expect(screen.getByLabelText("Gradle settings")).toHaveValue("included/settings.gradle.kts");
    expect(screen.getByLabelText("Gradle project path")).toHaveValue(":new-module");
    fireEvent.change(screen.getByLabelText("Gradle project path"), {
      target: { value: ":services:catalog" },
    });
    expect(onSetChangeIntent).toHaveBeenCalledWith({
      operation: "create-gradle-module",
      buildRoot: "included",
      projectPath: ":services:catalog",
    });
  });

  it("describes the tested Encapsulate Field shapes without implying int-only support", () => {
    render(<Form operation="encapsulate-field" observe={vi.fn()} />);

    expect(
      screen.getByText(
        /tested support for public final instance fields of type int, String, List<String>, and int\[\]/,
      ),
    ).toBeInTheDocument();
  });

  it("disables an unadvertised operation and prevents an unavailable preview", () => {
    const dialog = state("move-class");
    render(
      <JavaRefactoringPreviewDialog
        dialog={dialog}
        availableOperations={["rename-class"]}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "move-class (unavailable)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    expect(
      screen.getByText(/unavailable for the current RefactorKit context/i),
    ).toBeInTheDocument();
  });

  it("labels preview-only operations without disabling their read-only preview", () => {
    render(
      <JavaRefactoringPreviewDialog
        dialog={state("rename-class")}
        availableOperations={["rename-class"]}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "rename-class (preview only)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();
    expect(screen.getByText(/not managed Apply authority/i)).toBeInTheDocument();
  });

  it("disables Apply when operation-specific authority is unavailable", () => {
    const dialog: JavaRefactoringDialogState = {
      ...state("rename-class"),
      status: "preview",
      plan: readyPlan(),
    };
    const view = render(
      <JavaRefactoringPreviewDialog
        dialog={dialog}
        availableOperations={JAVA_REFACTORING_OPERATIONS}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
    view.rerender(
      <JavaRefactoringPreviewDialog
        dialog={dialog}
        availableOperations={JAVA_REFACTORING_OPERATIONS}
        applicableOperations={[]}
        applyAuthorityAvailable
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(apply).toBeEnabled();
  });

  it("explains why a safe-delete preview remains read-only without project-wide analysis", () => {
    const safeDeletePlan: RefactorPreviewResult = {
      ...readyPlan(),
      operation: "safe-delete",
      target: state("safe-delete").target,
    };
    const dialog: JavaRefactoringDialogState = {
      ...state("safe-delete"),
      status: "preview",
      plan: safeDeletePlan,
    };
    render(
      <JavaRefactoringPreviewDialog
        dialog={dialog}
        availableOperations={JAVA_REFACTORING_OPERATIONS}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByText(/complete project-wide reference analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/Backend eligible: Yes/)).toBeInTheDocument();
  });

  it("shows bounded safe-delete text coverage without presenting it as project-complete", () => {
    const safeDeletePlan: RefactorPreviewResult = {
      ...readyPlan(),
      operation: "safe-delete",
      target: state("safe-delete").target,
      referenceAnalysis: {
        schemaVersion: "java-safe-delete-reference-analysis-v1",
        operation: "safeDelete",
        scope: "workspace-text-v1",
        status: "complete",
        inputCount: 12,
        verifiedBytes: 4096,
        snapshotHash: "a".repeat(64),
        managedApplyAuthority: "none",
        completeProject: false,
        referenceClosure: "incomplete",
      },
    };
    const dialog: JavaRefactoringDialogState = {
      ...state("safe-delete"),
      status: "preview",
      plan: safeDeletePlan,
    };
    render(
      <JavaRefactoringPreviewDialog
        dialog={dialog}
        availableOperations={JAVA_REFACTORING_OPERATIONS}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Reference analysis" })).toBeInTheDocument();
    expect(screen.getByText(/Text scan complete: 12 files, 4,096 bytes/)).toBeInTheDocument();
    expect(
      screen.getByText(/does not establish complete project reference closure/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Apply authority: none/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("shows typed JPQL reference locations and keeps an incomplete entity rename read-only", () => {
    const openReference = vi.fn();
    const referenceWarning = "Only direct static Spring Data @Query JPQL property paths are inspected.";
    const jpqlPlan: RefactorPreviewResult = {
      ...readyPlan(),
      operation: "rename-member",
      target: {
        kind: "member",
        path: "maven/src/main/java/com/example/User.java",
        identity: "com.example.User#amount",
      },
      riskLevel: "high",
      warnings: [referenceWarning, "Review the Java accessor changes."],
      applyEligibility: {
        eligible: false,
        blockers: ["The provider reports incomplete typed reference analysis; managed Apply is unavailable."],
      },
      referenceAnalysis: {
        schemaVersion: "refactorkit-reference-analysis-v1",
        scope: "java-spring-data-jpql-static-property-path-v1",
        completeness: "INCOMPLETE",
        completeProject: false,
        managedWriteAuthority: "none",
        warnings: [referenceWarning],
        references: [
          {
            languageId: "java",
            kind: "framework.entity-property",
            targetOwner: "com.example.User",
            targetMember: "amount",
            resourceKind: "java.annotation-string",
            provenance: "spring-data.query-jpql",
            completeness: "COMPLETE",
            location: {
              path: "maven/src/main/java/com/example/UserRepository.java",
              range: {
                start: { line: 2, character: 74 },
                end: { line: 2, character: 80 },
              },
            },
          },
        ],
      },
    };
    render(
      <JavaRefactoringPreviewDialog
        dialog={{
          ...state("rename-member"),
          status: "preview",
          plan: jpqlPlan,
          message: "The reference could not be opened.",
        }}
        availableOperations={JAVA_REFACTORING_OPERATIONS}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onOpenReference={openReference}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByText("The reference could not be opened.")).toBeInTheDocument();
    expect(screen.getAllByText(referenceWarning)).toHaveLength(1);
    expect(screen.getByText("Review the Java accessor changes.")).toBeInTheDocument();
    expect(screen.getByText(/Typed reference analysis incomplete: 1 reference location\./)).toBeInTheDocument();
    expect(screen.getByText(/Project complete: No\. Managed write authority: none\./)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Typed references" })).toHaveTextContent(
      "com.example.User.amount",
    );
    expect(screen.getByRole("list", { name: "Typed references" })).toHaveTextContent(
      "spring-data.query-jpql",
    );
    expect(screen.getByRole("list", { name: "Typed references" })).toHaveTextContent(
      "UserRepository.java:3:75–3:81",
    );
    fireEvent.click(screen.getByRole("button", { name: /UserRepository\.java:3:75–3:81/ }));
    expect(openReference).toHaveBeenCalledWith(
      jpqlPlan,
      expect.objectContaining({ path: "maven/src/main/java/com/example/UserRepository.java" }),
    );
  });

  it("explains when a workspace formatter profile was not selected", () => {
    const formatPlan: RefactorPreviewResult = {
      ...readyPlan(),
      operation: "format-file",
      target: state("format-file").target,
    };
    const dialog: JavaRefactoringDialogState = {
      ...state("format-file"),
      status: "preview",
      plan: formatPlan,
    };

    render(
      <JavaRefactoringPreviewDialog
        dialog={dialog}
        availableOperations={JAVA_REFACTORING_OPERATIONS}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      /no workspace Eclipse formatter profile was selected/i,
    );
    expect(screen.getByRole("note")).toHaveTextContent(/compare the diff.*before applying/i);
  });

  it("identifies the workspace formatter profile attested by RefactorKit", () => {
    const formatPlan: RefactorPreviewResult = {
      ...readyPlan(),
      operation: "format-file",
      target: state("format-file").target,
      formatterProfilePath: "config/team.xml",
      formatterProfileName: "Team",
      formatterProfileSha256: "a".repeat(64),
    };
    render(
      <JavaRefactoringPreviewDialog
        dialog={{ ...state("format-file"), status: "preview", plan: formatPlan }}
        availableOperations={JAVA_REFACTORING_OPERATIONS}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      /used the workspace Eclipse formatter profile “Team” from config\/team\.xml/i,
    );
  });

  it.each([
    {
      operation: "rename-class",
      entries: [["New name", "Order"]],
      expected: { operation: "rename-class", newName: "Order" },
    },
    {
      operation: "rename-member",
      entries: [["New name", "calculate"]],
      expected: { operation: "rename-member", newName: "calculate" },
    },
    {
      operation: "rename-local-variable",
      entries: [
        ["Current variable name", "count"],
        ["New name", "total"],
      ],
      expected: { operation: "rename-local-variable", fromName: "count", newName: "total" },
    },
    {
      operation: "move-class",
      entries: [["Destination package", "example.services"]],
      expected: { operation: "move-class", newPackage: "example.services" },
    },
    {
      operation: "move-package",
      entries: [["Destination package", "example.services"]],
      expected: {
        operation: "move-package",
        fromPackage: "example",
        toPackage: "example.services",
      },
    },
    {
      operation: "move-source-root",
      entries: [["Destination source root", "app/src/main/java-relocated"]],
      expected: { operation: "move-source-root", to: "app/src/main/java-relocated" },
    },
    {
      operation: "change-method-signature",
      entries: [
        ["Current parameter name", "count"],
        ["New parameter name", "total"],
      ],
      expected: {
        operation: "change-method-signature",
        oldParameter: "count",
        newParameter: "total",
      },
    },
    {
      operation: "change-method-parameter-type",
      entries: [
        ["Parameter name", "count"],
        ["New parameter type", "java.lang.Integer"],
      ],
      expected: {
        operation: "change-method-parameter-type",
        parameterName: "count",
        newType: "java.lang.Integer",
      },
    },
    {
      operation: "add-method-parameter",
      entries: [
        ["Parameter type", "int"],
        ["Parameter name", "count"],
        ["Value at existing calls", "0"],
      ],
      expected: {
        operation: "add-method-parameter",
        parameterType: "int",
        parameterName: "count",
        defaultExpression: "0",
      },
    },
    {
      operation: "remove-method-parameter",
      entries: [["Parameter name to remove", "unused"]],
      expected: { operation: "remove-method-parameter", parameterName: "unused" },
    },
    {
      operation: "reorder-method-parameters",
      entries: [["New parameter order", "second, first"]],
      expected: { operation: "reorder-method-parameters", newOrder: "second, first" },
    },
    {
      operation: "extract-variable",
      entries: [["Variable name", "doubled"]],
      expected: { operation: "extract-variable", name: "doubled" },
    },
    {
      operation: "extract-method",
      entries: [["Method name", "calculateTotal"]],
      expected: { operation: "extract-method", methodName: "calculateTotal" },
    },
    {
      operation: "extract-parameter",
      entries: [["Parameter name", "offset"]],
      expected: { operation: "extract-parameter", name: "offset" },
    },
    {
      operation: "extract-field",
      entries: [["Field name", "value"]],
      expected: { operation: "extract-field", name: "value" },
    },
    {
      operation: "extract-interface",
      entries: [
        ["Interface name", "CalculatorOperations"],
        ["Method name", "calculate"],
      ],
      expected: {
        operation: "extract-interface",
        interfaceName: "CalculatorOperations",
        methodName: "calculate",
      },
    },
    {
      operation: "extract-superclass",
      entries: [
        ["Superclass name", "CalculatorBase"],
        ["Method name", "calculate"],
      ],
      expected: {
        operation: "extract-superclass",
        superclassName: "CalculatorBase",
        methodName: "calculate",
      },
    },
  ] as const)(
    "collects the requested change for $operation",
    ({ operation, entries, expected }) => {
      const observe = vi.fn();
      render(<Form operation={operation} observe={observe} />);
      for (const [label, value] of entries)
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      expect(observe).toHaveBeenLastCalledWith(expected);
    },
  );

  it("clears earlier intent when switching operations and asks for no mutation parameters for safe delete", () => {
    render(<Form operation="rename-class" observe={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "Order" } });
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "move-class" } });
    expect(screen.queryByLabelText("New name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Destination package")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "safe-delete" } });
    expect(screen.queryByLabelText("Destination package")).not.toBeInTheDocument();
  });

  it("submits an explicitly selected module with the move-class package", () => {
    const observe = vi.fn();
    render(
      <Form
        operation="move-class"
        observe={observe}
        capabilities={targetModuleSelectionCapabilities()}
        projectContext={moveClassContext()}
        projectPath="/workspace/project"
      />,
    );

    fireEvent.change(screen.getByLabelText("Destination package"), {
      target: { value: "example.services" },
    });
    fireEvent.change(screen.getByLabelText("Destination module"), {
      target: { value: "library" },
    });

    expect(observe).toHaveBeenLastCalledWith({
      operation: "move-class",
      newPackage: "example.services",
      targetModuleId: "library",
    });
  });

  it.each(["java-project-context-v6", "java-project-context-v7"] as const)(
    "offers destination modules for %s with qualified analysis",
    (schemaVersion) => {
      const qualified = moveClassContext();
      qualified.schemaVersion = schemaVersion;
      qualified.semanticAnalysis = { availability: "available", refusalCode: null };
      qualified.analysis = {
        backend: "jdt",
        snapshotHash: qualified.snapshotHash,
        platformIdentitiesByRelease: {},
        warningCount: 0,
      };

      render(
        <Form
          operation="move-class"
          observe={vi.fn()}
          capabilities={targetModuleSelectionCapabilities()}
          projectContext={qualified}
          projectPath="/workspace/project"
        />,
      );

      expect(screen.getByLabelText("Destination module")).toHaveValue("");
      expect(screen.getByRole("option", { name: "library (library) · library" })).toBeEnabled();
    },
  );

  it("withholds destination modules from a metadata-only v7 context", () => {
    const metadataOnly = moveClassContext();
    metadataOnly.schemaVersion = "java-project-context-v7";
    metadataOnly.semanticAnalysis = {
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    };
    metadataOnly.analysis = null;

    render(
      <Form
        operation="move-class"
        observe={vi.fn()}
        capabilities={targetModuleSelectionCapabilities()}
        projectContext={metadataOnly}
        projectPath="/workspace/project"
      />,
    );

    expect(screen.queryByLabelText("Destination module")).not.toBeInTheDocument();
    expect(screen.getByText(/Java source analysis is unqualified for this project context/i)).toBeInTheDocument();
  });

  it("asks for project synchronization before offering destination modules", () => {
    render(
      <Form
        operation="move-class"
        observe={vi.fn()}
        capabilities={targetModuleSelectionCapabilities()}
        projectPath="/workspace/project"
      />,
    );

    expect(screen.queryByLabelText("Destination module")).not.toBeInTheDocument();
    expect(screen.getByText(/synchronize an available Java project context/i)).toBeInTheDocument();
  });

  it("keeps destination-module choice unavailable without the provider attestation", () => {
    render(
      <Form
        operation="move-class"
        observe={vi.fn()}
        projectContext={moveClassContext()}
        projectPath="/workspace/project"
      />,
    );

    expect(screen.queryByLabelText("Destination module")).not.toBeInTheDocument();
    expect(
      screen.getByText(/this RefactorKit build does not advertise destination-module selection/i),
    ).toBeInTheDocument();
  });

  it("limits Safe Delete target choices to Java types", () => {
    render(<Form operation="safe-delete" observe={vi.fn()} />);

    expect(screen.getByRole("option", { name: "class" })).toBeEnabled();
    for (const kind of ["member", "local-binding", "file", "source-root", "package"])
      expect(screen.getByRole("option", { name: kind })).toBeDisabled();
  });

  it.each([
    ["extract-constant", "Constant name"],
    ["extract-variable", "Variable name"],
    ["extract-parameter", "Parameter name"],
    ["extract-field", "Field name"],
  ] as const)(
    "shows %s name and the exact selected expression before preview",
    (operation, field) => {
      const source = "class A { int value = 1 + 2; }";
      const start = source.indexOf("1 + 2");
      render(
        <JavaRefactoringPreviewDialog
          dialog={{
            ...state(operation),
            target: {
              ...state(operation).target,
              selection: { start, end: start + "1 + 2".length },
            },
            editorSelectionSnapshot: { path: "A.java", text: source },
          }}
          availableOperations={JAVA_REFACTORING_OPERATIONS}
          applicableOperations={[]}
          applyAuthorityAvailable={false}
          rollbackAdvertised={false}
          onSetOperation={vi.fn()}
          onSetTarget={vi.fn()}
          onSetChangeIntent={vi.fn()}
          onPreview={vi.fn()}
          onApply={vi.fn()}
          onRollback={vi.fn()}
          onDiscard={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByLabelText(field)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Selected Java expression" })).toBeInTheDocument();
      expect(screen.getByText("1 + 2")).toBeInTheDocument();
      if (operation === "extract-variable")
        expect(
          screen.getByText(/save open Java changes before requesting a preview/i),
        ).toBeInTheDocument();
      if (operation === "extract-parameter")
        expect(screen.getByText(/exactly one same-file direct caller/i)).toBeInTheDocument();
      if (operation === "extract-field")
        expect(screen.getByText(/compile-time int expressions/i)).toBeInTheDocument();
    },
  );

  it("labels the selected source as a declaration for Extract Method", () => {
    const source = "class A { void run() { int total = 1; } }";
    const start = source.indexOf("int total = 1;");
    render(
      <JavaRefactoringPreviewDialog
        dialog={{
          ...state("extract-method"),
          target: {
            ...state("extract-method").target,
            selection: { start, end: start + "int total = 1;".length },
          },
          editorSelectionSnapshot: { path: "A.java", text: source },
        }}
        availableOperations={JAVA_REFACTORING_OPERATIONS}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Selected Java statements" })).toBeInTheDocument();
    expect(screen.getByText("int total = 1;")).toBeInTheDocument();
  });

  it.each([
    ["rename-class", "class"],
    ["rename-member", "member"],
    ["rename-local-variable", "local-binding"],
    ["change-method-signature", "member"],
    ["format-file", "file"],
    ["organize-imports", "file"],
    ["move-package", "package"],
    ["extract-variable", "file"],
    ["extract-parameter", "file"],
    ["extract-field", "file"],
  ] as const)("restricts %s to %s targets", (operation, requiredKind) => {
    render(<Form operation={operation} observe={vi.fn()} />);

    for (const kind of ["class", "member", "local-binding", "file", "source-root", "package"])
      expect(screen.getByRole("option", { name: kind })).toHaveProperty(
        "disabled",
        kind !== requiredKind,
      );
  });

  it("shows the captured intent during review and keeps it read-only", () => {
    const dialog: JavaRefactoringDialogState = {
      ...state("rename-class"),
      status: "preview",
      changeIntent: { operation: "rename-class", newName: "Unreviewed" },
      selection: {
        operation: "rename-class",
        target: state("rename-class").target,
        workspaceId: "workspace",
        workspaceGeneration: 1,
        selectionGeneration: 1,
        requestId: "review",
        changeIntent: { operation: "rename-class", newName: "Reviewed" },
      },
    };
    render(
      <JavaRefactoringPreviewDialog
        dialog={dialog}
        availableOperations={JAVA_REFACTORING_OPERATIONS}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("New name")).toHaveValue("Reviewed");
    expect(screen.getByLabelText("New name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  });

  it("shows provider evidence with its file and detail context", () => {
    const plan: RefactorPreviewResult = {
      planId: "plan-evidence",
      operation: "rename-class",
      target: state("rename-class").target,
      status: "ready",
      summary: "Rename Order to OrderRecord",
      confidence: 0.96,
      riskLevel: "low",
      risks: [],
      evidence: [
        {
          kind: "compiler",
          summary: "Resolved the selected type binding.",
          path: "src/main/java/example/Order.java",
          detail: "The declaration and its exact references are included.",
        },
      ],
      affectedFiles: [],
      renderedDiff: "",
      structuredDiff: [],
      warnings: [],
      diagnosticsAfterPreview: [],
      conflicts: [],
      refusalReasons: [],
      applyEligibility: { eligible: false, blockers: ["Review only"] },
      staleness: { stale: false, reasons: [] },
      grantsApplyAuthority: false,
      authority: { workspaceId: "workspace", workspaceGeneration: 1 },
      selectionGeneration: 1,
      requestId: "request-evidence",
      provider: "RefactorKit",
      providerVersion: "0.7.0",
    };
    const dialog: JavaRefactoringDialogState = {
      ...state("rename-class"),
      status: "preview",
      plan,
    };

    render(
      <JavaRefactoringPreviewDialog
        dialog={dialog}
        availableOperations={JAVA_REFACTORING_OPERATIONS}
        applicableOperations={[]}
        applyAuthorityAvailable={false}
        rollbackAdvertised={false}
        onSetOperation={vi.fn()}
        onSetTarget={vi.fn()}
        onSetChangeIntent={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onRollback={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("compiler", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Resolved the selected type binding\./)).toBeInTheDocument();
    expect(screen.getByText("src/main/java/example/Order.java")).toBeInTheDocument();
    expect(
      screen.getByText("The declaration and its exact references are included."),
    ).toBeInTheDocument();
  });
});

 it.each(["rollback-refused", "error"] as const)("offers explicit retry only for a confirmed refusal: %s", (status) => {
  const result = { planId: "plan", operation: "rename-class" as const, outcome: "applied" as const,
    changedFiles: [], primaryFile: "A.java", diagnostics: [], transactionId: "transaction", provider: "test", providerVersion: null };
  const onRollback = vi.fn();
  render(<JavaRefactoringPreviewDialog dialog={{ ...state("rename-class"), status, result, message: "Inspect the files before continuing." }}
    availableOperations={["rename-class"]} applicableOperations={["rename-class"]} applyAuthorityAvailable rollbackAdvertised
    onSetOperation={vi.fn()} onSetTarget={vi.fn()} onSetChangeIntent={vi.fn()} onPreview={vi.fn()} onApply={vi.fn()}
    onRollback={onRollback} onDiscard={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByText("Inspect the files before continuing.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  if (status === "rollback-refused") {
    fireEvent.click(screen.getByRole("button", { name: "Retry Rollback" }));
    expect(onRollback).toHaveBeenCalledWith(result);
  } else {
    expect(screen.queryByRole("button", { name: "Retry Rollback" })).not.toBeInTheDocument();
    expect(onRollback).not.toHaveBeenCalled();
  }
});

it("keeps explicit Add Parameter hierarchy and external-risk choices when editing its values", () => {
  const observe = vi.fn();
  render(<Form operation="add-method-parameter" observe={observe} />);
  fireEvent.click(screen.getByLabelText("Update the source override hierarchy"));
  fireEvent.click(screen.getByLabelText("I accept the risk to callers outside this workspace"));
  fireEvent.change(screen.getByLabelText("Parameter type"), { target: { value: "int" } });
  fireEvent.change(screen.getByLabelText("Parameter name"), { target: { value: "limit" } });
  fireEvent.change(screen.getByLabelText("Value at existing calls"), { target: { value: "10" } });
  expect(observe).toHaveBeenLastCalledWith({ operation: "add-method-parameter", parameterType: "int", parameterName: "limit", defaultExpression: "10", includeHierarchy: true, acceptExternalConsumerRisk: true });
});


it.each([
  { operation: "reorder-method-parameters" as const, entries: [["New parameter order", "second,first"]], expected: { newOrder: "second,first" } },
  { operation: "remove-method-parameter" as const, entries: [["Parameter name to remove", "second"]], expected: { parameterName: "second" } },
  { operation: "change-method-parameter-type" as const, entries: [["Parameter name", "second"], ["New parameter type", "long"]], expected: { parameterName: "second", newType: "long" } },
])("preserves explicit API scope while editing $operation", ({ operation, entries, expected }) => {
  const observe = vi.fn();
  render(<Form operation={operation} observe={observe} />);
  fireEvent.click(screen.getByLabelText("Update the source override hierarchy"));
  fireEvent.click(screen.getByLabelText("I accept the risk to callers outside this workspace"));
  for (const [label, value] of entries) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  expect(observe).toHaveBeenLastCalledWith({ operation, ...expected, includeHierarchy: true, acceptExternalConsumerRisk: true });
});


it("offers explicit static method-reference migration for Add Parameter and retains it while editing", () => {
  const observe = vi.fn();
  render(<Form operation="add-method-parameter" observe={observe} />);
  const migration = screen.getByLabelText("Adapt supported static method and constructor references to lambdas");
  expect(migration).not.toBeChecked();
  fireEvent.click(migration);
  fireEvent.change(screen.getByLabelText("Parameter type"), { target: { value: "int" } });
  fireEvent.change(screen.getByLabelText("Parameter name"), { target: { value: "count" } });
  fireEvent.change(screen.getByLabelText("Value at existing calls"), { target: { value: "0" } });
  expect(observe).toHaveBeenLastCalledWith({ operation: "add-method-parameter", parameterType: "int", parameterName: "count", defaultExpression: "0", migrateFunctionalReferences: true });
});
it("describes bound instance references only when Add Parameter advertises them", () => {
  const capabilities = targetModuleSelectionCapabilities();
  const context = capabilities.javaContextRefactoring!;
  context.operations = ["changeSignature.addParameter"];
  context.operationCapabilities = [{
    operation: "changeSignature.addParameter",
    features: { thisMethodReferenceMigration: true },
  }];
  render(<Form operation="add-method-parameter" observe={vi.fn()} capabilities={capabilities} />);
  expect(screen.getByLabelText("Adapt supported method and constructor references to lambdas"))
    .not.toBeChecked();
  expect(screen.getByText(/adapt supported this::method references/)).toBeInTheDocument();
});
it.each(["reorder-method-parameters", "remove-method-parameter", "change-method-parameter-type"] as const)(
  "withholds unsupported static-reference migration for %s", operation => {
    render(<Form operation={operation} observe={vi.fn()} />);
    expect(screen.queryByLabelText("Adapt supported static method and constructor references to lambdas")).not.toBeInTheDocument();
  },
);

it("collects the field type without offering signature hierarchy migration", () => {
  const observe = vi.fn();
  render(<Form operation="change-field-type" observe={observe} />);
  fireEvent.change(screen.getByLabelText("New field type"), { target: { value: "long" } });
  expect(observe).toHaveBeenLastCalledWith({ operation: "change-field-type", newType: "long" });
  expect(screen.queryByLabelText("Update the source override hierarchy")).not.toBeInTheDocument();
  expect(screen.getByText(/private mutable int field to long/)).toBeInTheDocument();
});

it("keeps the parameter names in the order entered in the parameter object form", () => {
  const observe = vi.fn();
  render(<Form operation="introduce-parameter-object" observe={observe} />);
  fireEvent.change(screen.getByLabelText("Second parameter name"), { target: { value: "right" } });
  fireEvent.change(screen.getByLabelText("Parameter object type name"), { target: { value: "Arguments" } });
  fireEvent.change(screen.getByLabelText("First parameter name"), { target: { value: "left" } });
  expect(observe).toHaveBeenLastCalledWith({
    operation: "introduce-parameter-object", typeName: "Arguments", parameters: ["left", "right"],
  });
});

it("collects a delegate type and the selected member names", () => {
  const observe = vi.fn();
  render(<Form operation="extract-delegate" observe={observe} />);
  fireEvent.change(screen.getByLabelText("Delegate type name"), { target: { value: "Calculation" } });
  fireEvent.change(screen.getByLabelText("Member names (comma-separated)"), {
    target: { value: "OFFSET, adjust, compute" },
  });
  expect(observe).toHaveBeenLastCalledWith({
    operation: "extract-delegate", typeName: "Calculation", members: ["OFFSET", "adjust", "compute"],
  });
});

it("preserves the captured Gradle rename source while collecting the new project path", () => {
  const observe = vi.fn();
  render(<Form operation="rename-gradle-module" observe={observe} />);
  fireEvent.change(screen.getByLabelText("New Gradle project path"), { target: { value: ":renamed" } });
  expect(observe).toHaveBeenLastCalledWith({ operation: "rename-gradle-module", buildRoot: "", oldProjectPath: "", newProjectPath: ":renamed" });
  expect(screen.getByText(/preserves the physical directory/)).toBeInTheDocument();
});
