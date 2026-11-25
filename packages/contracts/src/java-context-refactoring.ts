import type { RefactorKitCapabilities, RefactoringOperation } from "./refactorkit";

/** Public daemon operations corresponding to the IDE's Java actions. */
export function javaContextRefactoringOperation(
  operation: RefactoringOperation,
): string | undefined {
  switch (operation) {
    case "create-maven-module":
      return "java.createMavenModule";
    case "create-gradle-module":
      return "java.createGradleModule";
    case "rename-gradle-module":
      return "java.renameGradleModule";
    case "rename-class":
      return "renameClass";
    case "rename-member":
      return "renameMember";
    case "move-class":
      return "moveClass";
    case "move-member":
      return "moveMember";
    case "move-package":
      return "movePackage";
    case "move-source-root":
      return "moveSourceRoot";
    case "change-method-signature":
      return "changeSignature.renameParameter";
    case "change-method-parameter-type":
      return "changeSignature.changeParameterType";
    case "add-method-parameter":
      return "changeSignature.addParameter";
    case "remove-method-parameter":
      return "changeSignature.removeParameter";
    case "reorder-method-parameters":
      return "changeSignature.reorderParameters";
    case "make-static":
      return "makeStatic";
    case "make-public":
      return "changeVisibility";
    case "change-field-type":
      return "changeType";
    case "inline-variable":
      return "inlineVariable";
    case "inline-method":
      return "inlineMethod";
    case "introduce-parameter-object":
      return "introduceParameterObject";
    case "extract-delegate":
      return "extractDelegate";
    case "inline-constant":
      return "inlineConstant";
    case "extract-constant":
      return "extractConstant";
    case "extract-variable":
      return "extractVariable";
    case "extract-method":
      return "extractMethod";
    case "extract-parameter":
      return "extractParameter";
    case "extract-field":
      return "extractField";
    case "extract-interface":
      return "extractInterface";
    case "extract-superclass":
      return "extractSuperclass";
    case "pull-up-member":
      return "pullUpMember";
    case "push-down-member":
      return "pushDownMember";
    case "encapsulate-field":
      return "encapsulateField";
    case "safe-delete":
      return "safeDelete";
    case "batch-cleanup":
      return "batchCleanup";
    case "format-file":
      return "formatFile";
    case "organize-imports":
      return "organizeImports";
    case "rename-local-variable":
      return undefined;
  }
}

/** Experimental Gradle rename needs its complete bounded structural contract. */
function gradleModuleRenameOffered(
  capabilities: RefactorKitCapabilities | null,
  feature: "preview" | "apply" | "rollback",
): boolean {
  const candidates = capabilities?.methods?.filter(method => method.name === "java.renameGradleModule");
  const method = candidates?.length === 1 ? candidates[0] : undefined;
  return Boolean(capabilities?.apiVersion === "0.2" && method &&
    ["experimental", "preview", "stable"].includes(method.stability) && method.requiresProject && !method.writesWorkspace &&
    ["preview", "renderedDiff", "apply", "rollback", "literalSettingsOnly", "preservePhysicalProjectDirectory",
      "explicitGradleSyncRequired"].every(name => method.features?.[name] === true) &&
    (method.features?.inboundProjectDependenciesRefused === true || literalInboundGradleRename(method.features)) &&
    capabilities.methods?.some(entry => entry.name === "project.context" &&
      entry.features?.javaRefactoringsUseContextAuthority === true && entry.features?.managedMutationAuthority === true) &&
    capabilities.methods?.some(entry => entry.name === (feature === "rollback" ? "patch.rollback" : `refactor.${feature}`) &&
      entry.requiresProject && entry.writesWorkspace === (feature !== "preview")));
}

function literalInboundGradleRename(features: Readonly<Record<string, boolean>> | undefined): boolean {
  return features?.literalInboundProjectDependencies === true &&
    features.unqualifiedInboundProjectDependenciesRefused === true;
}

export function gradleModuleRenameUpdatesLiteralDependencies(capabilities: RefactorKitCapabilities | null): boolean {
  return gradleModuleRenameOffered(capabilities, "preview") &&
    literalInboundGradleRename(capabilities?.methods?.find(method => method.name === "java.renameGradleModule")?.features);
}

