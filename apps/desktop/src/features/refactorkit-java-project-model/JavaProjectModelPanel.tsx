import type {
  JavaProjectModelClass,
  JavaProjectModelPackage,
  JavaProjectModelSymbol,
  JavaProjectModelController,
} from "./useJavaProjectModelController";
import type { JavaProjectContextController } from "./useJavaProjectContextController";
import type { JavaProjectTextSearchController } from "./useJavaProjectTextSearchController";
import type {
  JavaProjectContextAuthority,
  JavaSavedSourceRecoveryRequest,
  RefactorKitAffectedFile,
  RefactorKitCapabilities,
} from "@ide/contracts";
import type { JavaProjectPathPickerPort, JavaProjectScaffoldPort, JavaProjectDeclarationPort } from "@ide/web-core";
import type { RefactorKitPort } from "@ide/web-core/ports";
import type { MavenModuleRenameTransactionState } from "./MavenModuleRenamePreview";
import { JavaProjectContextPanel } from "./JavaProjectContextPanel";

export interface JavaProjectModelLocation {
  readonly path: string;
  readonly line: number;
  readonly column?: number;
}

export type JavaProjectModelTypeOperation = "move-class" | "safe-delete";

/**
 * Desktop-only read-only presentation of the RefactorKit engine project model.
 * Shows the availability state (available/unavailable/error) and a read-only
 * packages/classes/symbols structure listing. Type and symbol locations open
 * through the shared Java navigation path when the desktop supplies a handler.
 */
