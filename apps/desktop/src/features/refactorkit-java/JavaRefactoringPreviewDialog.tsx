import type { JavaCleanupFileSearchPort } from "./JavaCleanupFileSearch";
import { JavaBatchCleanupFields } from "./JavaBatchCleanupFields";
import type {
  JavaEffectiveProjectContext,
  JavaWorkspaceSymbolsResponse,
  RefactorApplyResult,
  RefactorKitCapabilities,
  RefactorKitPlanDiagnostic,
  RefactorKitTypedReferenceLocation,
  RefactorKitChangeIntent,
  RefactorPreviewResult,
  RefactoringOperation,
  RefactoringTarget,
} from "@ide/contracts";
import { javaMoveClassTargetModuleSelectionOffered } from "@ide/contracts";
import { useEffect, useId, useRef, useState } from "react";
import type { JavaRefactoringDialogState } from "./useJavaRefactoringController";
import {
  JAVA_REFACTORING_OPERATION_NOT_OFFERED,
  JAVA_REFACTORING_UNAVAILABLE,
} from "./useJavaRefactoringController";
import { supportsJavaRefactoringTarget } from "./javaRefactoringAvailability";
import { javaMoveClassTargetModules } from "./javaMoveClassTargetModules";

const TARGET_KINDS: readonly RefactoringTarget["kind"][] = [
  "class",
  "member",
  "local-binding",
  "file",
  "source-root",
  "package",
];

type IntentField =
  | "moduleName"
  | "buildRoot"
  | "projectPath"
  | "oldProjectPath"
  | "newProjectPath"
  | "newName"
  | "fromName"
  | "newPackage"
  | "targetModuleId"
  | "fromPackage"
  | "toPackage"
  | "to"
  | "oldParameter"
  | "newParameter"
  | "newType"
  | "parameterType"
  | "parameterName"
  | "typeName"
  | "members"
  | "firstParameter"
  | "secondParameter"
  | "defaultExpression"
  | "newOrder"
  | "name"
  | "interfaceName"
  | "superclassName"
  | "targetType"
  | "methodName";

function intentFields(operation: RefactoringOperation): { key: IntentField; label: string }[] {
  switch (operation) {
    case "create-maven-module":
      return [{ key: "moduleName", label: "Maven module name" }];
    case "create-gradle-module":
      return [{ key: "projectPath", label: "Gradle project path" }];
    case "rename-gradle-module":
      return [{ key: "newProjectPath", label: "New Gradle project path" }];
    case "rename-class":
    case "rename-member":
      return [{ key: "newName", label: "New name" }];
    case "rename-local-variable":
      return [
        { key: "fromName", label: "Current variable name" },
        { key: "newName", label: "New name" },
      ];
    case "move-class":
      return [{ key: "newPackage", label: "Destination package" }];
    case "move-package":
      return [
        { key: "fromPackage", label: "Current package" },
        { key: "toPackage", label: "Destination package" },
      ];
    case "move-source-root":
      return [{ key: "to", label: "Destination source root" }];
    case "change-method-signature":
      return [
        { key: "oldParameter", label: "Current parameter name" },
        { key: "newParameter", label: "New parameter name" },
      ];
    case "change-field-type":
      return [{ key: "newType", label: "New field type" }];
    case "change-method-parameter-type":
      return [
        { key: "parameterName", label: "Parameter name" },
        { key: "newType", label: "New parameter type" },
      ];
    case "add-method-parameter":
      return [
        { key: "parameterType", label: "Parameter type" },
        { key: "parameterName", label: "Parameter name" },
        { key: "defaultExpression", label: "Value at existing calls" },
      ];
    case "remove-method-parameter":
      return [{ key: "parameterName", label: "Parameter name to remove" }];
    case "reorder-method-parameters":
      return [{ key: "newOrder", label: "New parameter order" }];
    case "extract-delegate":
      return [
        { key: "typeName", label: "Delegate type name" },
        { key: "members", label: "Member names (comma-separated)" },
      ];
    case "introduce-parameter-object":
      return [
        { key: "typeName", label: "Parameter object type name" },
        { key: "firstParameter", label: "First parameter name" },
        { key: "secondParameter", label: "Second parameter name" },
      ];
    case "make-static":
    case "make-public":
    case "inline-variable":
    case "inline-method":
    case "inline-constant":
      return [];
    case "extract-constant":
      return [{ key: "name", label: "Constant name" }];
    case "extract-variable":
      return [{ key: "name", label: "Variable name" }];
    case "extract-method":
      return [{ key: "methodName", label: "Method name" }];
    case "extract-parameter":
      return [{ key: "name", label: "Parameter name" }];
    case "extract-field":
      return [{ key: "name", label: "Field name" }];
    case "extract-interface":
      return [
        { key: "interfaceName", label: "Interface name" },
        { key: "methodName", label: "Method name" },
      ];
    case "extract-superclass":
      return [
        { key: "superclassName", label: "Superclass name" },
        { key: "methodName", label: "Method name" },
      ];
    case "pull-up-member":
      return [{ key: "targetType", label: "Target supertype (fully qualified name)" }];
    case "push-down-member":
      return [{ key: "targetType", label: "Target subtype (fully qualified name)" }];
    case "move-member":
      return [];
    case "safe-delete":
    case "encapsulate-field":
    case "format-file":
    case "organize-imports":
    case "batch-cleanup":
      return [];
  }
}

function intentValue(intent: RefactorKitChangeIntent | undefined, key: IntentField): string {
  if (intent?.operation === "introduce-parameter-object") {
    if (key === "firstParameter") return intent.parameters[0];
    if (key === "secondParameter") return intent.parameters[1];
  }
  if (intent?.operation === "extract-delegate" && key === "members") return intent.members.join(",");
  if (!intent || !(key in intent)) return "";
  const value: unknown = Reflect.get(intent, key);
  return typeof value === "string" ? value : "";
}

type SignatureIntent = Extract<RefactorKitChangeIntent, { operation: "add-method-parameter" | "remove-method-parameter" | "reorder-method-parameters" | "change-method-parameter-type" }>;
function signatureScopeOffered(operation: RefactoringOperation): boolean {
  return ["add-method-parameter", "remove-method-parameter", "reorder-method-parameters", "change-method-parameter-type"].includes(operation);
}
function signatureIntent(intent: RefactorKitChangeIntent | undefined): intent is SignatureIntent {
  return !!intent && signatureScopeOffered(intent.operation);
}
function signatureOptions(intent: RefactorKitChangeIntent | undefined) {
  return signatureIntent(intent) ? {
    ...(intent.includeHierarchy !== undefined ? { includeHierarchy: intent.includeHierarchy } : {}),
    ...(intent.acceptExternalConsumerRisk !== undefined ? { acceptExternalConsumerRisk: intent.acceptExternalConsumerRisk } : {}),
  } : {};
}