export function javaRefactoringMutationAuthorized(
  capabilities: RefactorKitCapabilities | null,
  operation: RefactoringOperation,
): boolean {
  if (operation === "rename-gradle-module") return gradleModuleRenameOffered(capabilities, "apply");
  if (operation === "safe-delete" && !javaSafeDeleteReferenceAnalysisQualified(capabilities))
    return false;
  if (capabilities?.managedJavaMutationOperations?.includes(operation)) return true;
  if (operation === "create-maven-module" || operation === "create-gradle-module") {
    const providerName =
      operation === "create-maven-module" ? "java.createMavenModule" : "java.createGradleModule";
    const method = capabilities?.methods?.filter(
      (entry) => entry.name === providerName,
    );
    return Boolean(
      method?.length === 1 &&
      method[0].stability === "stable" &&
      method[0].requiresProject &&
      method[0].features?.apply === true &&
      method[0].features?.rollback === true &&
      (operation !== "create-gradle-module" ||
        (method[0].features?.preview === true &&
          method[0].features?.renderedDiff === true &&
          method[0].features?.workspaceRelativeBuildRoot === true &&
          method[0].features?.canonicalNestedProjectPath === true &&
          method[0].features?.settingsInferredDsl === true)),
    );
  }
  return javaLanguageKernelMutationAuthorized(capabilities, operation);
}

/** A successful Java-only search is insufficient authority to remove a project type. */
export function javaSafeDeleteReferenceAnalysisQualified(
  capabilities: RefactorKitCapabilities | null,
): boolean {
  if (
    capabilities?.javaContextRefactoring?.operationCapabilities?.some(
      (entry) =>
        entry.operation === "safeDelete" &&
        entry.referenceAnalysis?.managedApplyAuthority === "none" &&
        entry.referenceAnalysis.completeProject === false,
    )
  )
    return false;
  return capabilities?.safeDeleteReferenceAnalysis === "complete-project";
}

function javaLanguageKernelMutationAuthorized(
  capabilities: RefactorKitCapabilities | null,
  operation: RefactoringOperation,
): boolean {
  const providerOperation = javaContextRefactoringOperation(operation);
  if (!providerOperation) return false;
  const languageKernel = capabilities?.languageKernel;
  if (!languageKernel?.available || !languageKernel.schema) return false;
  const java = languageKernel.schema.adapters.find((adapter) => adapter.languageId === "java");
  const metadata = java?.capabilities.find(
    (capability) => capability.operation === providerOperation,
  );
  return Boolean(
    metadata?.stability === "stable" &&
    metadata.mutationAuthority === "managed-stable" &&
    metadata.evidence !== "lexical" &&
    metadata.evidence !== "none",
  );
}

export function javaContextRefactoringOffered(
  capabilities: RefactorKitCapabilities | null,
  operation: RefactoringOperation,
  feature: "preview" | "apply" | "rollback",
): boolean {
  if (operation === "rename-gradle-module") return gradleModuleRenameOffered(capabilities, feature);
  const advertisement = capabilities?.javaContextRefactoring;
  const providerOperation = javaContextRefactoringOperation(operation);
  const methods = capabilities?.methods;
  if (
    feature === "apply" &&
    operation === "safe-delete" &&
    !javaSafeDeleteReferenceAnalysisQualified(capabilities)
  )
    return false;
  if (operation === "create-maven-module" || operation === "create-gradle-module") {
    const providerName =
      operation === "create-maven-module" ? "java.createMavenModule" : "java.createGradleModule";
    const candidates = methods?.filter((method) => method.name === providerName);
    const method = candidates?.length === 1 ? candidates[0] : undefined;
    const featureOffered =
      method?.stability === "stable" &&
      method.requiresProject &&
      method.features?.preview === true &&
      method.features?.renderedDiff === true &&
      method.features?.apply === true &&
      method.features?.rollback === true &&
      (operation !== "create-gradle-module" ||
        (method.features?.workspaceRelativeBuildRoot === true &&
          method.features?.canonicalNestedProjectPath === true &&
          method.features?.settingsInferredDsl === true));
    return Boolean(
      capabilities?.apiVersion === "0.2" &&
      featureOffered &&
      methods?.some(
        (entry) =>
          entry.name === "project.context" &&
          entry.features?.javaRefactoringsUseContextAuthority === true &&
          entry.features?.managedMutationAuthority === true,
      ) &&
      methods?.some(
        (entry) =>
          entry.name === (feature === "rollback" ? "patch.rollback" : `refactor.${feature}`) &&
          entry.requiresProject &&
          entry.writesWorkspace === (feature !== "preview"),
      ),
    );
  }
  return Boolean(
    advertisement?.schemaVersion === 1 &&
    advertisement.requiresExplicitContext === true &&
    advertisement.sourceAuthority === "saved-snapshot" &&
    advertisement.renderedDiff === true &&
    (feature !== "rollback" || advertisement.rollbackAuthority === true) &&
    providerOperation &&
    advertisement.operations.includes(providerOperation) &&
    methods?.some(
      (method) =>
        method.name === "project.context" &&
        method.features?.javaRefactoringsUseContextAuthority === true &&
        method.features?.managedMutationAuthority === true,
    ) &&
    methods?.some(
      (method) =>
        method.name === (feature === "rollback" ? "patch.rollback" : `refactor.${feature}`) &&
        method.requiresProject &&
        method.writesWorkspace === (feature !== "preview"),
    ) &&
    (feature === "preview" || javaLanguageKernelMutationAuthorized(capabilities, operation)),
  );
}

