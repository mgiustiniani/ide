import { useEffect, useRef, useState } from "react";
import type {
  CreateJavaProjectDeclarationRequest,
  JavaProjectContextAuthority,
} from "@ide/contracts";
import type { JavaProjectDeclarationPort } from "@ide/web-core/ports";
import {
  JavaProjectDeclarationModuleFields,
  javaProjectDeclarationConfiguration,
  newJavaProjectDeclarationDraft,
} from "./JavaProjectDeclarationModuleFields";
type Context = {
  workspaceId: string | null;
  generation: number;
  isSwitching: boolean;
  isMetadataLoading: boolean;
};
export function JavaProjectDeclarationDialog({
  workspaceId,
  generation,
  projectPath,
  sdkHome,
  port,
  getWorkspaceContext,
  onCreated,
  onClose,
}: {
  workspaceId: string;
  generation: number;
  projectPath: string;
  sdkHome: string;
  port: JavaProjectDeclarationPort;
  getWorkspaceContext(): Context;
  onCreated(path: string, authority: JavaProjectContextAuthority): Promise<void>;
  onClose(): void;
}) {
  const [modules, setModules] = useState(() => [newJavaProjectDeclarationDraft()]);
  const nextModule = useRef(1);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => {
    const active = getWorkspaceContext();
    return (
      mounted.current &&
      active.workspaceId === workspaceId &&
      active.generation === generation &&
      !active.isSwitching &&
      !active.isMetadataLoading
    );
  };
  async function save() {
    if (flight.current || !current()) return;
    flight.current = true;
    setPending(true);
    setError(null);
    try {
      if (!sdkHome.trim()) throw new Error("Select a full JDK in Java Project first.");
      const primary = modules[0]!;
      const request: CreateJavaProjectDeclarationRequest = {
        workspaceId,
        generation,
        requestId: crypto.randomUUID(),
        projectPath,
        sdkHome,
        ...javaProjectDeclarationConfiguration(primary),
        ...(modules.length > 1
          ? {
              additionalModules: modules.slice(1).map((module) => ({
                id: module.id.trim(),
                root: module.root.trim(),
                ...javaProjectDeclarationConfiguration(module),
              })),
            }
          : {}),
      };
      const result = await port.create(request);
      if (!current()) return;
      await onCreated(result.path, { workspaceId, generation });
      if (current()) onClose();
    } catch (error) {
      if (current())
        setError(
          error instanceof Error ? error.message : "The Java declaration could not be created.",
        );
    } finally {
      flight.current = false;
      if (current()) setPending(false);
    }
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Declare plain Java project"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <form
        className="flex max-h-[90vh] w-[36rem] flex-col gap-3 overflow-auto rounded border border-[var(--border-default)] bg-[var(--surface-panel)] p-5 text-[var(--text-primary)]"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2>Declare plain Java project</h2>
        <p>
          Configure sources and dependencies without Maven or Gradle. RefactorKit validates this
          declaration; your selected JDK compiles and runs the code. Annotation processing is
          disabled.
        </p>
        <p>Project directory: {projectPath || "Workspace root"}</p>
        <p>JDK: {sdkHome || "Select a JDK in Java Project"}</p>
        {modules.map((module, index) => (
          <fieldset
            key={module.key}
            aria-label={index === 0 ? "Primary Java module" : `Additional Java module ${index}`}
            className="flex flex-col gap-3 border border-[var(--border-default)] p-3"
            disabled={pending}
          >
            <legend>{index === 0 ? "Primary module: app" : `Additional module ${index}`}</legend>
            <JavaProjectDeclarationModuleFields
              value={module}
              pending={pending}
              additional={index !== 0}
              onChange={(value) =>
                setModules((current) =>
                  current.map((item) => (item.key === module.key ? value : item)),
                )
              }
            />
            {index !== 0 && (
              <button
                type="button"
                onClick={() =>
                  setModules((current) => current.filter((item) => item.key !== module.key))
                }
              >
                Remove module
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          disabled={pending || modules.length >= 64}
          onClick={() => {
            const index = nextModule.current++;
            setModules((current) => [
              ...current,
              newJavaProjectDeclarationDraft(index, current[0]!.release),
            ]);
          }}
        >
          Add module
        </button>
        {error && <p role="alert">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={pending || !sdkHome.trim()}>
            Create declaration
          </button>
          <button type="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