function updateIntent(
  operation: RefactoringOperation,
  intent: RefactorKitChangeIntent | undefined,
  key: IntentField,
  value: string,
): RefactorKitChangeIntent | undefined {
  const field = (name: IntentField) => (name === key ? value : intentValue(intent, name));
  switch (operation) {
    case "create-maven-module":
      return { operation, moduleName: field("moduleName") };
    case "rename-gradle-module":
      return { operation, buildRoot: intentValue(intent, "buildRoot"),
        oldProjectPath: intentValue(intent, "oldProjectPath"), newProjectPath: field("newProjectPath") };
    case "create-gradle-module":
      return {
        operation,
        buildRoot: intentValue(intent, "buildRoot"),
        projectPath: field("projectPath"),
      };
    case "rename-class":
    case "rename-member":
      return { operation, newName: field("newName") };
    case "rename-local-variable":
      return { operation, fromName: field("fromName"), newName: field("newName") };
    case "move-class":
      return {
        operation,
        newPackage: field("newPackage"),
        ...(field("targetModuleId") ? { targetModuleId: field("targetModuleId") } : {}),
      };
    case "move-package":
      return { operation, fromPackage: field("fromPackage"), toPackage: field("toPackage") };
    case "move-source-root":
      return { operation, to: field("to") };
    case "change-method-signature":
      return {
        operation,
        oldParameter: field("oldParameter"),
        newParameter: field("newParameter"),
      };
    case "change-field-type":
      return { operation, newType: field("newType") };
    case "extract-delegate":
      return { operation, typeName: field("typeName"), members: field("members").split(",").map((name) => name.trim()) };
    case "introduce-parameter-object":
      return { operation, typeName: field("typeName"), parameters: [field("firstParameter"), field("secondParameter")] };
    case "change-method-parameter-type":
      return {
        operation,
        parameterName: field("parameterName"),
        newType: field("newType"),
        ...signatureOptions(intent),
      };
    case "add-method-parameter":
      return {
        operation,
        parameterType: field("parameterType"),
        parameterName: field("parameterName"),
        defaultExpression: field("defaultExpression"),
        ...(intent?.operation === "add-method-parameter" && intent.migrateFunctionalReferences !== undefined
          ? { migrateFunctionalReferences: intent.migrateFunctionalReferences } : {}),
        ...signatureOptions(intent),
      };
    case "remove-method-parameter":
      return { operation, parameterName: field("parameterName"), ...signatureOptions(intent) };
    case "reorder-method-parameters":
      return { operation, newOrder: field("newOrder"), ...signatureOptions(intent) };
    case "extract-constant":
      return { operation, name: field("name") };
    case "extract-variable":
      return { operation, name: field("name") };
    case "extract-method":
      return { operation, methodName: field("methodName") };
    case "extract-parameter":
      return { operation, name: field("name") };
    case "extract-field":
      return { operation, name: field("name") };
    case "extract-interface":
      return {
        operation,
        interfaceName: field("interfaceName"),
        methodName: field("methodName"),
      };
    case "extract-superclass":
      return {
        operation,
        superclassName: field("superclassName"),
        methodName: field("methodName"),
      };
    case "pull-up-member":
      return { operation, targetType: field("targetType") };
    case "push-down-member":
      return { operation, targetType: field("targetType") };
    case "move-member":
      return intent && intent.operation === "move-member"
        ? { ...intent, targetType: field("targetType") }
        : undefined;
    case "safe-delete":
    case "encapsulate-field":
    case "inline-variable":
    case "inline-method":
    case "inline-constant":
    case "make-static":
    case "make-public":
    case "format-file":
    case "organize-imports":
      return undefined;
  }
}

