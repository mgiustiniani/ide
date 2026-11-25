import { JavaProjectDeclarationDialog } from "./JavaProjectDeclarationDialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  JavaMavenTestJvmContext,
  JavaProjectAnnotationProcessors,
  JavaProjectClasspathEntry,
  JavaProjectContextAvailability,
  JavaProjectJpmsContext,
  JavaProjectResolvedArtifact,
  JavaProjectSourceRootEvidence,
  JavaSavedSourceRecoveryRequest,
  RefactorKitAffectedFile,
} from "@ide/contracts";
import type { JavaProjectLayout } from "@ide/contracts";
import type { JavaProjectContextAuthority, RefactorKitCapabilities } from "@ide/contracts";
import { gradleModuleRenameUpdatesLiteralDependencies, javaContextRefactoringOffered } from "@ide/contracts";
import type { JavaProjectPathPickerPort, JavaProjectScaffoldPort } from "@ide/web-core";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { JavaProjectTextSearchPanel } from "@ide/ui";
import type { JavaProjectContextController } from "./useJavaProjectContextController";
import type { JavaProjectTextSearchController } from "./useJavaProjectTextSearchController";
import { JavaProjectScaffoldDialog } from "./JavaProjectScaffoldDialog";
import { MavenModuleRenamePreview, type MavenModuleRenameTransactionState } from "./MavenModuleRenamePreview";

const MAVEN_PROJECT_ROOT_PARENT = "__maven_project_root_parent__";

