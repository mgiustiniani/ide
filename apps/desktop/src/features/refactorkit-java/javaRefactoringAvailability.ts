import type {
  RefactorKitCapabilities,
  RefactoringOperation,
  RefactoringTarget,
} from "@ide/contracts";
import {
  javaContextRefactoringOffered,
  javaEditorRefactoringPreviewOffered,
  javaEditorMutationOffered,
  javaRefactoringMutationAuthorized,
  javaMutationSelectionOffered,
} from "@ide/contracts";

export const JAVA_REFACTORING_OPERATIONS: readonly RefactoringOperation[] = [
  "create-maven-module",
  "create-gradle-module",
  "rename-gradle-module",
  "rename-class",
  "rename-member",
  "rename-local-variable",
  "move-class",
  "move-package",
  "move-source-root",
  "change-method-signature",
  "change-method-parameter-type",
  "add-method-parameter",
  "remove-method-parameter",
  "reorder-method-parameters",
  "make-static",
  "make-public",
  "change-field-type",
  "inline-variable",
  "inline-method",
  "introduce-parameter-object",
  "extract-delegate",
  "inline-constant",
  "extract-constant",
  "extract-variable",
  "extract-method",
  "extract-parameter",
  "extract-field",
  "extract-interface",
  "extract-superclass",
  "pull-up-member",
  "push-down-member",
  "move-member",
  "encapsulate-field",
  "safe-delete",
  "format-file",
  "organize-imports",
  "batch-cleanup",
];

const JAVA_FILE_LOCAL_OPERATIONS: readonly RefactoringOperation[] = [
  "format-file",
  "organize-imports",
];

const JAVA_SAVED_EXTRACTION_OPERATIONS = new Set<RefactoringOperation>([
  "extract-constant",
  "extract-variable",
  "extract-method",
  "extract-parameter",
  "extract-field",
]);

/** The shared refactoring contract binds each operation to the kind of declaration it changes. */
export function javaRefactoringTargetKind(
  operation: RefactoringOperation,
): RefactoringTarget["kind"] {
  switch (operation) {
    case "create-maven-module":
    case "create-gradle-module":
    case "rename-gradle-module":
      return "file";
    case "rename-class":
    case "move-class":
    case "extract-interface":
    case "extract-superclass":
    case "safe-delete":
      return "class";
    case "move-package":
      return "package";
    case "rename-member":
    case "change-method-signature":
    case "change-method-parameter-type":
    case "add-method-parameter":
    case "remove-method-parameter":
    case "reorder-method-parameters":
    case "make-static":
    case "make-public":
    case "change-field-type":
    case "inline-method":
    case "extract-delegate":
    case "introduce-parameter-object":
    case "pull-up-member":
    case "push-down-member":
    case "move-member":
      return "member";
    case "inline-variable":
      return "local-binding";
    case "inline-constant":
      return "member";
    case "encapsulate-field":
      return "member";
    case "rename-local-variable":
      return "local-binding";
    case "move-source-root":
      return "source-root";
    case "batch-cleanup":
    case "format-file":
    case "organize-imports":
    case "extract-constant":
    case "extract-variable":
    case "extract-method":
    case "extract-parameter":
    case "extract-field":
      return "file";
  }
}

export function supportsJavaRefactoringTarget(
  operation: RefactoringOperation,
  targetKind: RefactoringTarget["kind"],
): boolean {
  return javaRefactoringTargetKind(operation) === targetKind;
}

export interface JavaRefactoringAvailabilityOptions {
  capabilities: RefactorKitCapabilities | null;
  sdkSelected: boolean;
  projectContextAvailable: boolean;
  javaWorkspaceSymbolsAvailable?: boolean;
  partialMavenProjectContextAvailable?: boolean;
  partialGradleProjectContextAvailable?: boolean;
  projectPath: string;
  dirtyPaths: readonly string[];
  editorSelection: boolean;
}

function belongsToProject(sourcePath: string, projectPath: string): boolean {
  const source = sourcePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const project = projectPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  return !project || project === "." || source.startsWith(`${project}/`);
}

