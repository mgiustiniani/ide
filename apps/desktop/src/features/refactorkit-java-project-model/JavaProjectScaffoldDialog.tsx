import { useEffect, useRef, useState } from "react";
import type {
  CreateJavaProjectRequest,
  JavaGradleDsl,
  JavaProjectBuildSystem,
  JavaProjectFramework,
  JavaProjectJavaRelease,
  JavaProjectLayout,
  JavaProjectContextAuthority,
} from "@ide/contracts";
import type { JavaProjectScaffoldPort } from "@ide/web-core";

type WorkspaceContext = Omit<JavaProjectContextAuthority, "workspaceId"> & {
  workspaceId: string | null;
  isSwitching: boolean;
  isMetadataLoading: boolean;
};

export function JavaProjectScaffoldDialog({
  open,
  buildSystem,
  layout,
  onLayoutChange,
  workspaceId,
  generation,
  port,
  getWorkspaceContext,
  onCreated,
  onClose,
}: {
  open: boolean;
  buildSystem: JavaProjectBuildSystem;
  layout: JavaProjectLayout;
  onLayoutChange(layout: JavaProjectLayout): void;
  workspaceId: string | null;
  generation: number;
  port: JavaProjectScaffoldPort;
  getWorkspaceContext(): WorkspaceContext;
  onCreated(path: string, authority: JavaProjectContextAuthority): Promise<void>;
  onClose(): void;
}) {
  const [artifactId, setArtifactId] = useState("my-java-app");
  const [groupId, setGroupId] = useState("com.example");
  const [packageName, setPackageName] = useState("com.example.app");
  const [javaRelease, setJavaRelease] = useState<JavaProjectJavaRelease>(25);
  const [gradleDsl, setGradleDsl] = useState<JavaGradleDsl>("groovy");
  const [framework, setFramework] = useState<JavaProjectFramework>("plain-java");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRequest = useRef<symbol | null>(null);
  useEffect(() => {
    setError(null);
    setBusy(false);
    return () => {
      pendingRequest.current = null;
    };
  }, [workspaceId, generation, open]);

  if (!open) return null;

  const current = () => {
    const active = getWorkspaceContext();
    return Boolean(
      workspaceId &&
      active.workspaceId === workspaceId &&
      active.generation === generation &&
      !active.isSwitching &&
      !active.isMetadataLoading,
    );
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRequest.current !== null) return;
    if (!current()) {
      setError("The workspace changed. Reopen the project wizard in the active workspace.");
      return;
    }
    const authority = { workspaceId: workspaceId!, generation };
    const projectLayout = framework === "spring-boot-mvc" ? "single-module" : layout;
    const request: CreateJavaProjectRequest = {
      ...authority,
      requestId: globalThis.crypto?.randomUUID?.() ?? `java-project-${Date.now()}`,
      buildSystem,
      ...(buildSystem === "gradle" ? { gradleDsl } : {}),
      framework,
      layout: projectLayout,
      artifactId,
      groupId,
      packageName,
      javaRelease,
    };
    const attempt = Symbol();
    pendingRequest.current = attempt;
    const ownsRequest = () => pendingRequest.current === attempt;
    setBusy(true);
    setError(null);
    try {
      const result = await port.createProject(request);
      if (!ownsRequest()) return;
      if (
        !current() ||
        result.workspaceId !== authority.workspaceId ||
        result.generation !== authority.generation ||
        result.requestId !== request.requestId
      )
        throw new Error("The workspace changed before project creation completed.");
      await onCreated(result.projectPath, authority);
      if (ownsRequest() && current()) onClose();
    } catch (failure) {
      if (ownsRequest())
        setError(failure instanceof Error ? failure.message : "Java project creation failed.");
    } finally {
      if (ownsRequest()) {
        pendingRequest.current = null;
        setBusy(false);
      }
    }
  };
  const field =
    "mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--input-bg)] px-2 py-1 text-[var(--text-primary)]";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="java-project-wizard-title"
        className="w-full max-w-lg space-y-3 rounded border border-[var(--border-default)] bg-[var(--panel-bg)] p-4 text-sm text-[var(--text-primary)] shadow-xl"
        onSubmit={(event) => void submit(event)}
      >
        <div>
          <h2 id="java-project-wizard-title" className="text-base font-semibold">
            New {buildSystem === "maven" ? "Maven" : "Gradle"} Java project
          </h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Creates a {buildSystem === "maven" ? "Maven" : "Gradle"} starter{" "}
            {layout === "multi-module"
              ? "with application and library modules plus JUnit tests"
              : "application with a JUnit test"}{" "}
            inside the active workspace and selects it in Java Project. It includes a pinned wrapper
            whose first run downloads and verifies its build-tool distribution. The Gradle wrapper
            selects a distribution compatible with the selected JDK. Gradle build-script evaluation
            requires a separate explicit action.
          </p>
        </div>
        <label className="block">
          {buildSystem === "maven"
            ? "Project folder and artifact ID"
            : "Project folder and Gradle root project name"}
          <input
            className={field}
            value={artifactId}
            maxLength={64}
            required
            onChange={(e) => setArtifactId(e.target.value)}
          />
        </label>
        <label className="block">
          Project type
          <select
            className={field}
            value={framework}
            onChange={(event) => {
              const selected = event.target.value as JavaProjectFramework;
              setFramework(selected);
              if (selected === "spring-boot-mvc") {
                if (layout !== "single-module") onLayoutChange("single-module");
                setJavaRelease((release) => (release < 17 ? 17 : release > 25 ? 25 : release));
              }
            }}
          >
            <option value="plain-java">Plain Java</option>
            <option value="spring-boot-mvc">Spring Boot MVC application</option>
          </select>
        </label>
        {framework === "spring-boot-mvc" ? (
          <p className="text-xs text-[var(--text-secondary)]">
            Creates a Spring Boot 4.1.2 MVC application with a sample HTTP endpoint and test. This
            starter supports Java 17, 21, and 25 in a single module; dependency resolution requires
            access to Maven Central on the first build.
          </p>
        ) : null}
        <label className="block">
          Project layout
          <select
            className={field}
            value={layout}
            onChange={(event) => onLayoutChange(event.target.value as JavaProjectLayout)}
          >
            <option value="single-module">Single module</option>
            <option value="multi-module" disabled={framework !== "plain-java"}>
              Multi-module (application and library)
            </option>
          </select>
        </label>
        {buildSystem === "gradle" ? (
          <label className="block">
            Gradle DSL
            <select
              className={field}
              value={gradleDsl}
              onChange={(event) => setGradleDsl(event.target.value as JavaGradleDsl)}
            >
              <option value="groovy">Groovy (build.gradle)</option>
              <option value="kotlin">Kotlin (build.gradle.kts)</option>
            </select>
          </label>
        ) : null}
        <label className="block">
          Group ID
          <input
            className={field}
            value={groupId}
            maxLength={192}
            required
            onChange={(e) => setGroupId(e.target.value)}
          />
        </label>
        <label className="block">
          Java package
          <input
            className={field}
            value={packageName}
            maxLength={192}
            required
            onChange={(e) => setPackageName(e.target.value)}
          />
        </label>
        <label className="block">
          Java release
          <select
            className={field}
            value={javaRelease}
            aria-describedby={javaRelease >= 26 ? "java-project-wizard-release-help" : undefined}
            onChange={(event) =>
              setJavaRelease(Number(event.target.value) as JavaProjectJavaRelease)
            }
          >
            <option value={8} disabled={framework === "spring-boot-mvc"}>
              8
            </option>
            <option value={11} disabled={framework === "spring-boot-mvc"}>
              11
            </option>
            <option value={17}>17</option>
            <option value={21}>21</option>
            <option value={25}>25</option>
            <option value={26} disabled={framework === "spring-boot-mvc"}>
              26
            </option>
            <option value={27} disabled={framework === "spring-boot-mvc"}>
              27
            </option>
          </select>
        </label>
        {javaRelease >= 26 && (
          <p id="java-project-wizard-release-help" className="text-sm text-[var(--text-secondary)]">
            After creation, select a full JDK for Java {javaRelease} in Java Project.
            Project analysis depends on the configured RefactorKit version.
          </p>
        )}
        {error ? (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className="rounded px-3 py-1 hover:bg-[var(--highlight-bg)]"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-[var(--highlight-bg)] px-3 py-1 disabled:opacity-50"
            disabled={busy || !workspaceId}
          >
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