/** Admission to read-only editor plans is independent of saved-source Apply. */
export function javaEditorRefactoringPreviewOffered(
  capabilities: RefactorKitCapabilities | null,
  operation: RefactoringOperation,
): boolean {
  const providerOperation = javaContextRefactoringOperation(operation);
  const advertisement = capabilities?.javaContextRefactoring;
  return Boolean(
    providerOperation &&
    ["renameClass", "renameMember", "formatFile", "organizeImports"].includes(providerOperation) &&
    advertisement?.dirtyEditorPreview === true &&
    advertisement.editorPreviewMethod === "refactor.editor.preview" &&
    advertisement.editorPreviewSchemaVersion === "java-editor-refactoring-v1" &&
    advertisement.editorSelectionSchemaVersion === "java-editor-mutation-selection-v1" &&
    advertisement.editorPreviewOperations?.includes(providerOperation) &&
    capabilities?.methods?.some(
      (m) => m.name === "refactor.editor.preview" && m.requiresProject && !m.writesWorkspace,
    ) &&
    capabilities.methods.some(
      (m) => m.name === "intelligence.query" && m.requiresProject && !m.writesWorkspace,
    ) &&
    capabilities.methods.some(
      (m) => m.name === "project.context" && m.features?.immutableJavaEditorOverlays === true,
    ),
  );
}

export function javaEditorMutationOffered(
  capabilities: RefactorKitCapabilities | null,
  operation: RefactoringOperation,
): boolean {
  const advertisement = capabilities?.javaContextRefactoring,
    providerOperation = javaContextRefactoringOperation(operation);
  return Boolean(
    javaEditorRefactoringPreviewOffered(capabilities, operation) &&
    advertisement?.dirtyEditorMutationAuthority === true &&
    advertisement.durableEditorRecovery === true &&
    advertisement.editorTransactionSchemaVersion === "java-editor-transaction-v1" &&
    providerOperation &&
    advertisement.editorMutationOperations?.includes(providerOperation) &&
    capabilities?.methods?.some(
      (m) =>
        m.name === "refactor.editor.preview" &&
        m.features?.durableEditorMutationMode === true &&
        m.features?.qualifiedDirtyApply === true,
    ) &&
    ["prepare", "confirm", "undo.prepare", "undo.confirm", "recover", "transactions"].every(
      (phase) =>
        capabilities?.methods?.some(
          (m) =>
            m.name === `refactor.editor.${phase}` &&
            m.requiresProject &&
            !m.writesWorkspace &&
            m.features?.[phase === "transactions" ? "durableDiscovery" : "durableRecovery"] ===
              true,
        ),
    ),
  );
}

/** Saved-source compiler selection, separate from the immutable draft overlay route. */
export function javaMutationSelectionOffered(
  capabilities: RefactorKitCapabilities | null,
): boolean {
  return Boolean(
    capabilities?.javaContextRefactoring?.selectionQueryKind === "mutationSelection" &&
    capabilities.javaContextRefactoring.selectionSchemaVersion === "java-mutation-selection-v1" &&
    capabilities.methods?.some(
      (method) =>
        method.name === "intelligence.query" && method.requiresProject && !method.writesWorkspace,
    ),
  );
}

/** True only when RefactorKit advertises the exact target-module argument contract. */
export function javaMoveClassTargetModuleSelectionOffered(
  capabilities: RefactorKitCapabilities | null | undefined,
): boolean {
  const operationCapabilities = capabilities?.javaContextRefactoring?.operationCapabilities;
  const moveClassCapabilities = operationCapabilities?.filter(
    (capability) => capability.operation === "moveClass",
  );
  if (moveClassCapabilities?.length !== 1) return false;
  const advertised = moveClassCapabilities[0]?.targetModuleSelection;
  return Boolean(
    advertised?.schemaVersion === "java-move-class-target-module-v1" &&
      advertised.argument === "targetModuleId" &&
      advertised.identity === "module-id-within-source-provider" &&
      advertised.requiresAvailableContext === true &&
      advertised.sourceSetKind === "main" &&
      advertised.requiresUniqueNonGeneratedRoot === true,
  );
}

export function javaEditorRecoveryOffered(capabilities: RefactorKitCapabilities | null): boolean {
  const advertised = capabilities?.javaContextRefactoring;
  return Boolean(
    advertised?.dirtyEditorMutationAuthority === true &&
    advertised.durableEditorRecovery === true &&
    advertised.editorTransactionSchemaVersion === "java-editor-transaction-v1" &&
    ["transactions", "recover", "undo.confirm"].every((phase) =>
      capabilities?.methods?.some(
        (m) =>
          m.name === `refactor.editor.${phase}` &&
          m.requiresProject &&
          !m.writesWorkspace &&
          m.features?.[phase === "transactions" ? "durableDiscovery" : "durableRecovery"] === true,
      ),
    ),
  );
}