/** Returns only preview operations the selected provider route currently advertises. */
export function availableJavaRefactoringOperations(
  options: JavaRefactoringAvailabilityOptions,
): RefactoringOperation[] {
  const { capabilities, sdkSelected, projectContextAvailable } = options;
  if (!capabilities) return [];

  if (!sdkSelected) {
    const general = capabilities.generalRefactoring;
    if (!general?.supported || !general.preview || options.dirtyPaths.length > 0) return [];
    return JAVA_REFACTORING_OPERATIONS.filter(
      (operation) =>
        operation !== "batch-cleanup" &&
        operation !== "create-maven-module" &&
        operation !== "create-gradle-module" && operation !== "rename-gradle-module" &&
        operation !== "move-package" &&
        operation !== "add-method-parameter" &&
        operation !== "remove-method-parameter" &&
        operation !== "change-method-signature" &&
        operation !== "change-method-parameter-type" &&
        operation !== "reorder-method-parameters" &&
        operation !== "make-static" &&
        operation !== "make-public" &&
        operation !== "change-field-type" &&
        operation !== "inline-variable" &&
        operation !== "inline-method" &&
        operation !== "introduce-parameter-object" &&
        operation !== "extract-delegate" &&
        operation !== "inline-constant" &&
        operation !== "extract-constant" &&
        operation !== "extract-variable" &&
        operation !== "extract-method" &&
        operation !== "extract-parameter" &&
        operation !== "extract-field" &&
        operation !== "extract-interface" &&
        operation !== "extract-superclass" &&
        operation !== "pull-up-member" &&
        operation !== "push-down-member" &&
        operation !== "move-member" &&
        operation !== "encapsulate-field" &&
        general.operations.includes(operation),
    );
  }

  const contextOperations = JAVA_REFACTORING_OPERATIONS.filter((operation) => {
    const operationContextAvailable =
      projectContextAvailable ||
      (operation === "create-maven-module" &&
        options.partialMavenProjectContextAvailable === true) ||
      ((operation === "create-gradle-module" || operation === "rename-gradle-module") &&
        options.partialGradleProjectContextAvailable === true);
    if (!operationContextAvailable) return false;
    if (operation === "batch-cleanup")
      return options.dirtyPaths.length === 0 && javaContextRefactoringOffered(capabilities, operation, "preview");
    if (JAVA_SAVED_EXTRACTION_OPERATIONS.has(operation))
      return options.editorSelection &&
        options.dirtyPaths.length === 0 &&
        javaContextRefactoringOffered(capabilities, operation, "preview");
    if (operation === "move-member")
      return (
        options.javaWorkspaceSymbolsAvailable === true &&
        options.editorSelection &&
        options.dirtyPaths.length === 0 &&
        javaMutationSelectionOffered(capabilities) &&
        javaContextRefactoringOffered(capabilities, operation, "preview")
      );
    return operation === "extract-interface" ||
      operation === "extract-superclass" ||
      operation === "pull-up-member" ||
      operation === "push-down-member" ||
      operation === "inline-method" ||
      operation === "introduce-parameter-object" ||
      operation === "extract-delegate"
      ? options.editorSelection &&
          options.dirtyPaths.length === 0 &&
          javaMutationSelectionOffered(capabilities) &&
          javaContextRefactoringOffered(capabilities, operation, "preview")
      : operation === "inline-variable" || operation === "inline-constant"
          ? options.editorSelection &&
            options.dirtyPaths.length === 0 &&
            javaContextRefactoringOffered(capabilities, operation, "preview")
          : operation === "create-maven-module" || (operation === "create-gradle-module" || operation === "rename-gradle-module")
            ? javaContextRefactoringOffered(capabilities, operation, "preview")
            : operation === "add-method-parameter" ||
                operation === "remove-method-parameter" ||
                operation === "change-method-signature" ||
                operation === "change-method-parameter-type" ||
                (operation === "reorder-method-parameters" && options.editorSelection) ||
                operation === "make-static" ||
                (operation === "make-public" || operation === "change-field-type")
              ? options.editorSelection &&
                options.dirtyPaths.length === 0 &&
                javaMutationSelectionOffered(capabilities) &&
                javaContextRefactoringOffered(capabilities, operation, "preview")
              : requiresEditorPreview(options)
                ? javaEditorRefactoringPreviewOffered(capabilities, operation)
                : javaContextRefactoringOffered(capabilities, operation, "preview");
  });
  const general = capabilities.generalRefactoring;
  if (!general?.supported || !general.preview || options.dirtyPaths.length > 0)
    return contextOperations;
  const fileLocalFallbacks = JAVA_FILE_LOCAL_OPERATIONS.filter(
    (operation) => !contextOperations.includes(operation) && general.operations.includes(operation),
  );
  return [...contextOperations, ...fileLocalFallbacks];
}

/** Returns operations whose current route advertises managed Apply authority. */
export function applicableJavaRefactoringOperations(
  options: JavaRefactoringAvailabilityOptions,
): RefactoringOperation[] {
  const { capabilities, sdkSelected, projectContextAvailable } = options;
  return availableJavaRefactoringOperations(options).filter((operation) => {
    if (!capabilities) return false;
    if (
      (operation === "create-maven-module" || (operation === "create-gradle-module" || operation === "rename-gradle-module")) &&
      options.dirtyPaths.length > 0
    )
      return false;
    const projectContextRoute =
      sdkSelected &&
      (projectContextAvailable ||
        (operation === "create-maven-module" &&
          options.partialMavenProjectContextAvailable === true) ||
        ((operation === "create-gradle-module" || operation === "rename-gradle-module") &&
          options.partialGradleProjectContextAvailable === true)) &&
      javaContextRefactoringOffered(capabilities, operation, "preview");
    if (!projectContextRoute) {
      const general = capabilities.generalRefactoring;
      return Boolean(
        general?.apply &&
        general.operations.includes(operation) &&
        javaRefactoringMutationAuthorized(capabilities, operation),
      );
    }
    if (
      !JAVA_SAVED_EXTRACTION_OPERATIONS.has(operation) &&
      operation !== "batch-cleanup" &&
      operation !== "create-maven-module" &&
      operation !== "create-gradle-module" && operation !== "rename-gradle-module" &&
      operation !== "extract-interface" &&
      operation !== "extract-superclass" &&
      operation !== "pull-up-member" &&
      operation !== "push-down-member" &&
      operation !== "move-member" &&
      operation !== "add-method-parameter" &&
      operation !== "remove-method-parameter" &&
      operation !== "change-method-signature" &&
      operation !== "change-method-parameter-type" &&
      !(operation === "reorder-method-parameters" && options.editorSelection) &&
      !(operation === "make-static" && options.editorSelection) &&
      !((operation === "make-public" || operation === "change-field-type") && options.editorSelection) &&
      operation !== "inline-variable" &&
      operation !== "inline-method" &&
      operation !== "introduce-parameter-object" &&
      operation !== "extract-delegate" &&
      operation !== "inline-constant" &&
      requiresEditorPreview(options)
    )
      return javaEditorMutationOffered(capabilities, operation);
    return javaContextRefactoringOffered(capabilities, operation, "apply");
  });
}

function requiresEditorPreview(options: JavaRefactoringAvailabilityOptions): boolean {
  return (
    options.editorSelection ||
    options.dirtyPaths.some(
      (path) => path.endsWith(".java") && belongsToProject(path, options.projectPath),
    )
  );
}