export function JavaProjectModelPanel({
  controller,
  contextController,
  suggestedSdkHome,
  gradleImportEnabled,
  onGradleImportAuthorizationChange,
  onOpenGradleTerminal,
  onOpenGradlePreparation,
  onOpenMavenVerification,
  onRecoverSavedSources,
  isWriting,
  onOpenTransactions,
  onNavigateLocation,
  canRefactorType,
  onRefactorType,
  canEncapsulateField,
  onEncapsulateField,
  canRefactorPackage,
  onRefactorPackage,
  canMoveSourceRoot,
  onMoveSourceRoot,
  onRevealGeneratedSourceRoot,
  workspaceId,
  generation,
  workspaceRootPath,
  scaffoldPort,
  declarationPort,
  onDeclarationCreated,
  pathPicker,
  getWorkspaceContext,
  onProjectCreated,
  searchController,
  searchFocusRequest,
  onSearchFocusRequestHandled,
  refactorKitPort,
  refactorKitCapabilities,
  beginJavaProjectWrite,
  reconcileJavaProjectChanges,
  onMavenModuleRenameSourceChanged,
  mavenModuleRenameTransaction,
  onCreateMavenModule,
  onCreateGradleModule,
  onRenameGradleModule,
}: {
  controller: JavaProjectModelController;
  contextController?: JavaProjectContextController;
  suggestedSdkHome?: string;
  gradleImportEnabled?: boolean;
  onGradleImportAuthorizationChange?(enabled: boolean): void;
  onOpenGradleTerminal?(projectPath: string): void;
  onOpenGradlePreparation?(): void;
  onOpenMavenVerification?(): void;
  onRecoverSavedSources?(request: JavaSavedSourceRecoveryRequest): Promise<void> | undefined;
  isWriting?: boolean;
  onOpenTransactions?(): void;
  onNavigateLocation?(location: JavaProjectModelLocation): void;
  canRefactorType?(operation: JavaProjectModelTypeOperation, type: JavaProjectModelClass): boolean;
  onRefactorType?(operation: JavaProjectModelTypeOperation, type: JavaProjectModelClass): void;
  canEncapsulateField?(symbol: JavaProjectModelSymbol): boolean;
  onEncapsulateField?(symbol: JavaProjectModelSymbol): void;
  canRefactorPackage?(pkg: JavaProjectModelPackage): boolean;
  onRefactorPackage?(pkg: JavaProjectModelPackage): void;
  canMoveSourceRoot?(sourceRoot: string): boolean;
  onMoveSourceRoot?(sourceRoot: string): void;
  onRevealGeneratedSourceRoot?(sourceRoot: string): void;
  workspaceId?: string | null;
  generation?: number;
  workspaceRootPath?: string | null;
  scaffoldPort?: JavaProjectScaffoldPort;
  declarationPort?: JavaProjectDeclarationPort;
  onDeclarationCreated?(path: string, authority: JavaProjectContextAuthority): Promise<void>;
  pathPicker?: JavaProjectPathPickerPort;
  getWorkspaceContext?(): Omit<JavaProjectContextAuthority, "workspaceId"> & {
    workspaceId: string | null;
    isSwitching: boolean;
    isMetadataLoading: boolean;
  };
  onProjectCreated?(path: string, authority: JavaProjectContextAuthority): Promise<void>;
  searchController?: JavaProjectTextSearchController;
  searchFocusRequest?: number;
  onSearchFocusRequestHandled?(request: number): void;
  refactorKitPort?: RefactorKitPort;
  refactorKitCapabilities?: RefactorKitCapabilities | null;
  beginJavaProjectWrite?(): () => void;
  reconcileJavaProjectChanges?(
    changes: readonly RefactorKitAffectedFile[],
    isCurrent: () => boolean,
  ): Promise<string | undefined>;
  onMavenModuleRenameSourceChanged?(): void;
  mavenModuleRenameTransaction?: MavenModuleRenameTransactionState;
  onCreateMavenModule?(parentPomPath: string): void;
  onCreateGradleModule?(buildRoot: string, settingsPath: string): void;
  onRenameGradleModule?(buildRoot: string, settingsPath: string, oldProjectPath: string): void;
}): JSX.Element {
  if (contextController)
    return (
      <JavaProjectContextPanel
        controller={contextController}
        suggestedSdkHome={suggestedSdkHome}
        gradleImportEnabled={gradleImportEnabled}
        onGradleImportAuthorizationChange={onGradleImportAuthorizationChange}
        onOpenGradleTerminal={onOpenGradleTerminal}
        onOpenGradlePreparation={onOpenGradlePreparation}
        onOpenMavenVerification={onOpenMavenVerification}
        onRecoverSavedSources={onRecoverSavedSources}
        isWriting={isWriting}
        onOpenTransactions={onOpenTransactions}
        canMoveSourceRoot={canMoveSourceRoot}
        onMoveSourceRoot={onMoveSourceRoot}
        onRevealGeneratedSourceRoot={onRevealGeneratedSourceRoot}
        searchController={searchController}
        searchFocusRequest={searchFocusRequest}
        onSearchFocusRequestHandled={onSearchFocusRequestHandled}
        onNavigateLocation={onNavigateLocation}
        workspaceId={workspaceId}
        generation={generation}
        workspaceRootPath={workspaceRootPath}
        scaffoldPort={scaffoldPort}
        declarationPort={declarationPort}
        onDeclarationCreated={onDeclarationCreated}
        pathPicker={pathPicker}
        getWorkspaceContext={getWorkspaceContext}
        onProjectCreated={onProjectCreated}
        refactorKitPort={refactorKitPort}
        refactorKitCapabilities={refactorKitCapabilities}
        beginJavaProjectWrite={beginJavaProjectWrite}
        reconcileJavaProjectChanges={reconcileJavaProjectChanges}
        onMavenModuleRenameSourceChanged={onMavenModuleRenameSourceChanged}
        mavenModuleRenameTransaction={mavenModuleRenameTransaction}
        onCreateMavenModule={onCreateMavenModule}
        onCreateGradleModule={onCreateGradleModule}
        onRenameGradleModule={onRenameGradleModule}
      >
        <JavaProjectModelPanel
          controller={controller}
          isWriting={isWriting}
          onNavigateLocation={onNavigateLocation}
          canRefactorType={canRefactorType}
          onRefactorType={onRefactorType}
          canEncapsulateField={canEncapsulateField}
          onEncapsulateField={onEncapsulateField}
          canRefactorPackage={canRefactorPackage}
          onRefactorPackage={onRefactorPackage}
          canMoveSourceRoot={canMoveSourceRoot}
          onMoveSourceRoot={onMoveSourceRoot}
        />
      </JavaProjectContextPanel>
    );
  const {
    availability,
    availabilityReason,
    isBusy,
    error,
    projectRoot,
    model,
    totalSymbolCount,
    presentedSymbolsTruncated,
    refresh,
  } = controller;
  const badge =
    availability === "available" ? "Available" : availability === "error" ? "Error" : "Unavailable";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              availability === "available"
                ? "bg-green-950/40 text-green-100"
                : availability === "error"
                  ? "bg-red-950/40 text-red-100"
                  : "bg-[var(--highlight-bg)] text-[var(--text-secondary)]"
            }`}
          >
            {badge}
          </span>
          {projectRoot ? (
            <span
              className="max-w-[16rem] truncate text-xs text-[var(--text-muted)]"
              title={projectRoot}
            >
              {projectRoot}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-sm px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
          disabled={isBusy}
          onClick={() => {
            void refresh();
          }}
        >
          {isBusy ? "Scanning…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="border-b border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100"
        >
          {error}
        </div>
      ) : null}
      {availability === "unavailable" && availabilityReason ? (
        <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">{availabilityReason}</div>
      ) : null}

      {availability === "available" && model ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Packages ({model.packages.length})
            </h3>
            <ul className="space-y-1 text-xs">
              {model.packages.length === 0 ? (
                <li className="text-[var(--text-muted)]">No packages reported.</li>
              ) : (
                model.packages.map((pkg) => (
                  <li key={pkg.name} className="flex items-center justify-between gap-3">
                    <span>{pkg.name}</span>
                    <span className="flex items-center gap-2 text-[var(--text-muted)]">
                      {pkg.classCount} class{pkg.classCount === 1 ? "" : "es"} · {pkg.symbolCount}{" "}
                      symbol{pkg.symbolCount === 1 ? "" : "s"}
                      {onRefactorPackage && (canRefactorPackage?.(pkg) ?? true) ? (
                        <button
                          type="button"
                          className="rounded-sm px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                          aria-label={`Review move of package ${pkg.name}`}
                          disabled={isWriting}
                          onClick={() => onRefactorPackage(pkg)}
                        >
                          Move
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="mt-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Classes ({model.classes.length})
            </h3>
            <ul className="space-y-1 text-xs">
              {model.classes.length === 0 ? (
                <li className="text-[var(--text-muted)]">No classes reported.</li>
              ) : (
                model.classes.map((klass) => (
                  <li
                    key={`${klass.qualifiedName}-${klass.path}:${klass.line}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    {onNavigateLocation ? (
                      <button
                        type="button"
                        className="font-medium text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                        aria-label={`Open type ${klass.qualifiedName} at ${klass.path}:${klass.line}`}
                        onClick={() =>
                          onNavigateLocation({ path: klass.path, line: klass.line, column: 1 })
                        }
                      >
                        {klass.name}
                      </button>
                    ) : (
                      <span className="font-medium">{klass.name}</span>
                    )}{" "}
                    <span className="text-[var(--text-muted)]">
                      {klass.kind.toLowerCase()} · {klass.qualifiedName}
                    </span>
                    <span className="ml-2 text-[var(--text-muted)]">
                      {klass.path}:{klass.line}
                    </span>
                    {onRefactorType && (canRefactorType?.("move-class", klass) ?? true) ? (
                      <button
                        type="button"
                        className="rounded-sm px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                        aria-label={`Review move of type ${klass.qualifiedName}`}
                        disabled={isWriting}
                        onClick={() => onRefactorType("move-class", klass)}
                      >
                        Move
                      </button>
                    ) : null}
                    {onRefactorType && (canRefactorType?.("safe-delete", klass) ?? true) ? (
                      <button
                        type="button"
                        className="rounded-sm px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                        aria-label={`Review deletion of type ${klass.qualifiedName}`}
                        disabled={isWriting}
                        onClick={() => onRefactorType("safe-delete", klass)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="mt-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              {presentedSymbolsTruncated
                ? `Symbols (${model.symbols.length} of ${totalSymbolCount})`
                : `Symbols (${model.symbols.length})`}
            </h3>
            {presentedSymbolsTruncated ? (
              <p
                data-testid="java-project-model-symbols-truncation"
                className="text-xs text-[var(--text-muted)]"
              >
                Showing {model.symbols.length} of {totalSymbolCount} symbols — the engine result is
                larger than the bounded symbol list shown here.
              </p>
            ) : null}
            <ul className="space-y-1 text-xs">
              {model.symbols.length === 0 ? (
                <li className="text-[var(--text-muted)]">No symbols reported.</li>
              ) : (
                model.symbols.map((symbol) => (
                  <li key={`${symbol.qualifiedName}-${symbol.path}:${symbol.line}`}>
                    <span className="text-[var(--text-muted)]">{symbol.kind.toLowerCase()}</span>{" "}
                    {onNavigateLocation ? (
                      <button
                        type="button"
                        className="text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                        aria-label={`Open symbol ${symbol.qualifiedName} at ${symbol.path}:${symbol.line}`}
                        onClick={() =>
                          onNavigateLocation({ path: symbol.path, line: symbol.line, column: 1 })
                        }
                      >
                        {symbol.qualifiedName}
                      </button>
                    ) : (
                      <span>{symbol.qualifiedName}</span>
                    )}
                    <span className="ml-2 text-[var(--text-muted)]">
                      {symbol.path}:{symbol.line}
                    </span>
                    {symbol.kind.toUpperCase() === "FIELD" &&
                    onEncapsulateField &&
                    (canEncapsulateField?.(symbol) ?? true) ? (
                      <button
                        type="button"
                        className="ml-2 rounded-sm px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                        aria-label={`Review encapsulation of field ${symbol.qualifiedName}`}
                        disabled={isWriting}
                        onClick={() => onEncapsulateField(symbol)}
                      >
                        Encapsulate
                      </button>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