function TextList({ items, empty }: { items: readonly string[]; empty?: string }): JSX.Element {
  if (items.length === 0)
    return <p className="text-xs text-[var(--text-muted)]">{empty ?? "None"}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-xs">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function Diagnostics({
  diagnostics,
}: {
  diagnostics: readonly RefactorKitPlanDiagnostic[];
}): JSX.Element {
  return (
    <TextList
      empty="No diagnostics"
      items={diagnostics.map((item) => {
        const location = item.path
          ? ` — ${item.path}${item.line === undefined ? "" : `:${item.line}${item.column === undefined ? "" : `:${item.column}`}`}`
          : "";
        return `${item.severity.toUpperCase()}${item.code ? ` ${item.code}` : ""}: ${item.message}${location}`;
      })}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="space-y-2 rounded border border-[var(--border-default)] p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "success" | "warning" | "error";
  children: React.ReactNode;
}): JSX.Element {
  const colors = {
    info: "border-[var(--accent-blue)]",
    success: "border-[var(--accent-green)]",
    warning: "border-[var(--accent-yellow)]",
    error: "border-[var(--accent-red)]",
  } as const;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded border-l-4 bg-[var(--surface-panel)] p-3 text-sm ${colors[tone]}`}
    >
      {children}
    </div>
  );
}

export interface JavaRefactoringPreviewDialogProps {
  dialog: JavaRefactoringDialogState;
  capabilities?: RefactorKitCapabilities | null;
  projectContext?: JavaEffectiveProjectContext | null;
  projectPath?: string;
  searchCleanupFiles?: JavaCleanupFileSearchPort;
  workspaceGeneration?: number;
  searchJavaTypes?: (query: string, signal?: AbortSignal) => Promise<JavaWorkspaceSymbolsResponse>;
  availableOperations: readonly RefactoringOperation[];
  applicableOperations: readonly RefactoringOperation[];
  applyAuthorityAvailable: boolean;
  rollbackAdvertised: boolean;
  onSetOperation(operation: RefactoringOperation): void;
  onSetTarget(target: RefactoringTarget): void;
  onSetChangeIntent(intent: RefactorKitChangeIntent | undefined): void;
  onPreview(): void;
  onOpenReference?(plan: RefactorPreviewResult, location: RefactorKitTypedReferenceLocation): void;
  onApply(plan: RefactorPreviewResult): void;
  onRollback(result: RefactorApplyResult): void;
  onUndoEditor?(): void;
  onRecoverEditor?(): void;
  onDiscard(): void;
  onCancel(): void;
}

function canApply(plan: RefactorPreviewResult): boolean {
  return Boolean(
    plan.status === "ready" &&
    plan.applyEligibility.eligible &&
    plan.applyEligibility.blockers.length === 0 &&
    !plan.staleness.stale,
  );
}

/**
 * Minimal desktop dialog for the capability-gated general Java refactoring flow.
 * The reviewed preview is presented read-only and grants no apply authority; Apply
 * binds to the exact reviewed plan and Rollback is offered only when advertised and
 * transaction-bound. No native API is imported here.
 */
export function JavaRefactoringPreviewDialog({
  dialog,
  capabilities,
  projectContext,
  projectPath = "",
  searchJavaTypes,
  searchCleanupFiles,
  workspaceGeneration,
  availableOperations,
  applicableOperations,
  applyAuthorityAvailable,
  rollbackAdvertised,
  onSetOperation,
  onSetTarget,
  onSetChangeIntent,
  onPreview,
  onOpenReference,
  onApply,
  onRollback,
  onUndoEditor,
  onRecoverEditor,
  onDiscard,
  onCancel,
}: JavaRefactoringPreviewDialogProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [moveMemberQuery, setMoveMemberQuery] = useState("");
  const [moveMemberTypes, setMoveMemberTypes] = useState<
    { name: string; path: string; line: number; character: number; containerName?: string }[]
  >([]);
  const [moveMemberSearchState, setMoveMemberSearchState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [moveMemberSearchMessage, setMoveMemberSearchMessage] = useState<string | null>(null);
  const [moveMemberSearchTruncated, setMoveMemberSearchTruncated] = useState(false);
  const status = dialog.status;
  const plan = dialog.plan;
  const result = dialog.result;
  const referenceWarnings =
    plan?.referenceAnalysis?.schemaVersion === "refactorkit-reference-analysis-v1"
      ? plan.referenceAnalysis.warnings
      : [];
  const otherWarnings = plan?.warnings.filter((warning) => !referenceWarnings.includes(warning)) ?? [];
  const intent = dialog.selection?.changeIntent ?? dialog.changeIntent;
  const thisMethodReferenceMigration =
    capabilities?.javaContextRefactoring?.operationCapabilities?.some(
      (entry) => entry.operation === "changeSignature.addParameter" &&
        entry.features?.thisMethodReferenceMigration === true,
    ) === true;
  const targetModuleSelectionAvailable =
    dialog.operation === "move-class" && javaMoveClassTargetModuleSelectionOffered(capabilities);
  const targetModules = targetModuleSelectionAvailable
    ? javaMoveClassTargetModules(projectContext, dialog.target.path, projectPath)
    : [];
  const targetModuleSelectionMessage = !targetModuleSelectionAvailable
    ? "This RefactorKit build does not advertise destination-module selection. Update RefactorKit to move a class into a new package in another module."
    : targetModules.length > 0
      ? "Choose a destination module to move the type into a new package there. RefactorKit checks the selected module against the synchronized project context during preview."
      : projectContext?.semanticAnalysis?.availability === "unqualified"
        ? "Java source analysis is unqualified for this project context, so cross-module destinations are unavailable. You can still use the source module or an existing package."
        : projectContext?.status !== "available"
          ? "Synchronize an available Java project context to select a cross-module destination. You can still use the source module or an existing package."
          : "No unambiguous cross-module main source root is available in the synchronized provider context. You can still use the source module or an existing package.";
  const offeredOperations = new Set(availableOperations);
  const applicableOperationSet = new Set(applicableOperations);
  const selectableOperations = [...new Set([...availableOperations, dialog.operation])].filter(
    (operation) =>
      !["create-maven-module", "create-gradle-module", "rename-gradle-module"].includes(operation) ||
      dialog.operation === operation,
  );
  const selectedExpression =
    [
      "extract-constant",
      "extract-variable",
      "extract-method",
      "extract-parameter",
      "extract-field",
      "inline-variable",
      "inline-constant",
    ].includes(dialog.operation) &&
    dialog.editorSelectionSnapshot &&
    dialog.target.selection
      ? dialog.editorSelectionSnapshot.text.slice(
          dialog.target.selection.start,
          dialog.target.selection.end,
        )
      : undefined;

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  useEffect(() => {
    const query = moveMemberQuery.trim();
    if (dialog.operation !== "move-member" || !searchJavaTypes || query.length < 2) {
      setMoveMemberTypes([]);
      setMoveMemberSearchState("idle");
      setMoveMemberSearchMessage(null);
      setMoveMemberSearchTruncated(false);
      return;
    }
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      setMoveMemberSearchState("loading");
      setMoveMemberSearchMessage(null);
      void searchJavaTypes(query, abort.signal).then(
        (response) => {
          if (abort.signal.aborted) return;
          if (!response.ok) {
            setMoveMemberTypes([]);
            setMoveMemberSearchState("error");
            setMoveMemberSearchMessage(
              response.error.summary ?? "Java type search is unavailable.",
            );
            setMoveMemberSearchTruncated(false);
            return;
          }
          const symbols = response.result.symbols
            .filter(
              (symbol) =>
                symbol.kind === "class" &&
                symbol.path === dialog.target.path &&
                Number.isSafeInteger(symbol.range.start.line) &&
                Number.isSafeInteger(symbol.range.start.character),
            )
            .map((symbol) => ({
              name: symbol.name,
              path: symbol.path,
              line: symbol.range.start.line,
              character: symbol.range.start.character,
              ...(symbol.containerName ? { containerName: symbol.containerName } : {}),
            }));
          setMoveMemberTypes(symbols);
          setMoveMemberSearchState("ready");
          setMoveMemberSearchTruncated(response.result.isTruncated);
        },
        (failure: unknown) => {
          if (abort.signal.aborted) return;
          setMoveMemberTypes([]);
          setMoveMemberSearchState("error");
          setMoveMemberSearchMessage(
            failure instanceof Error ? failure.message : "Java type search failed.",
          );
          setMoveMemberSearchTruncated(false);
        },
      );
    }, 150);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [dialog.operation, dialog.target.path, moveMemberQuery, searchJavaTypes]);

  const bannerReasons =
    plan?.status === "ready"
      ? [
          ...plan.refusalReasons,
          ...plan.staleness.reasons,
          ...plan.applyEligibility.blockers,
        ].filter(
          (reason, index) =>
            reason !== dialog.message &&
            [
              ...plan.refusalReasons,
              ...plan.staleness.reasons,
              ...plan.applyEligibility.blockers,
            ].indexOf(reason) === index,
        )
      : [];
  const referenceAnalysisSummary = plan?.referenceAnalysis
    ? plan.referenceAnalysis.schemaVersion === "java-safe-delete-reference-analysis-v1"
      ? `Text scan ${plan.referenceAnalysis.status}: ${[
          plan.referenceAnalysis.inputCount === null
            ? "file count unavailable"
            : `${plan.referenceAnalysis.inputCount.toLocaleString()} files`,
          plan.referenceAnalysis.verifiedBytes === null
            ? "byte count unavailable"
            : `${plan.referenceAnalysis.verifiedBytes.toLocaleString()} bytes`,
        ].join(", ")}.`
      : `Typed reference analysis ${plan.referenceAnalysis.completeness.toLowerCase()}: ${plan.referenceAnalysis.references.length} reference location${plan.referenceAnalysis.references.length === 1 ? "" : "s"}.`
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <header className="border-b border-[var(--border-default)] px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {dialog.operation === "create-maven-module"
              ? "Add Maven Module"
              : dialog.operation === "create-gradle-module"
                ? "Add Gradle Module"
                : dialog.operation === "rename-gradle-module"
                  ? "Rename Gradle Module (experimental)"
                  : "Java Refactor"}
          </h2>
          <p id={descriptionId} className="mt-1 text-xs text-[var(--text-secondary)]">
            {dialog.selection?.editorOverlay
              ? plan?.editorPreview?.mutationMode === "durable-editor-owned"
                ? "Apply transforms the open drafts without saving their content. File renames move the original saved bytes. Undo restores the original drafts."
                : "Review the proposed changes to your drafts. Applying this preview is unavailable."
              : "Enter the requested change, review the preview, then apply the reviewed plan."}
            {!dialog.selection?.editorOverlay &&
              (dialog.operation === "rename-class" || dialog.operation === "rename-member") &&
              " Unsaved Java renames use the editor cursor target."}
            {(dialog.operation === "format-file" || dialog.operation === "organize-imports") &&
              " Formatting and import organization are separate reviewed changes to this file."}
            {dialog.operation === "make-static" &&
              " RefactorKit checks Java bindings and call sites; unsupported method shapes are refused before Apply."}
            {dialog.operation === "make-public" &&
              " RefactorKit supports promoting one bound final concrete method to public on a top-level class. It refuses incomplete bindings, unsupported annotations or unproven override risks."}
            {dialog.operation === "inline-method" &&
              " RefactorKit checks method and call-site bindings; unsupported or ambiguous method shapes are refused before Apply."}
            {dialog.operation === "extract-delegate" &&
              " Place the cursor on a method in the group. Enter the private static helper names and any private constants to move with them."}
            {dialog.operation === "introduce-parameter-object" &&
              " Enter two adjacent parameters in declaration order. RefactorKit checks the saved method and its call sites."}
            {dialog.operation === "inline-variable" &&
              " RefactorKit currently supports one local in an ordinary method, initialized by a primitive-int literal, with complete bindings and read-only references. Unsupported scopes, writes, or ambiguous declarations are refused."}
            {dialog.operation === "inline-constant" &&
              " RefactorKit currently supports one private static final int literal field on an ordinary top-level class with complete bindings and no writes. Unsupported fields or ambiguous declarations are refused."}
            {dialog.operation === "extract-constant" &&
              " RefactorKit currently supports compile-time int expressions in methods of ordinary top-level classes; review uses saved sources and refuses dirty editor buffers."}
            {dialog.operation === "extract-variable" &&
              " RefactorKit reviews the selected expression before introducing a local variable. Save open Java changes before requesting a preview."}
            {dialog.operation === "extract-method" &&
              " RefactorKit analyzes the selected statements and their binding-resolved data flow; unsupported bindings or data-flow shapes are refused. Review uses saved sources and refuses dirty editor buffers."}
            {dialog.operation === "extract-parameter" &&
              " RefactorKit currently supports a parameter plus int literal in the sole return expression of a private static one-parameter int method with exactly one same-file direct caller; review uses saved sources and refuses dirty editor buffers."}
            {dialog.operation === "extract-field" &&
              " RefactorKit currently supports compile-time int expressions in non-static methods of top-level ordinary classes; review uses saved sources and refuses dirty editor buffers."}
            {dialog.operation === "extract-interface" &&
              " RefactorKit supports one public concrete instance method with primitive parameters and a primitive or void return type on a top-level class without an existing hierarchy. Review uses the saved JDT class selection and refuses dirty editor buffers."}
            {dialog.operation === "extract-superclass" &&
              " RefactorKit currently supports one public, unannotated instance method with an int return and int parameters, whose body is exactly one int return expression. The top-level class must have no superclass, interfaces, or type parameters. Review uses the saved JDT class selection and refuses dirty editor buffers."}
            {dialog.operation === "pull-up-member" &&
              " This high-risk provider slice accepts a final, no-argument int method returning one numeric literal and moves it to its direct superclass in the same source set. RefactorKit uses JDT bindings and refuses other shapes; review uses saved sources and refuses dirty editor buffers. Inspect warnings for reflective or external consumers before Apply."}
            {dialog.operation === "push-down-member" &&
              " This high-risk provider slice accepts one protected final int literal method on a package-private abstract parent with its only final direct child in the same source set. RefactorKit uses JDT bindings and refuses other shapes; review uses saved sources and refuses dirty editor buffers. Inspect warnings for reflective or external consumers before Apply."}
            {dialog.operation === "move-member" &&
              " This high-risk provider slice moves one package-private static no-argument int method returning a literal between classes in the same source set, in a file with exactly two top-level classes. RefactorKit updates complete direct invocation bindings and refuses other shapes; review uses saved sources and refuses dirty editor buffers."}
            {dialog.operation === "encapsulate-field" &&
              " RefactorKit has tested support for public final instance fields of type int, String, List<String>, and int[] when their Java reads have complete bindings. Other field shapes may be refused before Apply."}
            {dialog.operation === "move-source-root" &&
              " Source-root moves preserve package names and source bytes; the destination is relative to the selected project."}
            {dialog.operation === "create-maven-module" &&
              " RefactorKit derives coordinates from the selected parent POM. Apply is refused while editor buffers are unsaved."}
            {dialog.operation === "rename-gradle-module" && (
              <span>
                Experimental Gradle module rename: {intentValue(intent, "oldProjectPath")} in {intentValue(intent, "buildRoot")}.
                RefactorKit changes the logical project path and preserves the physical directory.
                Review the settings and any affected dependency declarations before Apply.
              </span>
            )}
            {dialog.operation === "create-gradle-module" &&
              ` RefactorKit adds the requested project to the synchronized build at ${intentValue(intent, "buildRoot") || "the selected build"}. Apply is refused while editor buffers are unsaved.`}
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <Section title="Operation and target">
            <div className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[9rem_1fr]">
              <label className="contents">
                <span className="text-[var(--text-secondary)]">Operation</span>
                <select
                  disabled={status !== "idle"}
                  value={dialog.operation}
                  onChange={(event) => onSetOperation(event.target.value as RefactoringOperation)}
                  className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                >
                  {selectableOperations.map((operation) => (
                    <option
                      key={operation}
                      value={operation}
                      disabled={!offeredOperations.has(operation)}
                      title={
                        offeredOperations.has(operation)
                          ? applicableOperationSet.has(operation)
                            ? undefined
                            : "RefactorKit allows preview only for the current context."
                          : "RefactorKit does not advertise preview for the current context."
                      }
                    >
                      {operation}
                      {!offeredOperations.has(operation)
                        ? " (unavailable)"
                        : !applicableOperationSet.has(operation)
                          ? " (preview only)"
                          : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="contents">
                <span className="text-[var(--text-secondary)]">Target kind</span>
                <select
                  disabled={
                    status !== "idle" ||
                    dialog.operation === "move-source-root" ||
                    dialog.operation === "create-maven-module" ||
                    (dialog.operation === "create-gradle-module" || dialog.operation === "rename-gradle-module")
                  }
                  value={dialog.target.kind}
                  onChange={(event) =>
                    onSetTarget({
                      ...dialog.target,
                      kind: event.target.value as RefactoringTarget["kind"],
                    })
                  }
                  className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                >
                  {TARGET_KINDS.map((kind) => (
                    <option
                      key={kind}
                      value={kind}
                      disabled={!supportsJavaRefactoringTarget(dialog.operation, kind)}
                    >
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label className="contents">
                <span className="text-[var(--text-secondary)]">
                  {dialog.operation === "create-maven-module" ||
                  (dialog.operation === "create-gradle-module" || dialog.operation === "rename-gradle-module")
                    ? dialog.operation === "create-maven-module"
                      ? "Parent POM"
                      : "Gradle settings"
                    : dialog.target.kind === "source-root"
                      ? "Source root"
                      : "Source path"}
                </span>
                <input
                  disabled={
                    status !== "idle" ||
                    dialog.operation === "create-maven-module" ||
                    (dialog.operation === "create-gradle-module" || dialog.operation === "rename-gradle-module")
                  }
                  value={dialog.target.path}
                  onChange={(event) =>
                    onSetTarget({
                      ...dialog.target,
                      path: event.target.value,
                      ...(["file", "source-root"].includes(dialog.target.kind)
                        ? { identity: event.target.value }
                        : {}),
                    })
                  }
                  className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                  placeholder={
                    dialog.target.kind === "source-root"
                      ? "module/src/main/java"
                      : "src/main/java/example/A.java"
                  }
                />
              </label>
              <label className="contents">
                <span className="text-[var(--text-secondary)]">Element identity</span>
                <input
                  disabled={
                    status !== "idle" ||
                    ["file", "source-root"].includes(dialog.target.kind) ||
                    dialog.operation === "add-method-parameter" ||
                    dialog.operation === "remove-method-parameter" ||
                    (dialog.operation === "change-method-signature" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "change-method-parameter-type" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "reorder-method-parameters" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "make-static" && dialog.target.identity === "@cursor") ||
                    ((dialog.operation === "make-public" || dialog.operation === "change-field-type") && dialog.target.identity === "@cursor") ||
                    ((dialog.operation === "inline-method" || dialog.operation === "introduce-parameter-object" || dialog.operation === "extract-delegate") &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "extract-interface" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "extract-superclass" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "pull-up-member" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "push-down-member" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "move-member" && dialog.target.identity === "@cursor")
                  }
                  value={plan?.editorPreview?.symbolId ?? dialog.target.identity}
                  onChange={(event) =>
                    onSetTarget({ ...dialog.target, identity: event.target.value })
                  }
                  className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                  placeholder={
                    dialog.operation === "add-method-parameter" ||
                    dialog.operation === "remove-method-parameter" ||
                    (dialog.operation === "change-method-signature" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "change-method-parameter-type" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "reorder-method-parameters" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "make-static" && dialog.target.identity === "@cursor") ||
                    ((dialog.operation === "make-public" || dialog.operation === "change-field-type") && dialog.target.identity === "@cursor") ||
                    ((dialog.operation === "inline-method" || dialog.operation === "introduce-parameter-object" || dialog.operation === "extract-delegate") &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "extract-interface" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "extract-superclass" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "pull-up-member" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "push-down-member" &&
                      dialog.target.identity === "@cursor") ||
                    (dialog.operation === "move-member" && dialog.target.identity === "@cursor")
                      ? "Selected from the Java cursor"
                      : "example.A"
                  }
                />
              </label>
              {dialog.operation === "move-member" ? (
                <div className="space-y-2 sm:col-span-2">
                  <label className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[9rem_1fr]">
                    <span className="text-[var(--text-secondary)]">Destination type</span>
                    <input
                      aria-label="Search destination Java type in the current source file"
                      disabled={status !== "idle" || !searchJavaTypes}
                      value={moveMemberQuery}
                      onChange={(event) => {
                        setMoveMemberQuery(event.target.value);
                        if (intent?.operation === "move-member") onSetChangeIntent(undefined);
                      }}
                      placeholder="Search this Java file by class name"
                      className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                    />
                  </label>
                  <p className="text-xs text-[var(--text-muted)]">
                    Choose a class from the same file. JDT LS supplies its location; RefactorKit
                    resolves and verifies the destination binding.
                  </p>
                  {moveMemberSearchState === "loading" ? (
                    <p role="status" className="text-xs text-[var(--text-muted)]">
                      Searching Java types…
                    </p>
                  ) : null}
                  {moveMemberSearchMessage ? (
                    <p role="alert" className="text-xs text-[var(--text-danger)]">
                      {moveMemberSearchMessage}
                    </p>
                  ) : null}
                  {moveMemberSearchTruncated ? (
                    <p className="text-xs text-[var(--text-warning)]">
                      Results are limited; narrow the search to find the destination type.
                    </p>
                  ) : null}
                  {moveMemberSearchState === "idle" ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      Enter at least two characters to search.
                    </p>
                  ) : null}
                  {moveMemberSearchState === "ready" && moveMemberTypes.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      No class in the current source file matches this query.
                    </p>
                  ) : null}
                  {moveMemberTypes.length > 0 ? (
                    <ul
                      aria-label="Destination Java types"
                      className="max-h-36 space-y-1 overflow-y-auto"
                    >
                      {moveMemberTypes.map((type, index) => {
                        const targetType = type.containerName
                          ? `${type.containerName}.${type.name}`
                          : type.name;
                        const selected = Boolean(
                          intent?.operation === "move-member" &&
                          intent.targetPath === type.path &&
                          intent.targetPosition.line === type.line &&
                          intent.targetPosition.character === type.character &&
                          intent.targetType === targetType,
                        );
                        return (
                          <li key={`${type.path}:${type.line}:${type.character}:${index}`}>
                            <button
                              type="button"
                              disabled={status !== "idle"}
                              aria-pressed={selected}
                              onClick={() =>
                                (() => {
                                  setMoveMemberQuery(targetType);
                                  onSetChangeIntent({
                                    operation: "move-member",
                                    targetType,
                                    targetPath: type.path,
                                    targetPosition: {
                                      line: type.line,
                                      character: type.character,
                                    },
                                  });
                                })()
                              }
                              className="w-full rounded border border-[var(--border-default)] px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)]"
                            >
                              {targetType} · {type.path}:{type.line + 1}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {dialog.operation === "batch-cleanup" ? (
                <JavaBatchCleanupFields target={dialog.target} intent={intent} disabled={status !== "idle"}
                  onChange={onSetChangeIntent} onTarget={onSetTarget} searchFiles={searchCleanupFiles}
                  projectPath={projectPath} workspaceGeneration={workspaceGeneration} />
              ) : null}
              {intentFields(dialog.operation).map(({ key, label }) => (
                <label className="contents" key={key}>
                  <span className="text-[var(--text-secondary)]">{label}</span>
                  <input
                    disabled={status !== "idle"}
                    value={intentValue(intent, key)}
                    onChange={(event) =>
                      onSetChangeIntent(
                        updateIntent(dialog.operation, intent, key, event.target.value),
                      )
                    }
                    className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                  />
                </label>
              ))}
              {signatureScopeOffered(dialog.operation) && (
                <fieldset className="col-span-2 flex flex-col gap-2" disabled={status !== "idle"}>
                  <legend>API scope</legend>
                  {([
                    ["includeHierarchy", "Update the source override hierarchy"],
                    ["acceptExternalConsumerRisk", "I accept the risk to callers outside this workspace"],
                  ] as const).map(([key, label]) => (
                    <label key={key}>
                      <input type="checkbox" checked={signatureIntent(intent) && intent[key] === true}
                        onChange={event => {
                          const first = intentFields(dialog.operation)[0]!;
                          const updated = updateIntent(dialog.operation, intent, first.key, intentValue(intent, first.key));
                          if (signatureIntent(updated)) onSetChangeIntent({ ...updated, [key]: event.target.checked });
                        }} />{" "}{label}
                    </label>
                  ))}
                  <p className="text-xs text-[var(--text-secondary)]">
                    RefactorKit must resolve the complete editable source hierarchy. Calls outside
                    this workspace cannot be updated and may stop compiling. Hierarchy changes
                    require explicit risk acceptance; review every affected declaration and call.
                  </p>
                </fieldset>
              )}
              {dialog.operation === "add-method-parameter" && (
                <fieldset className="col-span-2 flex flex-col gap-2" disabled={status !== "idle"}>
                  <legend>Method and constructor references</legend>
                  <label>
                    <input type="checkbox" checked={intent?.operation === "add-method-parameter" && intent.migrateFunctionalReferences === true}
                      onChange={event => {
                        const updated = updateIntent("add-method-parameter", intent, "parameterType", intentValue(intent, "parameterType"));
                        if (updated?.operation === "add-method-parameter") onSetChangeIntent({ ...updated, migrateFunctionalReferences: event.target.checked });
                      }} />{" "}
                    {thisMethodReferenceMigration
                      ? "Adapt supported method and constructor references to lambdas"
                      : "Adapt supported static method and constructor references to lambdas"}
                  </label>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {thisMethodReferenceMigration
                      ? "RefactorKit can also adapt supported this::method references to private methods."
                      : "RefactorKit can adapt supported static method and constructor references."}{" "}
                    Review the generated lambdas and calls before Apply. Combined hierarchy migration is unavailable.
                  </p>
                </fieldset>
              )}
              {targetModuleSelectionAvailable && targetModules.length > 0 && (
                <label className="contents">
                  <span className="text-[var(--text-secondary)]">Destination module</span>
                  <select
                    aria-label="Destination module"
                    disabled={status !== "idle"}
                    value={intentValue(intent, "targetModuleId")}
                    onChange={(event) =>
                      onSetChangeIntent(
                        updateIntent("move-class", intent, "targetModuleId", event.target.value),
                      )
                    }
                    className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                  >
                    <option value="">Automatic (source module or existing package)</option>
                    {targetModules.map((module) => (
                      <option key={module.id} value={module.id}>
                        {module.name} ({module.id}) · {module.root}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {dialog.operation === "move-class" && (
              <p className="text-xs text-[var(--text-secondary)]">
                {targetModuleSelectionMessage}
              </p>
            )}
            {dialog.operation === "change-method-signature" && (
              <p className="text-xs text-[var(--text-secondary)]">
                This operation renames one existing parameter.
              </p>
            )}
            {dialog.operation === "add-method-parameter" && (
              <p className="text-xs text-[var(--text-secondary)]">
                RefactorKit binds the cursor to one saved Java method and updates its exact
                in-workspace invocations. Existing calls use the value entered above.
              </p>
            )}
            {dialog.operation === "remove-method-parameter" && (
              <p className="text-xs text-[var(--text-secondary)]">
                RefactorKit checks the saved method and its bound call sites. It refuses parameters
                used in the method body. Public or protected methods require explicit API scope
                and external-consumer risk choices; unsupported closures remain refused.
              </p>
            )}
            {dialog.operation === "change-field-type" && (
              <p className="text-xs text-[var(--text-secondary)]">
                RefactorKit checks the selected field and its uses. The current provider supports
                changing one private mutable int field to long; unsupported declarations or new
                compilation errors refuse Apply. Review the diff before applying.
              </p>
            )}
            {dialog.operation === "make-public" && (
              <p className="text-xs text-[var(--text-secondary)]">
                This action promotes the cursor-selected method to public. RefactorKit applies it
                only when the JDT binding, source context and override constraints are complete.
              </p>
            )}
            {dialog.operation === "change-method-parameter-type" && (
              <p className="text-xs text-[var(--text-secondary)]">
                RefactorKit resolves the saved method and its applicable source hierarchy. It
                refuses changes when the selected project context cannot prove a safe plan.
              </p>
            )}
            {dialog.operation === "reorder-method-parameters" && (
              <p className="text-xs text-[var(--text-secondary)]">
                Enter every parameter name once in the desired order, separated by commas.
                RefactorKit refuses call sites whose arguments could change evaluation behavior.
              </p>
            )}
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[9rem_1fr]">
              <dt>Workspace</dt>
              <dd className="font-mono">{dialog.selection?.workspaceId ?? "Not authorized"}</dd>
              <dt>Workspace generation</dt>
              <dd className="font-mono">{dialog.selection?.workspaceGeneration ?? "—"}</dd>
            </dl>
          </Section>

          {status === "idle" && selectedExpression !== undefined && (
            <Section
              title={
                dialog.operation === "extract-method"
                  ? "Selected Java statements"
                  : "Selected Java expression"
              }
            >
              <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all text-xs">
                {selectedExpression.length > 240
                  ? `${selectedExpression.slice(0, 240)}…`
                  : selectedExpression}
              </code>
            </Section>
          )}

          {(status === "idle" ||
            status === "preview" ||
            status === "applied" ||
            status === "undone" ||
            status === "rolled-back") &&
            dialog.message && <Notice tone="error">{dialog.message}</Notice>}

          {status === "idle" && !offeredOperations.has(dialog.operation) && (
            <Notice tone="warning">
              This operation is unavailable for the current RefactorKit context. Synchronize the
              selected Java project or save open edits before previewing it.
            </Notice>
          )}
          {status === "idle" &&
            offeredOperations.has(dialog.operation) &&
            !applicableOperationSet.has(dialog.operation) && (
              <Notice tone="info">
                {dialog.operation === "safe-delete"
                  ? "Safe delete is preview-only until RefactorKit advertises complete project-wide reference analysis, including build and resource files."
                  : "RefactorKit advertises preview for this operation, but not managed Apply authority for the current context."}
              </Notice>
            )}
          {status === "preview" && !applyAuthorityAvailable && (
            <Notice tone="warning">
              {dialog.operation === "safe-delete"
                ? "Apply is unavailable until RefactorKit advertises complete project-wide reference analysis, including build and resource files."
                : "Apply is unavailable because the current operation or plan lacks managed mutation authority or has provider-reported blockers."}
            </Notice>
          )}

          {status === "loading" && (
            <Notice tone="info">Generating a read-only RefactorKit preview…</Notice>
          )}
          {status === "unavailable" && (
            <Notice tone="warning">
              RefactorKit general Java refactoring is unavailable. {dialog.message}
            </Notice>
          )}
          {status === "refused" && (
            <Notice tone="error">
              <p>RefactorKit refused this refactoring. No changes can be applied.</p>
              {dialog.message && <p className="mt-1">{dialog.message}</p>}
            </Notice>
          )}
          {status === "applying" && (
            <Notice tone="info">Applying the approved refactoring transaction…</Notice>
          )}
          {(status === "error" || status === "rollback-refused") && (
            <Notice tone="error">
              <p>{dialog.message ?? "The refactoring could not be completed."}</p>
              {bannerReasons.length > 0 && (
                <div className="mt-2">
                  <TextList items={bannerReasons} />
                </div>
              )}
            </Notice>
          )}
          {status === "applied" && (
            <Notice tone="success">
              {dialog.editorTransaction
                ? "Java drafts transformed without saving their content."
                : "Refactoring applied successfully."}{" "}
              Transaction:{" "}
              <code className="font-mono">
                {dialog.editorTransaction?.transactionId ?? result?.transactionId ?? "Unavailable"}
              </code>
            </Notice>
          )}
          {status === "undone" && (
            <Notice tone="success">
              Original Java drafts restored without saving their content.
            </Notice>
          )}
          {status === "rolled-back" && (
            <Notice tone="success">
              Refactoring rolled back. Transaction:{" "}
              <code className="font-mono">{dialog.rollback?.transactionId ?? "Unavailable"}</code>
            </Notice>
          )}

          {plan && (
            <>
              <Section title="Plan and evidence">
                <p className="text-sm">{plan.summary}</p>
                <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                  <dt>Plan</dt>
                  <dd className="font-mono">{plan.planId}</dd>
                  <dt>Status</dt>
                  <dd>{plan.status}</dd>
                  <dt>Confidence</dt>
                  <dd>{plan.editorPreview ? "Not reported by provider" : plan.confidence}</dd>
                  <dt>Risk</dt>
                  <dd>{plan.riskLevel}</dd>
                  <dt>Provider</dt>
                  <dd>
                    {plan.provider}
                    {plan.providerVersion ? ` ${plan.providerVersion}` : ""}
                  </dd>
                </dl>
                {plan.evidence.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">
                    No evidence returned by provider
                  </p>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {plan.evidence.map((evidence, index) => (
                      <li
                        key={`${index}-${evidence.kind}-${evidence.path ?? ""}`}
                        className="rounded bg-[var(--surface-background)] p-2"
                      >
                        <p>
                          <strong>{evidence.kind}</strong>: {evidence.summary}
                        </p>
                        {evidence.path && (
                          <p>
                            File: <code className="break-all">{evidence.path}</code>
                          </p>
                        )}
                        {evidence.detail && (
                          <p className="whitespace-pre-wrap break-words">{evidence.detail}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-[var(--text-muted)]">
                  Preview is read-only and grants no apply authority.
                </p>
              </Section>

              {plan.referenceAnalysis && (
                <Section title="Reference analysis">
                  <p className="text-xs">{referenceAnalysisSummary}</p>
                  {plan.referenceAnalysis.schemaVersion === "java-safe-delete-reference-analysis-v1" ? (
                    <p className="text-xs">
                      Scope: captured workspace text files. This does not establish complete project
                      reference closure. Apply authority: none.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs">
                        Scope: <code>{plan.referenceAnalysis.scope}</code>. Project complete: {" "}
                        {plan.referenceAnalysis.completeProject ? "Yes" : "No"}. Managed write
                        authority: {plan.referenceAnalysis.managedWriteAuthority}.
                      </p>
                      {referenceWarnings.length > 0 && (
                        <TextList items={referenceWarnings} />
                      )}
                      {plan.referenceAnalysis.references.length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)]">No typed references returned</p>
                      ) : (
                        <ul aria-label="Typed references" className="space-y-1 text-xs">
                          {plan.referenceAnalysis.references.map((reference, index) => {
                            const { start, end } = reference.location.range;
                            const sourceRange = `${reference.location.path}:${start.line + 1}:${start.character + 1}–${end.line + 1}:${end.character + 1}`;
                            return (
                              <li
                                key={`${reference.location.path}-${start.line}-${start.character}-${index}`}
                                className="break-words"
                              >
                                <strong>
                                  {reference.targetOwner}.{reference.targetMember}
                                </strong>{" "}
                                <span>
                                  ({reference.provenance}, {reference.completeness.toLowerCase()})
                                </span>{" "}
                                {onOpenReference &&
                                status === "preview" &&
                                !plan.staleness.stale &&
                                !plan.editorPreview ? (
                                  <button
                                    type="button"
                                    title="Open in editor and close preview"
                                    className="text-left underline"
                                    onClick={() => onOpenReference(plan, reference.location)}
                                  >
                                    <code>{sourceRange}</code>
                                  </button>
                                ) : (
                                  <code>{sourceRange}</code>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  )}
                </Section>
              )}

              <Section title="Affected files">
                {plan.affectedFiles.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">No affected files returned</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {plan.affectedFiles.map((file) => (
                      <li key={`${file.change}-${file.path}`} className="flex flex-wrap gap-2">
                        <span className="uppercase">{file.change}</span>
                        <code className="break-all">{file.path}</code>
                        {file.previousPath && (
                          <span>
                            from <code>{file.previousPath}</code>
                          </span>
                        )}
                        {file.primary && (
                          <strong className="rounded bg-[var(--badge-bg)] px-1 text-[var(--badge-text)]">
                            Primary file
                          </strong>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {result?.primaryFile && (
                  <p className="text-xs">
                    Applied primary file: <code>{result.primaryFile}</code>
                  </p>
                )}
              </Section>

              <Section title="Diff">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--surface-background)] p-3 text-xs">
                  {plan.renderedDiff || "No rendered diff returned"}
                </pre>
                {plan.structuredDiff.map((diff) => (
                  <div key={`${diff.change}-${diff.path}`} className="space-y-1">
                    <p className="text-xs font-medium">
                      {diff.change.toUpperCase()} <code>{diff.path}</code>
                    </p>
                    {diff.hunks.map((hunk, index) => (
                      <pre
                        key={`${index}-${hunk.oldStart}-${hunk.newStart}`}
                        className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-background)] p-2 text-xs"
                      >{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join("\n")}`}</pre>
                    ))}
                  </div>
                ))}
              </Section>

              <Section title="Risks">
                <TextList items={plan.risks} empty="No explicit risks returned" />
              </Section>
              {(otherWarnings.length > 0 || referenceWarnings.length === 0 || dialog.operation === "format-file" || plan.formatterProfileName) && (
                <Section title="Warnings">
                  {(dialog.operation === "format-file" || plan.formatterProfileName) && (
                    <p
                      role="note"
                      className="mb-2 rounded border border-[var(--border-default)] bg-[var(--surface-background)] p-2 text-xs"
                    >
                      {plan.formatterProfilePath && plan.formatterProfileName
                        ? `RefactorKit used the workspace Eclipse formatter profile “${plan.formatterProfileName}” from ${plan.formatterProfilePath}.`
                        : "No workspace Eclipse formatter profile was selected for this preview. RefactorKit used project preferences or its default; compare the diff with the workspace style before applying."}
                    </p>
                  )}
                  <TextList items={otherWarnings} empty="No warnings returned" />
                </Section>
              )}
              <Section title="Diagnostics">
                <Diagnostics diagnostics={plan.diagnosticsAfterPreview} />
                {result && (
                  <>
                    <h4 className="text-xs font-semibold">After apply</h4>
                    <Diagnostics diagnostics={result.diagnostics} />
                  </>
                )}
              </Section>
              <Section title="Conflicts">
                <TextList
                  items={plan.conflicts.map(
                    (item) => `${item.kind}: ${item.summary}${item.path ? ` — ${item.path}` : ""}`,
                  )}
                />
              </Section>
              <Section title="Refusal reasons">
                <TextList items={plan.refusalReasons} />
              </Section>
              <Section title="Apply eligibility">
                <p className="text-xs">
                  Backend eligible: {plan.applyEligibility.eligible ? "Yes" : "No"}
                </p>
                <TextList items={plan.applyEligibility.blockers} />
              </Section>
              <Section title="Staleness">
                <p className="text-xs">Stale: {plan.staleness.stale ? "Yes" : "No"}</p>
                <TextList items={plan.staleness.reasons} />
              </Section>
            </>
          )}

          {(status === "applied" || status === "rollback-refused") && result && !plan && (
            <Section title="Applied transaction">
              <p className="text-xs">
                Transaction ID: <code>{result.transactionId ?? "None returned"}</code>
              </p>
              <p className="text-xs">
                Primary file: <code>{result.primaryFile ?? "None returned"}</code>
              </p>
              <Diagnostics diagnostics={result.diagnostics} />
            </Section>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <button
            type="button"
            className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-default)]"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={status !== "idle" || !offeredOperations.has(dialog.operation)}
            className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-default)]"
            onClick={onPreview}
          >
            Preview
          </button>
          <button
            type="button"
            disabled={status !== "preview" || !plan || !canApply(plan) || !applyAuthorityAvailable}
            className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-default)]"
            onClick={() => {
              if (status === "preview" && plan && canApply(plan) && applyAuthorityAvailable)
                onApply(plan);
            }}
          >
            Apply
          </button>
          {dialog.editorTransaction ? (
            <button
              type="button"
              disabled={
                status !== "applied" ||
                dialog.editorTransaction.status !== "applied" ||
                !onUndoEditor
              }
              className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs border border-[var(--border-default)]"
              onClick={onUndoEditor}
            >
              Undo
            </button>
          ) : (
            <button
              type="button"
              disabled={(status !== "applied" && status !== "rollback-refused") || !result?.transactionId || !rollbackAdvertised}
              className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-default)]"
              onClick={() => {
                if ((status === "applied" || status === "rollback-refused") && result) onRollback(result);
              }}
            >
              {status === "rollback-refused" ? "Retry Rollback" : "Rollback"}
            </button>
          )}
          {status === "error" && dialog.editorTransaction && (
            <button
              type="button"
              onClick={onRecoverEditor}
              disabled={!onRecoverEditor}
              className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs border border-[var(--border-default)]"
            >
              Restore original drafts
            </button>
          )}
          <button
            type="button"
            disabled={status !== "preview" && status !== "loading" && status !== "applying"}
            className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-default)]"
            onClick={onDiscard}
          >
            Discard
          </button>
          {status === "applied" && !dialog.editorTransaction && !rollbackAdvertised && (
            <span className="flex items-center text-xs text-[var(--text-muted)]">
              Rollback unavailable: {JAVA_REFACTORING_UNAVAILABLE}
            </span>
          )}
          {status === "refused" && dialog.message === JAVA_REFACTORING_OPERATION_NOT_OFFERED && (
            <span className="flex items-center text-xs text-[var(--text-muted)]">
              Operation not offered: {JAVA_REFACTORING_OPERATION_NOT_OFFERED}
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