function gradleSettingsPath(
  context: { buildEvidence?: { path: string }[] } | null | undefined,
  buildRoot: string,
): string | undefined {
  if (!context || !Array.isArray(context.buildEvidence)) return undefined;
  const prefix = buildRoot === "." ? "" : `${buildRoot}/`;
  const candidates = new Set(
    context.buildEvidence
      .map((evidence) => evidence.path.replace(/\\/gu, "/"))
      .filter((path) =>
        ["settings.gradle", "settings.gradle.kts"].includes(path.slice(prefix.length)) &&
        path.startsWith(prefix),
      ),
  );
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

function Classpath({ title, entries }: { title: string; entries: JavaProjectClasspathEntry[] }) {
  const [limit, setLimit] = useState(200);
  useEffect(() => setLimit(200), [entries]);
  return (
    <details className="mt-3">
      <summary className="cursor-pointer font-medium">
        {title} ({entries.length})
      </summary>
      <ol className="mt-2 space-y-2 pl-5 list-decimal">
        {entries.slice(0, limit).map((entry, index) => (
          <li key={`${index}:${entry.path}`} className="break-all">
            <span>{entry.path}</span>
            <p className="text-[var(--text-muted)]">
              {entry.moduleId} · {entry.sourceSetId}
              {entry.dependencyScope ? ` · ${entry.dependencyScope}` : ""}
            </p>
            {entry.artifact ? (
              <p className="text-[var(--text-muted)]">
                {entry.artifact.coordinates.groupId}:{entry.artifact.coordinates.artifactId}:
                {entry.artifact.coordinates.version}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {limit < entries.length ? (
        <button type="button" onClick={() => setLimit((n) => n + 200)}>
          Show next 200 entries
        </button>
      ) : null}
    </details>
  );
}

function BoundedList<T>({
  items,
  itemKey,
  children,
  pageSize = 100,
}: {
  items: readonly T[];
  itemKey(item: T, index: number): string;
  children(item: T, index: number): ReactNode;
  pageSize?: number;
}) {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => setLimit(pageSize), [items, pageSize]);
  return (
    <>
      <ul className="mt-1 space-y-1">
        {items.slice(0, limit).map((item, index) => (
          <li key={itemKey(item, index)} className="break-all">
            {children(item, index)}
          </li>
        ))}
      </ul>
      {limit < items.length ? (
        <button
          type="button"
          className="mt-2 underline"
          onClick={() => setLimit((n) => n + pageSize)}
        >
          Show next {pageSize} entries
        </button>
      ) : null}
    </>
  );
}

function FactStatus({
  availability,
  refusalCode,
}: {
  availability: JavaProjectContextAvailability;
  refusalCode: string | null;
}) {
  return (
    <p className="mt-1 text-[var(--text-muted)]">
      {availability}
      {refusalCode ? ` · ${refusalCode}` : ""}
    </p>
  );
}

function projectProviderLabel(providerId: string): string {
  if (providerId === "maven-effective-v1") return "Maven";
  if (providerId === "gradle-effective-v1") return "Gradle";
  return providerId;
}

function ArtifactDetails({
  title,
  availability,
  refusalCode,
  artifacts,
}: {
  title: string;
  availability: JavaProjectContextAvailability;
  refusalCode: string | null;
  artifacts: JavaProjectResolvedArtifact[];
}) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer font-medium">
        {title} ({artifacts.length})
      </summary>
      <FactStatus availability={availability} refusalCode={refusalCode} />
      <BoundedList items={artifacts} itemKey={(artifact, index) => `${index}:${artifact.path}`}>
        {(artifact) => (
          <>
            <span>
              {artifact.coordinates.groupId}:{artifact.coordinates.artifactId}:
              {artifact.coordinates.version}
            </span>
            <p className="text-[var(--text-muted)]">
              {artifact.extension}
              {artifact.classifier ? ` · ${artifact.classifier}` : ""}
              {artifact.scope ? ` · ${artifact.scope}` : ""}
              {` · ${artifact.transitive ? "transitive" : "direct"}`}
            </p>
            <p>{artifact.path}</p>
          </>
        )}
      </BoundedList>
    </details>
  );
}

function SourceRootEvidence({ entries }: { entries: JavaProjectSourceRootEvidence[] }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer font-medium">
        Source-root provenance ({entries.length})
      </summary>
      <BoundedList items={entries} itemKey={(entry, index) => `${index}:${entry.path}`}>
        {(entry) => (
          <>
            <span>{entry.path || "Project root"}</span>
            <p className="text-[var(--text-muted)]">
              {entry.origin} · {entry.providerId} · {entry.availability}
            </p>
            <p className="text-[var(--text-muted)]">
              {[
                entry.descriptorPath,
                entry.profileId,
                entry.pluginId,
                entry.executionId,
                entry.goal,
                entry.phase,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </>
        )}
      </BoundedList>
    </details>
  );
}

function AnnotationProcessorDetails({ data }: { data: JavaProjectAnnotationProcessors }) {
  return (
    <>
      {data.availability !== "complete" ? (
        <p role="status" className="mt-1 text-[var(--text-muted)]">
          Processor inputs are not fully resolved, so generated-source roots may be missing.
        </p>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer font-medium">
          Annotation processors ({data.processorNames.length})
        </summary>
        <FactStatus availability={data.availability} refusalCode={data.refusalCode} />
        {data.mode ? <p>Mode: {data.mode}</p> : null}
        {data.processorNames.length ? (
          <BoundedList items={data.processorNames} itemKey={(name, index) => `${index}:${name}`}>
            {(name) => name}
          </BoundedList>
        ) : null}
        {data.processorPath.length ? (
          <>
            <h5 className="mt-2 font-medium">Processor path</h5>
            <BoundedList items={data.processorPath} itemKey={(path, index) => `${index}:${path}`}>
              {(path) => path}
            </BoundedList>
          </>
        ) : null}
        {data.dependencies.length ? (
          <ArtifactDetails
            title="Processor dependencies"
            availability={data.availability}
            refusalCode={data.refusalCode}
            artifacts={data.dependencies}
          />
        ) : null}
        {Object.keys(data.options).length ? (
          <details className="mt-2">
            <summary>Processor options ({Object.keys(data.options).length})</summary>
            <BoundedList items={Object.entries(data.options)} itemKey={([name]) => name}>
              {([name, value]) => `${name} = ${value}`}
            </BoundedList>
          </details>
        ) : null}
      </details>
    </>
  );
}

function MavenTestJvmDetails({
  data,
  isBusy,
  onRequest,
}: {
  data: JavaMavenTestJvmContext | undefined;
  isBusy: boolean;
  onRequest?: () => void;
}) {
  if ((!data && !onRequest) || data?.availability === "not-applicable") return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer font-medium">
        Maven test JVM · {data?.availability ?? "not reported"}
      </summary>
      {data && (
        <>
          {data.refusalCode && (
            <p className="mt-1 text-[var(--text-muted)]">{data.refusalCode}</p>
          )}
          {data.executions.length > 0 && (
            <ul className="mt-2 space-y-2">
              {data.executions.map((execution, index) => (
                <li key={index} className="break-all">
                  <p>
                    {execution.pluginId}
                    {execution.pluginVersion ? `:${execution.pluginVersion}` : ""}
                    {execution.executionId ? ` · ${execution.executionId}` : ""}
                  </p>
                  <p className="text-[var(--text-muted)]">
                    {[
                      execution.mode,
                      execution.availability,
                      execution.phase,
                      execution.goals.join(", "),
                    ].filter(Boolean).join(" · ")}
                  </p>
                  {execution.refusalCode && <p>{execution.refusalCode}</p>}
                  <ul className="space-y-1">
                    {[...execution.forkSettings, ...execution.argLineLayers].map((setting, index) => {
                      let value = setting.availability === "complete"
                        ? setting.value ?? "not reported"
                        : setting.availability;
                      if (setting.redacted) value = "[redacted]";
                      else if (setting.name === "argLine" && setting.value !== null &&
                        setting.availability === "complete") {
                        value = setting.value === "" ? "empty" : "configured";
                      }
                      return (
                        <li key={index}>
                          {setting.name} · {value}
                          <p className="text-[var(--text-muted)]">{setting.origin}</p>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!data && onRequest && (
        <button
          type="button"
          className="mt-2 underline disabled:opacity-50"
          disabled={isBusy}
          onClick={onRequest}
        >
          Request Maven test JVM details
        </button>
      )}
    </details>
  );
}

function JpmsDetails({
  data,
  isBusy,
  onRequest,
}: {
  data: JavaProjectJpmsContext | undefined;
  isBusy: boolean;
  onRequest?: () => void;
}) {
  const modulePath = data?.modulePath ?? [];
  const descriptors = data?.descriptors ?? [];
  return (
    <details className="mt-3">
      <summary className="cursor-pointer font-medium">
        Java module system · {data?.availability ?? "not reported"}
      </summary>
      {data ? (
        <FactStatus availability={data.availability} refusalCode={data.refusalCode} />
      ) : (
        <p role="note" className="text-[var(--text-muted)]">
          RefactorKit has not reported Java module-system facts for this source set.
        </p>
      )}
      {onRequest &&
      (!data || (data.availability !== "complete" && data.availability !== "not-declared")) ? (
        <button
          type="button"
          className="mt-2 underline disabled:opacity-50"
          disabled={isBusy}
          onClick={onRequest}
        >
          Request Java module-system details
        </button>
      ) : null}
      {modulePath.length ? (
        <>
          <h5 className="mt-2 font-medium">Module path</h5>
          <BoundedList items={modulePath} itemKey={(entry, index) => `${index}:${entry.path}`}>
            {(entry) => (
              <>
                <span>{entry.path}</span>
                {entry.moduleNames.length ? (
                  <p className="text-[var(--text-muted)]">{entry.moduleNames.join(", ")}</p>
                ) : null}
              </>
            )}
          </BoundedList>
        </>
      ) : null}
      {descriptors.length ? (
        <BoundedList items={descriptors} itemKey={(entry, index) => `${index}:${entry.path}`}>
          {(entry) => (
            <>
              <span>
                {entry.moduleName}: {entry.path}
                {entry.open ? " · open module" : ""}
              </span>
              <p className="text-[var(--text-muted)]">
                requires{" "}
                {entry.requires
                  .map(
                    (item) =>
                      `${item.moduleName}${item.modifiers.length ? ` (${item.modifiers.join(", ")})` : ""}`,
                  )
                  .join(", ") || "none"}
              </p>
              <p className="text-[var(--text-muted)]">
                exports{" "}
                {entry.exports
                  .map(
                    (item) =>
                      `${item.packageName}${item.targets.length ? ` to ${item.targets.join(", ")}` : ""}`,
                  )
                  .join(", ") || "none"}
              </p>
              <p className="text-[var(--text-muted)]">
                opens{" "}
                {entry.opens
                  .map(
                    (item) =>
                      `${item.packageName}${item.targets.length ? ` to ${item.targets.join(", ")}` : ""}`,
                  )
                  .join(", ") || "none"}
              </p>
              <p className="text-[var(--text-muted)]">uses {entry.uses.join(", ") || "none"}</p>
              <p className="text-[var(--text-muted)]">
                provides{" "}
                {entry.provides
                  .map((item) => `${item.serviceType} with ${item.implementations.join(", ")}`)
                  .join("; ") || "none"}
              </p>
              {entry.unreportedDirectives.length ? (
                <p role="note" className="text-[var(--text-muted)]">
                  Provider did not report: {entry.unreportedDirectives.join(", ")}.
                </p>
              ) : null}
            </>
          )}
        </BoundedList>
      ) : null}
    </details>
  );
}
export function JavaProjectContextPanel({
  controller,
  suggestedSdkHome,
  gradleImportEnabled = false,
  onGradleImportAuthorizationChange,
  onOpenGradleTerminal,
  onOpenGradlePreparation,
  onOpenMavenVerification,
  onRecoverSavedSources,
  isWriting = false,
  children,
  onOpenTransactions,
  canMoveSourceRoot,
  onMoveSourceRoot,
  onRevealGeneratedSourceRoot,
  searchController,
  searchFocusRequest,
  onSearchFocusRequestHandled,
  onNavigateLocation,
  workspaceId = null,
  generation = 0,
  workspaceRootPath,
  scaffoldPort,
  declarationPort,
  onDeclarationCreated,
  pathPicker,
  getWorkspaceContext,
  onProjectCreated,
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
  controller: JavaProjectContextController;
  suggestedSdkHome?: string;
  gradleImportEnabled?: boolean;
  onGradleImportAuthorizationChange?(enabled: boolean): void;
  onOpenGradleTerminal?(projectPath: string): void;
  onOpenGradlePreparation?(): void;
  onOpenMavenVerification?(): void;
  onRecoverSavedSources?(request: JavaSavedSourceRecoveryRequest): Promise<void> | undefined;
  isWriting?: boolean;
  children?: ReactNode;
  onOpenTransactions?(): void;
  canMoveSourceRoot?(sourceRoot: string): boolean;
  onMoveSourceRoot?(sourceRoot: string): void;
  onRevealGeneratedSourceRoot?(sourceRoot: string): void;
  searchController?: JavaProjectTextSearchController;
  searchFocusRequest?: number;
  onSearchFocusRequestHandled?(request: number): void;
  onNavigateLocation?(location: { path: string; line: number; column?: number }): void;
  workspaceId?: string | null;
  generation?: number;
  workspaceRootPath?: string | null;
  scaffoldPort?: JavaProjectScaffoldPort;
  declarationPort?: import("@ide/web-core/ports").JavaProjectDeclarationPort;
  onDeclarationCreated?(path: string, authority: JavaProjectContextAuthority): Promise<void>;
  pathPicker?: JavaProjectPathPickerPort;
  getWorkspaceContext?(): Omit<JavaProjectContextAuthority, "workspaceId"> & {
    workspaceId: string | null;
    isSwitching: boolean;
    isMetadataLoading: boolean;
  };
  onProjectCreated?(path: string, authority: JavaProjectContextAuthority): Promise<void>;
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
}) {
  const { settings, context, isBusy } = controller;
  const [reviewedSavedRecovery, setReviewedSavedRecovery] =
    useState<JavaSavedSourceRecoveryRequest | null>(null);
  const mavenOfflineMissing = context?.providers.some(
    (provider) => provider.providerId === "maven-effective-v1" && provider.status === "offline-missing",
  ) ?? false;
  const [pathPickerError, setPathPickerError] = useState<string | null>(null);
  const gradleSettings = useRef<HTMLDetailsElement>(null);
  const gradleUserHome = useRef<HTMLInputElement>(null);
  const [isPickingPath, setIsPickingPath] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [createParentModuleId, setCreateParentModuleId] = useState("");
  const [createGradleBuildRootSelection, setCreateGradleBuildRootSelection] = useState("");
  const [renameGradleSelection, setRenameGradleSelection] = useState("");
  const clearSearch = searchController?.clear;
  const [selected, setSelected] = useState(""),
    [sourcePath, setSourcePath] = useState(""),
    [symbol, setSymbol] = useState("");
  const [profileDrafts, setProfileDrafts] = useState<
    Partial<Record<"activeMavenProfiles" | "inactiveMavenProfiles", { key: string; text: string }>>
  >({});
  const [propertyDraft, setPropertyDraft] = useState<{ key: string; text: string } | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [declarationOpen, setDeclarationOpen] = useState(false);
  useEffect(() => setDeclarationOpen(false), [workspaceId, generation, settings.projectPath, settings.sdkHome]);
  const [createBuildSystem, setCreateBuildSystem] = useState<"maven" | "gradle">("maven");
  const [createProjectLayout, setCreateProjectLayout] =
    useState<JavaProjectLayout>("single-module");
  useEffect(() => {
    clearSearch?.();
    setSearchQuery("");
    setSearchCaseSensitive(false);
  }, [clearSearch, generation, settings.projectPath, workspaceId]);
  const choices =
    context?.modules.flatMap((module) =>
      module.sourceSets.map((set) => ({
        key: JSON.stringify([module.providerId, module.id, set.id]),
        module,
        set,
      })),
    ) ?? [];
  const choice =
    choices.find((item) => item.key === selected) ??
    choices.find(
      (item) =>
        (!context?.selectedSource?.providerId ||
          item.module.providerId === context.selectedSource.providerId) &&
        item.module.id === context?.selectedSource?.moduleId &&
        item.set.id === context.selectedSource.sourceSetId,
    ) ??
    choices[0];
  const supportsProviderQualifiedSourceSelection =
    refactorKitCapabilities?.methods?.some(
      (method) =>
        method.requiresProject &&
        !method.writesWorkspace &&
        method.features?.providerQualifiedSourceAssociation === true &&
        ((method.name === "project.context" && method.features.typedSchemaV3 === true) ||
          (method.name === "project.context.v5" && method.features.typedSchemaV5 === true) ||
          (method.name === "project.context.v6" && method.features.typedSchemaV6 === true) ||
          (method.name === "project.context.v7" && method.features.typedSchemaV7 === true)),
    ) ?? false;
  const ambiguousSourceSelection =
    Boolean(choice) &&
    !supportsProviderQualifiedSourceSelection &&
    (context?.modules.filter(
      (module) =>
        module.id === choice!.module.id &&
        module.sourceSets.some((sourceSet) => sourceSet.id === choice!.set.id),
    ).length ?? 0) > 1;
  const update = (key: "projectPath" | "sdkHome" | "mavenRepository", value: string) =>
    controller.setSettings({ ...settings, [key]: value });
  const updateGradle = (
    key: "executable" | "userHome" | "gradleRuntimeHome",
    value: string,
  ) =>
    controller.setSettings({
      ...settings,
      gradle: {
        executable: "",
        userHome: "",
        projectProperties: {},
        ...settings.gradle,
        [key]: value,
      },
    });
  const choosePath = async (
    select: () => Promise<string | null>,
    onSelected: (path: string) => void,
  ) => {
    const picker = pathPicker;
    const readWorkspaceContext = getWorkspaceContext;
    const current = readWorkspaceContext?.();
    if (!picker || !workspaceId || !readWorkspaceContext || !current) return;
    const authority = { workspaceId, generation };
    const isCurrent = () => {
      const active = readWorkspaceContext();
      return (
        active.workspaceId === authority.workspaceId &&
        active.generation === authority.generation &&
        !active.isSwitching &&
        !active.isMetadataLoading
      );
    };
    if (!isCurrent()) {
      setPathPickerError("The workspace changed. Choose the path again in the active workspace.");
      return;
    }
    setIsPickingPath(true);
    setPathPickerError(null);
    try {
      const selected = await select();
      if (!isCurrent()) {
        setPathPickerError("The workspace changed. Choose the path again in the active workspace.");
        return;
      }
      if (selected !== null) onSelected(selected);
    } catch {
      if (isCurrent())
        setPathPickerError("The native path picker failed. You can enter the path manually.");
    } finally {
      setIsPickingPath(false);
    }
  };
  const pathPickerDisabled =
    isBusy || isWriting || isPickingPath || searchController?.isBusy || !workspaceId;
  const gradleProperties = (text: string) => {
    const projectProperties = Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => {
          const separator = line.indexOf("=");
          return separator < 0
            ? ["", line]
            : [line.slice(0, separator).trim(), line.slice(separator + 1)];
        }),
    );
    setPropertyDraft({ key: JSON.stringify(projectProperties), text });
    controller.setSettings({
      ...settings,
      gradle: { executable: "", userHome: "", ...settings.gradle, projectProperties },
    });
  };
  const profiles = (key: "activeMavenProfiles" | "inactiveMavenProfiles", value: string) => {
    const parsed = value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    setProfileDrafts((drafts) => ({
      ...drafts,
      [key]: { key: JSON.stringify(parsed), text: value },
    }));
    controller.setSettings({ ...settings, [key]: parsed });
  };
  const profileText = (key: "activeMavenProfiles" | "inactiveMavenProfiles") =>
    profileDrafts[key]?.key === JSON.stringify(settings[key])
      ? profileDrafts[key]!.text
      : settings[key].join("\n");
  useEffect(() => {
    setSelected("");
  }, [workspaceId, generation, settings.projectPath, settings.sdkHome]);
  useEffect(() => {
    setSourcePath("");
    setSymbol("");
    setCreateParentModuleId("");
    setCreateGradleBuildRootSelection("");
  }, [context?.snapshotHash, settings.projectPath]);
  const mavenModules =
    context?.modules.filter((module) => module.providerId === "maven-effective-v1") ?? [];
  const gradleModules =
    context?.modules.filter(
      (module) => module.providerId === "gradle-effective-v1" && module.buildRoot !== undefined,
    ) ?? [];
  const gradleBuildRoots = [...new Set(gradleModules.map((module) => module.buildRoot!))].sort();
  const createGradleBuildRoot = gradleBuildRoots.includes(createGradleBuildRootSelection)
    ? createGradleBuildRootSelection
    : gradleBuildRoots[0] ?? "";
  const createGradleSettingsPath = gradleSettingsPath(context, createGradleBuildRoot);
  const createParentModule = mavenModules.find((module) => module.id === createParentModuleId);
  const createProjectRootPomPath = [settings.projectPath, "pom.xml"].filter(Boolean).join("/");
  const hasProjectRootModule = mavenModules.some((module) => {
    const root =
      context?.schemaVersion === "java-project-context-v3" ||
      context?.schemaVersion === "java-project-context-v4" ||
      context?.schemaVersion === "java-project-context-v5" ||
      context?.schemaVersion === "java-project-context-v6" ||
      context?.schemaVersion === "java-project-context-v7"
        ? module.root
        : [settings.projectPath, module.root].filter(Boolean).join("/");
    return [root, "pom.xml"].filter(Boolean).join("/") === createProjectRootPomPath;
  });
  const createModuleOffered =
    Boolean(onCreateMavenModule) &&
    context?.semanticAnalysis?.availability !== "unqualified" &&
    javaContextRefactoringOffered(
      refactorKitCapabilities ?? null,
      "create-maven-module",
      "preview",
    ) &&
    mavenModules.length > 0 &&
    (context?.status === "available" || context?.status === "partial");
  const createGradleModuleOffered =
    Boolean(onCreateGradleModule) &&
    context?.semanticAnalysis?.availability !== "unqualified" &&
    javaContextRefactoringOffered(
      refactorKitCapabilities ?? null,
      "create-gradle-module",
      "preview",
    ) &&
    gradleModules.length > 0 &&
    Boolean(createGradleSettingsPath) &&
    (context?.status === "available" || context?.status === "partial");
  const renameGradleModules = gradleModules.filter(module =>
    context?.providers.some(provider => provider.providerId === "gradle-effective-v1" && provider.status === "available") &&
    module.projectPath && module.projectPath !== ":" && gradleSettingsPath(context, module.buildRoot!) !== undefined);
  const renameGradleCandidates = renameGradleModules.map(module => ({
    key: JSON.stringify([module.buildRoot, module.projectPath]), module,
  }));
  const renameGradleCounts = new Map<string, number>();
  for (const { key } of renameGradleCandidates) renameGradleCounts.set(key, (renameGradleCounts.get(key) ?? 0) + 1);
  const renameGradleChoices = renameGradleCandidates.filter(({ key }) => renameGradleCounts.get(key) === 1);
  const renameGradleModule = (renameGradleChoices.find(choice => choice.key === renameGradleSelection) ?? renameGradleChoices[0])?.module;
  const renameGradleOffered = Boolean(onRenameGradleModule && renameGradleModule &&
    context?.semanticAnalysis?.availability !== "unqualified" && context?.status === "available" &&
    javaContextRefactoringOffered(refactorKitCapabilities ?? null, "rename-gradle-module", "preview"));
  const createParentPomPath =
    createParentModuleId === MAVEN_PROJECT_ROOT_PARENT
      ? createProjectRootPomPath
      : createParentModule
        ? (() => {
            const workspaceRelativeRoot =
              context?.schemaVersion === "java-project-context-v3" ||
              context?.schemaVersion === "java-project-context-v4" ||
              context?.schemaVersion === "java-project-context-v5" ||
              context?.schemaVersion === "java-project-context-v6" ||
              context?.schemaVersion === "java-project-context-v7"
                ? createParentModule.root
                : [settings.projectPath, createParentModule.root].filter(Boolean).join("/");
            const normalizedRoot = workspaceRelativeRoot
              .split("/")
              .filter((segment) => segment !== ".")
              .join("/")
              .replace(/\/+$/u, "");
            return [normalizedRoot, "pom.xml"].filter(Boolean).join("/");
          })()
        : "";
  const field =
    "mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--input-bg)] px-2 py-1 text-[var(--text-primary)]";
  return (
    <section
      aria-label="Java project context"
      data-provider-qualified-source-selection={String(supportsProviderQualifiedSourceSelection)}
      className="min-h-0 overflow-auto p-3 text-xs text-[var(--text-primary)]"
    >
      <h3 className="text-sm font-medium">Java Project</h3>
      <p className="mt-2 text-[var(--text-secondary)]">
        Synchronize modules, source sets and dependency classpaths from saved project files. Editor
        drafts remain unchanged.
      </p>
      {context?.semanticAnalysis?.availability === "unqualified" ? (
        <p role="status" className="mt-2 text-[var(--text-muted)]">
          Project metadata is available for build, run and tests. Java source and symbol analysis
          is unavailable for this context.
        </p>
      ) : null}
      {context?.semanticAnalysis?.availability !== "unqualified" &&
      refactorKitPort &&
      getWorkspaceContext &&
      beginJavaProjectWrite &&
      reconcileJavaProjectChanges &&
      onMavenModuleRenameSourceChanged &&
      mavenModuleRenameTransaction ? (
        <MavenModuleRenamePreview
          context={context}
          workspaceId={workspaceId}
          generation={generation}
          isWriting={isWriting}
          capabilities={refactorKitCapabilities ?? null}
          port={refactorKitPort}
          getWorkspaceContext={getWorkspaceContext}
          beginWorkspaceWrite={beginJavaProjectWrite}
          reconcileChanges={reconcileJavaProjectChanges}
          onSourceChanged={onMavenModuleRenameSourceChanged}
          transactionState={mavenModuleRenameTransaction}
        />
      ) : null}
      {createModuleOffered ? (
        <section className="mt-3 space-y-2 rounded border border-[var(--border-default)] p-3">
          <h4 className="font-medium">Add Maven module</h4>
          <p className="text-[var(--text-muted)]">
            Choose a synchronized Maven module as the parent. RefactorKit will determine whether it
            can contain a new module.
          </p>
          <label className="block">
            Parent module
            <select
              aria-label="Maven module parent"
              className={`${field} mt-1`}
              value={createParentModuleId}
              disabled={isBusy || isWriting}
              onChange={(event) => setCreateParentModuleId(event.target.value)}
            >
              <option value="">Select a parent module</option>
              {!hasProjectRootModule ? (
                <option value={MAVEN_PROJECT_ROOT_PARENT}>
                  Project root · {settings.projectPath || "Project root"}
                </option>
              ) : null}
              {mavenModules.map((module) => (
                <option key={`${module.providerId}:${module.id}`} value={module.id}>
                  {module.name} · {module.root || "Project root"}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded border border-[var(--border-default)] px-3 py-1 hover:bg-[var(--highlight-bg)] disabled:opacity-50"
            disabled={isBusy || isWriting || !workspaceId || !createParentPomPath}
            onClick={() => onCreateMavenModule?.(createParentPomPath)}
          >
            Review Add Module
          </button>
        </section>
      ) : null}
      {renameGradleOffered && renameGradleModule ? (
        <section className="mt-3 space-y-2 rounded border border-[var(--border-default)] p-3">
          <h4 className="font-medium">Rename Gradle module (experimental)</h4>
          <p>Rename a synchronized project path while preserving its directory. The preview shows which build files would change.</p>
          {gradleModuleRenameUpdatesLiteralDependencies(refactorKitCapabilities ?? null) ? (
            <p>RefactorKit can update supported literal project dependencies and refuses dependencies it cannot verify.</p>
          ) : null}
          <label className="block">
            Gradle module
            <select aria-label="Gradle module to rename" className={`${field} mt-1`}
              value={JSON.stringify([renameGradleModule.buildRoot, renameGradleModule.projectPath])}
              disabled={isBusy || isWriting} onChange={event => setRenameGradleSelection(event.target.value)}>
              {renameGradleChoices.map(({ key, module }) => <option key={key} value={key}>
                {module.projectPath} · {module.buildRoot}
              </option>)}
            </select>
          </label>
          <button type="button" className="rounded border border-[var(--border-default)] px-3 py-1 disabled:opacity-50"
            disabled={isBusy || isWriting || !workspaceId}
            onClick={() => onRenameGradleModule?.(renameGradleModule.buildRoot!,
              gradleSettingsPath(context, renameGradleModule.buildRoot!)!, renameGradleModule.projectPath!)}>
            Review Gradle Module Rename
          </button>
        </section>
      ) : null}
      {createGradleModuleOffered ? (
        <section className="mt-3 space-y-2 rounded border border-[var(--border-default)] p-3">
          <h4 className="font-medium">Add Gradle module</h4>
          <p className="text-[var(--text-muted)]">
            Choose a synchronized Gradle build. RefactorKit validates the nested project path and
            the build's settings before it prepares a change.
          </p>
          <label className="block">
            Gradle build
            <select
              aria-label="Gradle build for new module"
              className={`${field} mt-1`}
              value={createGradleBuildRoot}
              disabled={isBusy || isWriting}
              onChange={(event) => setCreateGradleBuildRootSelection(event.target.value)}
            >
              {gradleBuildRoots.map((buildRoot) => (
                <option key={buildRoot} value={buildRoot}>
                  {buildRoot === "." ? "Workspace build" : buildRoot}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded border border-[var(--border-default)] px-3 py-1 hover:bg-[var(--highlight-bg)] disabled:opacity-50"
            disabled={isBusy || isWriting || !workspaceId || !createGradleSettingsPath}
            onClick={() =>
              createGradleSettingsPath &&
              onCreateGradleModule?.(createGradleBuildRoot, createGradleSettingsPath)
            }
          >
            Review Add Module
          </button>
        </section>
      ) : null}
      {scaffoldPort && getWorkspaceContext && onProjectCreated ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded border border-[var(--border-default)] px-3 py-1 hover:bg-[var(--highlight-bg)] disabled:opacity-50"
            disabled={isBusy || isWriting || searchController?.isBusy || !workspaceId}
            onClick={() => {
              setCreateBuildSystem("maven");
              setCreateProjectOpen(true);
            }}
          >
            New Maven project
          </button>
          <button
            type="button"
            className="rounded border border-[var(--border-default)] px-3 py-1 hover:bg-[var(--highlight-bg)] disabled:opacity-50"
            disabled={isBusy || isWriting || searchController?.isBusy || !workspaceId}
            onClick={() => {
              setCreateBuildSystem("gradle");
              setCreateProjectOpen(true);
            }}
          >
            New Gradle project
          </button>
        </div>
      ) : null}
      {scaffoldPort && getWorkspaceContext && onProjectCreated ? (
        <JavaProjectScaffoldDialog
          open={createProjectOpen}
          buildSystem={createBuildSystem}
          layout={createProjectLayout}
          onLayoutChange={setCreateProjectLayout}
          workspaceId={workspaceId}
          generation={generation}
          port={scaffoldPort}
          getWorkspaceContext={getWorkspaceContext}
          onCreated={onProjectCreated}
          onClose={() => setCreateProjectOpen(false)}
        />
      ) : null}
      {declarationPort && onDeclarationCreated && getWorkspaceContext && workspaceId && (
        <>
          <button type="button" disabled={isBusy || isWriting || !settings.sdkHome.trim()}
            onClick={() => setDeclarationOpen(true)}>Declare plain Java project</button>
          {declarationOpen && <JavaProjectDeclarationDialog
            key={`${workspaceId}:${generation}:${settings.projectPath}:${settings.sdkHome}`}
            workspaceId={workspaceId} generation={generation ?? 0}
            projectPath={settings.projectPath} sdkHome={settings.sdkHome}
            port={declarationPort} getWorkspaceContext={getWorkspaceContext}
            onCreated={onDeclarationCreated} onClose={() => setDeclarationOpen(false)}
          />}
        </>
      )}
      <label htmlFor="java-project-directory" className="mt-3 block">
        Project directory
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="java-project-directory"
          className={field}
          value={settings.projectPath}
          placeholder="Workspace root"
          disabled={isBusy || isWriting || searchController?.isBusy}
          onChange={(e) => {
            update("projectPath", e.target.value);
            searchController?.clear();
          }}
        />
        {pathPicker && workspaceRootPath && getWorkspaceContext ? (
          <button
            type="button"
            className="shrink-0 rounded border border-[var(--border-default)] px-2 hover:bg-[var(--highlight-bg)] disabled:opacity-50"
            aria-label="Choose project directory"
            disabled={pathPickerDisabled}
            onClick={() =>
              void choosePath(
                () => pathPicker.selectDirectory(workspaceRootPath),
                (path) => {
                  const relative = workspaceRelativeProjectPath(workspaceRootPath, path);
                  if (relative === null) {
                    setPathPickerError("Choose a project directory inside the active workspace.");
                    return;
                  }
                  update("projectPath", relative);
                },
              )
            }
          >
            Browse…
          </button>
        ) : null}
      </div>
      {searchController ? (
        <JavaProjectTextSearchPanel
          query={searchQuery}
          caseSensitive={searchCaseSensitive}
          matches={searchController.matches}
          scannedFiles={searchController.scannedFiles}
          skippedFiles={searchController.skippedFiles}
          searchedDraftFiles={searchController.searchedDraftFiles}
          skippedDraftFiles={searchController.skippedDraftFiles}
          truncated={searchController.truncated}
          hasSearched={searchController.hasSearched}
          isBusy={searchController.isBusy || isBusy}
          error={searchController.error}
          focusRequest={searchFocusRequest}
          onQueryChange={(value) => {
            setSearchQuery(value);
            searchController.clear();
          }}
          onCaseSensitiveChange={(value) => {
            setSearchCaseSensitive(value);
            searchController.clear();
          }}
          onSearch={() =>
            searchController.search(searchQuery, searchCaseSensitive, settings.projectPath)
          }
          onClear={() => {
            setSearchQuery("");
            searchController.clear();
          }}
          onFocusRequestHandled={onSearchFocusRequestHandled}
          onResultSelect={(match) =>
            onNavigateLocation?.({ path: match.path, line: match.line, column: match.column })
          }
        />
      ) : null}
      <div className="mt-3">
        <label htmlFor="java-project-sdk-home" className="block">
          Project JDK home
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="java-project-sdk-home"
            className={`${field} min-w-0 flex-1`}
            value={settings.sdkHome}
            placeholder="Full JDK directory"
            disabled={isBusy || isWriting}
            onChange={(e) => update("sdkHome", e.target.value)}
          />
          {pathPicker && getWorkspaceContext ? (
            <button
              type="button"
              className="rounded border border-[var(--border-default)] px-2 hover:bg-[var(--highlight-bg)] disabled:opacity-50"
              aria-label="Choose JDK home"
              disabled={pathPickerDisabled}
              onClick={() =>
                void choosePath(
                  () => pathPicker.selectDirectory(),
                  (path) => update("sdkHome", path),
                )
              }
            >
              Browse…
            </button>
          ) : null}
        </div>
      </div>
      {suggestedSdkHome ? (
        <button
          type="button"
          className="mt-1 underline"
          disabled={isBusy || isWriting}
          onClick={() => update("sdkHome", suggestedSdkHome)}
        >
          Use Java Run JDK
        </button>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer">Maven settings</summary>
        <div className="mt-2">
          <label htmlFor="java-maven-repository" className="block">
            Local Maven repository
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="java-maven-repository"
              className={`${field} min-w-0 flex-1`}
              value={settings.mavenRepository}
              placeholder="Engine default local repository"
              disabled={isBusy || isWriting}
              onChange={(e) => update("mavenRepository", e.target.value)}
            />
            {pathPicker && getWorkspaceContext ? (
              <button
                type="button"
                className="rounded border border-[var(--border-default)] px-2 hover:bg-[var(--highlight-bg)] disabled:opacity-50"
                aria-label="Choose Maven repository"
                disabled={pathPickerDisabled}
                onClick={() =>
                  void choosePath(
                    () => pathPicker.selectDirectory(),
                    (path) => update("mavenRepository", path),
                  )
                }
              >
                Browse…
              </button>
            ) : null}
          </div>
        </div>
        <label className="mt-2 block">
          Active profiles (one per line)
          <textarea
            className={field}
            value={profileText("activeMavenProfiles")}
            disabled={isBusy || isWriting}
            onChange={(e) => profiles("activeMavenProfiles", e.target.value)}
          />
        </label>
        <label className="mt-2 block">
          Inactive profiles (one per line)
          <textarea
            className={field}
            value={profileText("inactiveMavenProfiles")}
            disabled={isBusy || isWriting}
            onChange={(e) => profiles("inactiveMavenProfiles", e.target.value)}
          />
        </label>
        {onOpenMavenVerification && settings.sdkHome.trim() && !mavenOfflineMissing && !isBusy && !isWriting ? (
          <button type="button" className="mt-2 underline" onClick={onOpenMavenVerification}>
            Open Java Run for Maven verification
          </button>
        ) : null}
      </details>
      <details ref={gradleSettings} className="mt-3">
        <summary className="cursor-pointer">Gradle settings</summary>
        <div className="mt-2">
          <label htmlFor="java-gradle-executable" className="block">
            Gradle executable
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="java-gradle-executable"
              className={`${field} min-w-0 flex-1`}
              value={settings.gradle?.executable ?? ""}
              placeholder="Absolute Gradle or wrapper executable"
              disabled={isBusy || isWriting}
              onChange={(e) => updateGradle("executable", e.target.value)}
            />
            {pathPicker && getWorkspaceContext ? (
              <button
                type="button"
                className="rounded border border-[var(--border-default)] px-2 hover:bg-[var(--highlight-bg)] disabled:opacity-50"
                aria-label="Choose Gradle executable"
                disabled={pathPickerDisabled}
                onClick={() =>
                  void choosePath(
                    () => pathPicker.selectFile(),
                    (path) => updateGradle("executable", path),
                  )
                }
              >
                Browse…
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-2">
          <label htmlFor="java-gradle-runtime-home" className="block">
            Gradle runtime JDK home
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="java-gradle-runtime-home"
              className={`${field} min-w-0 flex-1`}
              value={settings.gradle?.gradleRuntimeHome ?? ""}
              placeholder="Defaults to project JDK"
              disabled={isBusy || isWriting}
              onChange={(e) => updateGradle("gradleRuntimeHome", e.target.value)}
            />
            {pathPicker && getWorkspaceContext ? (
              <button
                type="button"
                className="rounded border border-[var(--border-default)] px-2 hover:bg-[var(--highlight-bg)] disabled:opacity-50"
                aria-label="Choose Gradle runtime JDK home"
                disabled={pathPickerDisabled}
                onClick={() =>
                  void choosePath(
                    () => pathPicker.selectDirectory(),
                    (path) => updateGradle("gradleRuntimeHome", path),
                  )
                }
              >
                Browse…
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-[var(--text-secondary)]">
            Use a compatible JDK to run Gradle separately from the project JDK and toolchain.
          </p>
        </div>
        <div className="mt-2">
          <label htmlFor="java-gradle-user-home" className="block">
            Gradle user home
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="java-gradle-user-home"
              ref={gradleUserHome}
              className={`${field} min-w-0 flex-1`}
              value={settings.gradle?.userHome ?? ""}
              placeholder="Gradle default user home"
              disabled={isBusy || isWriting}
              onChange={(e) => updateGradle("userHome", e.target.value)}
            />
            {pathPicker && getWorkspaceContext ? (
              <button
                type="button"
                className="rounded border border-[var(--border-default)] px-2 hover:bg-[var(--highlight-bg)] disabled:opacity-50"
                aria-label="Choose Gradle user home"
                disabled={pathPickerDisabled}
                onClick={() =>
                  void choosePath(
                    () => pathPicker.selectDirectory(),
                    (path) => updateGradle("userHome", path),
                  )
                }
              >
                Browse…
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-[var(--text-secondary)]">
          Project properties use one name=value entry per line, with at most 64 names.
        </p>
        <label className="mt-2 block">
          Gradle project properties
          <textarea
            className={field}
            disabled={isBusy || isWriting}
            value={
              propertyDraft?.key === JSON.stringify(settings.gradle?.projectProperties ?? {})
                ? propertyDraft.text
                : Object.entries(settings.gradle?.projectProperties ?? {})
                    .map(([key, value]) => `${key}=${value}`)
                    .join("\n")
            }
            onChange={(e) => gradleProperties(e.target.value)}
          />
        </label>
        <p className="mt-2 text-[var(--text-secondary)]">
          Evaluate Gradle runs this project's build and initialization scripts to discover source
          sets and dependencies. Dependency resolution is offline; scripts can still access the
          network and credentials. No compilation task is requested.
        </p>
        <p className="mt-2 text-[var(--text-secondary)]">
          JDT LS may run Gradle scripts for the builds it discovers throughout the workspace. This
          authorization is workspace-wide for the session, even when a Java project is selected.
          With a Gradle installation selected, JDT LS uses that distribution; with a wrapper
          selected, other discovered Gradle roots may also run their own wrappers. The configured
          Gradle user home, Gradle runtime JDK, project JDK and project properties apply to imports. Scripts may access
          the network and credentials. This authorization resets when you switch workspaces or
          restart the IDE.
        </p>
        {onGradleImportAuthorizationChange ? (
          <button
            type="button"
            className="mt-2 rounded bg-[var(--highlight-bg)] px-3 py-1 disabled:opacity-50"
            disabled={isBusy || isWriting}
            onClick={() => onGradleImportAuthorizationChange(!gradleImportEnabled)}
          >
            {gradleImportEnabled
              ? "Disable JDT LS Gradle import for this session"
              : "Allow JDT LS Gradle import for this session"}
          </button>
        ) : null}
        <button
          type="button"
          className="mt-2 rounded bg-[var(--highlight-bg)] px-3 py-1 disabled:opacity-50"
          disabled={
            isBusy || isWriting || !settings.sdkHome.trim() || !settings.gradle?.executable.trim()
          }
          onClick={() => {
            void controller.evaluateGradle();
          }}
        >
          Evaluate Gradle project
        </button>
        {onOpenGradleTerminal && settings.gradle?.executable.trim() ? (
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => onOpenGradleTerminal(settings.projectPath)}
          >
            Open Gradle project terminal
          </button>
        ) : null}
        {settings.gradle ? (
          <button
            type="button"
            className="ml-3 underline"
            disabled={isBusy || isWriting}
            onClick={() => {
              const value = { ...settings };
              delete value.gradle;
              controller.setSettings(value);
            }}
          >
            Clear Gradle settings
          </button>
        ) : null}
      </details>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          disabled={isBusy || isWriting || !settings.sdkHome.trim()}
          className="rounded bg-[var(--highlight-bg)] px-3 py-1 disabled:opacity-50"
          onClick={() => {
            void controller.synchronize();
          }}
        >
          {isBusy ? "Synchronizing…" : "Synchronize project"}
        </button>
        {isBusy ? (
          <button type="button" onClick={controller.cancel}>
            Cancel
          </button>
        ) : null}
      </div>
      {controller.error ? (
        <p role="alert" className="mt-3 text-red-300">
          {controller.error}
        </p>
      ) : null}
      {controller.message ? (
        <p role="status" className="mt-3">
          {controller.message}
        </p>
      ) : null}
      {controller.savedSourceRecovery && onRecoverSavedSources && !isBusy && !isWriting ? (
        reviewedSavedRecovery === controller.savedSourceRecovery ? (
          <div className="mt-3" role="group" aria-label="Confirm saved-file recovery">
            <p>RefactorKit will use its journal to reverse interrupted changes in {reviewedSavedRecovery.projectPath || "the workspace root"}. Save or close open drafts before continuing.</p>
            <button type="button" onClick={() => {
              setReviewedSavedRecovery(null);
              void onRecoverSavedSources(reviewedSavedRecovery);
            }}>Recover saved files</button>
            <button type="button" onClick={() => setReviewedSavedRecovery(null)}>Cancel recovery</button>
          </div>
        ) : (
          <button type="button" className="mt-2 underline"
            onClick={() => setReviewedSavedRecovery(controller.savedSourceRecovery!)}>
            Review saved-file recovery
          </button>
        )
      ) : null}
      {controller.recoveryAction === "prepare-gradle" && onOpenGradlePreparation && !isBusy && !isWriting ? (
        <button type="button" className="mt-2 underline" onClick={onOpenGradlePreparation}>
          Open Java Run for Gradle preparation
        </button>
      ) : null}
      {controller.recoveryAction === "edit-gradle-user-home" && !isBusy && !isWriting ? (
        <button
          type="button"
          className="mt-2 underline"
          onClick={() => {
            if (gradleSettings.current) gradleSettings.current.open = true;
            gradleUserHome.current?.focus();
          }}
        >
          Edit Gradle user home
        </button>
      ) : null}
      {mavenOfflineMissing && onOpenMavenVerification && !isBusy && !isWriting ? (
        <div className="mt-3">
          <p>The local Maven repository is missing artifacts. Verify the reactor in Java Run, then synchronize again.</p>
          <button type="button" className="mt-2 underline" onClick={onOpenMavenVerification}>
            Open Java Run for Maven verification
          </button>
        </div>
      ) : null}
      {pathPickerError ? (
        <p role="alert" className="mt-2 text-red-300">
          {pathPickerError}
        </p>
      ) : null}
      {context ? (
        <div className="mt-4 border-t border-[var(--border-default)] pt-3">
          <p className="font-medium">
            {context.status === "available"
              ? "Effective project context"
              : "Partial project context"}{" "}
            · RefactorKit {controller.engineVersion}
          </p>
          {context.analysis?.warningCount ? (
            <p>{context.analysis.warningCount} analysis diagnostics reported.</p>
          ) : null}
          {context.providers.map((provider) => (
            <div key={provider.providerId} className="mt-2">
              <p>
                {provider.providerId} · {provider.status}
              </p>
              {provider.diagnostics.length ? (
                <p className="text-[var(--text-muted)]">{provider.diagnostics.join(", ")}</p>
              ) : null}
            </div>
          ))}
          {context.sdk.map((sdk) => (
            <p key={sdk.identitySha256} className="mt-2 break-all">
              Java {sdk.sourceRelease} platform from JDK {sdk.platformRelease}: {sdk.home}
            </p>
          ))}
          <label className="mt-3 block">
            Module and source set
            <select
              aria-label="Module and source set"
              className={field}
              value={choice?.key ?? ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              {choices.map((item) => (
                <option key={item.key} value={item.key}>
                  {projectProviderLabel(item.module.providerId)} · {item.module.name} ·{" "}
                  {item.set.kind} ({item.set.id})
                  {item.module.buildRoot !== undefined && item.module.projectPath !== undefined
                    ? ` [${item.module.buildRoot} ${item.module.projectPath}]`
                    : ""}
                  {item.module.coordinates
                    ? ` · ${item.module.coordinates.groupId}:${item.module.coordinates.artifactId}:${item.module.coordinates.version}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {choice ? (
            <div className="mt-3">
              {choice.module.buildRoot !== undefined && choice.module.projectPath !== undefined ? (
                <>
                  <p className="break-all">Gradle build root: {choice.module.buildRoot}</p>
                  <p className="break-all">Gradle project path: {choice.module.projectPath}</p>
                </>
              ) : null}
              <p className="break-all">
                {context.schemaVersion === "java-project-context-v3" ||
                context.schemaVersion === "java-project-context-v4" ||
                context.schemaVersion === "java-project-context-v5" ||
                context.schemaVersion === "java-project-context-v6" ||
                context.schemaVersion === "java-project-context-v7"
                  ? "Workspace-relative module directory: "
                  : "Module directory: "}
                {choice.module.root || "Project root"}
              </p>
              {choice.module.coordinates ? (
                <p className="break-all">
                  Module coordinates: {choice.module.coordinates.groupId}:
                  {choice.module.coordinates.artifactId}:{choice.module.coordinates.version}
                </p>
              ) : null}
              <p>
                Source level: {choice.set.sourceLevel}
                {choice.set.release ? ` · release ${choice.set.release}` : ""}
              </p>
              {[
                ["Source roots", choice.set.sourceRoots],
                ["Generated source roots", choice.set.generatedSourceRoots],
                ["Output directories", choice.set.outputDirectories],
              ].map(([label, paths]) => (
                <div key={String(label)} className="mt-3">
                  <h4 className="font-medium">{String(label)}</h4>
                  <ul className="mt-1 space-y-1">
                    {(paths as string[]).map((root) => (
                      <li key={root} className="break-all">
                        <span>{root || "Project root"}</span>
                        {label === "Generated source roots" && root && onRevealGeneratedSourceRoot ? (
                          <button
                            type="button"
                            className="ml-2 underline disabled:opacity-50"
                            aria-label={`Reveal generated source root ${root} in Files`}
                            disabled={isBusy || isWriting || context.status !== "available"}
                            onClick={() => onRevealGeneratedSourceRoot(root)}
                          >
                            Reveal in Files
                          </button>
                        ) : null}
                        {label === "Source roots" && root && onMoveSourceRoot ? (
                          <button
                            type="button"
                            className="ml-2 underline disabled:opacity-50"
                            disabled={
                              isBusy ||
                              isWriting ||
                              context.status !== "available" ||
                              !canMoveSourceRoot?.(root)
                            }
                            onClick={() => onMoveSourceRoot(root)}
                          >
                            Review move
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <Classpath
                title="Compile classpath (provider order)"
                entries={choice.set.compileClasspath}
              />
              <Classpath
                title="Runtime classpath (provider order)"
                entries={choice.set.runtimeClasspath}
              />
              {choice.set.sourceRootEvidence ? (
                <SourceRootEvidence entries={choice.set.sourceRootEvidence} />
              ) : null}
              {choice.set.compilerOptionsAvailability ? (
                <details className="mt-3">
                  <summary className="cursor-pointer font-medium">
                    Compiler options ({choice.set.compilerOptions?.length ?? 0})
                  </summary>
                  <FactStatus
                    availability={choice.set.compilerOptionsAvailability}
                    refusalCode={choice.set.compilerOptionsRefusalCode ?? null}
                  />
                  <BoundedList
                    items={choice.set.compilerOptions ?? []}
                    itemKey={(option, index) => `${index}:${option.name}:${option.origin}`}
                  >
                    {(option) => (
                      <>
                        <span>
                          {option.name}
                          {option.value ? ` ${option.redacted ? "[redacted]" : option.value}` : ""}
                        </span>
                        <p className="text-[var(--text-muted)]">{option.origin}</p>
                      </>
                    )}
                  </BoundedList>
                </details>
              ) : null}
              {choice.set.resolvedArtifactAvailability ? (
                <ArtifactDetails
                  title="Resolved artifacts"
                  availability={choice.set.resolvedArtifactAvailability}
                  refusalCode={choice.set.resolvedArtifactRefusalCode ?? null}
                  artifacts={choice.set.resolvedArtifacts ?? []}
                />
              ) : null}
              {choice.set.annotationProcessors ? (
                <AnnotationProcessorDetails data={choice.set.annotationProcessors} />
              ) : null}
              {choice.module.providerId === "maven-effective-v1" &&
                (choice.set.kind === "test" || choice.set.kind === "integration-test") && (
                  <MavenTestJvmDetails
                    data={choice.set.mavenTestJvm}
                    isBusy={isBusy || isWriting}
                    onRequest={
                      context.status === "available" && controller.inspectMavenTestJvm
                        ? () => void controller.inspectMavenTestJvm?.(choice.module.id, choice.set.id)
                        : undefined
                    }
                  />
                )}
              <JpmsDetails
                data={choice.set.jpms}
                isBusy={isBusy}
                onRequest={
                  context.status === "available" &&
                  context.semanticAnalysis?.availability !== "unqualified" &&
                  !ambiguousSourceSelection
                    ? () =>
                        void controller.inspectJpms(
                          supportsProviderQualifiedSourceSelection
                            ? choice.module.providerId
                            : undefined,
                          choice.module.id,
                          choice.set.id,
                        )
                    : undefined
                }
              />
              {choice.set.moduleDependencies.length ? (
                <details className="mt-3">
                  <summary>Module dependencies</summary>
                  <ul>
                    {choice.set.moduleDependencies.map((edge) => (
                      <li key={`${edge.moduleId}:${edge.scope}`}>
                        {edge.moduleId} · {edge.scope}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <details className="mt-3">
                <summary>Inspect source ownership</summary>
                <label className="mt-2 block">
                  Source-relative path
                  <input
                    className={field}
                    placeholder="pkg/Runner.java"
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                  />
                </label>
                <label className="mt-2 block">
                  Qualified type (optional)
                  <input
                    className={field}
                    value={symbol}
                    placeholder="pkg.Runner"
                    onChange={(e) => setSymbol(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="mt-2 underline"
                  disabled={
                    isBusy ||
                    context.status !== "available" ||
                    ambiguousSourceSelection ||
                    (context.semanticAnalysis?.availability === "unqualified"
                      ? context.schemaVersion !== "java-project-context-v7" ||
                        !sourcePath.trim() ||
                        Boolean(symbol.trim())
                      : !sourcePath && !symbol)
                  }
                  onClick={() => {
                    void controller.inspectSource(
                      supportsProviderQualifiedSourceSelection
                        ? choice.module.providerId
                        : undefined,
                      choice.module.id,
                      choice.set.id,
                      sourcePath,
                      symbol,
                    );
                  }}
                >
                  Resolve source ownership
                </button>
                {ambiguousSourceSelection ? (
                  <p role="status" className="mt-2 text-[var(--text-muted)]">
                    Source ownership is unavailable because RefactorKit does not advertise
                    provider-qualified Java source selection.
                  </p>
                ) : null}
                {context.semanticAnalysis?.availability === "unqualified" ? (
                  <p role="status" className="mt-2 text-[var(--text-muted)]">
                    {context.schemaVersion === "java-project-context-v7"
                      ? "Java symbol analysis is unavailable. Clear the optional type field to inspect source-file ownership by path."
                      : "Source-file ownership and Java analysis are unavailable for this metadata-only context."}
                  </p>
                ) : null}
              </details>
            </div>
          ) : (
            <p className="mt-2">No source sets reported.</p>
          )}
          {context.selectedSource ? (
            <p className="mt-3 break-all">
              {context.selectedSource.symbol ?? "Source"}: {context.selectedSource.path} ·{" "}
              {context.selectedSource.moduleId}/{context.selectedSource.sourceSetId}
              {context.selectedSource.generated ? " · generated" : ""}
            </p>
          ) : null}
        </div>
      ) : null}
      {onOpenTransactions && (
        <button
          type="button"
          disabled={isBusy || isWriting}
          onClick={onOpenTransactions}
          className="mt-3"
        >
          Java draft transactions
        </button>
      )}
      {children ? (
        <details className="mt-5 border-t border-[var(--border-default)] pt-3">
          <summary>Saved source structure</summary>
          {children}
        </details>
      ) : null}
    </section>
  );
}

export function workspaceRelativeProjectPath(
  workspaceRootPath: string,
  selectedPath: string,
): string | null {
  const absolute = /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/u;
  if (
    !absolute.test(workspaceRootPath) ||
    !absolute.test(selectedPath) ||
    workspaceRootPath.includes("\0") ||
    selectedPath.includes("\0")
  )
    return null;
  const windows =
    /^[A-Za-z]:[\\/]/u.test(workspaceRootPath) || /^(?:\\\\|\/\/)/u.test(workspaceRootPath);
  if (!windows && (workspaceRootPath.includes("\\") || selectedPath.includes("\\"))) return null;
  const normalize = (path: string) => {
    let result = windows ? path.replace(/\\/gu, "/") : path;
    if (result !== "/" && !/^([A-Za-z]:)\/$/u.test(result)) result = result.replace(/\/+$/u, "");
    return result;
  };
  const root = normalize(workspaceRootPath);
  const selected = normalize(selectedPath);
  const fold = (path: string) => (windows ? path.toLowerCase() : path);
  if (fold(root) === fold(selected)) return "";
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const relative = fold(selected).startsWith(fold(prefix)) ? selected.slice(prefix.length) : null;
  if (relative === null) return null;
  const segments = relative.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes(":"),
    )
  )
    return null;
  return segments.join("/");
}
