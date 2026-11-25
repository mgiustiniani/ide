import { captureJavaProjectOperationContext } from "@ide/contracts";
import type {
  JavaEntryPoint,
  JavaEntryPointRequest,
  JavaEntryPointResult,
  JavaLaunchConfiguration,
  JavaEffectiveProjectContext,
  JavaProjectContextSettings,
} from "@ide/contracts";
import type { JavaEntryPointPort } from "@ide/web-core/ports";
import { useEffect, useRef, useState } from "react";

export function useJavaEntryPointDiscovery(options: {
  port?: JavaEntryPointPort;
  workspaceId: string | null;
  generation: number;
  enabled: boolean;
  trusted: boolean;
  busy: boolean;
  selectedConfigurationId: string;
  configuration: JavaLaunchConfiguration;
  projectContext?: {
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext | null;
  };
  reviewSavedBuffers?(): () => void;
  updateConfiguration(configuration: JavaLaunchConfiguration): void;
  runSelectedConfiguration?(
    expected: JavaLaunchConfiguration,
    operation: "run" | "debug",
  ): Promise<void>;
}) {
  const profileScope = JSON.stringify([
    options.workspaceId,
    options.generation,
    options.selectedConfigurationId,
  ]);
  const [profileChoice, setProfileChoice] = useState<{
    scope: string;
    value: NonNullable<JavaEntryPointRequest["launchProfile"]>;
  }>();
  const launchProfile =
    profileChoice?.scope === profileScope ? profileChoice.value : "classic-declared-v1";
  const [state, setState] = useState<{
    owner: object;
    key: string;
    pending: boolean;
    message: string;
    result?: JavaEntryPointResult;
    sourcePath?: string;
    sourceOperation?: "run" | "debug";
  }>();
  const active = useRef<{
    key: string;
    request: JavaEntryPointRequest;
    port: JavaEntryPointPort;
    verify: () => void;
  }>();
  const selectionReview = useRef<{
    key: string;
    result: JavaEntryPointResult;
    verify: () => void;
  }>();
  const latest = useRef(options);
  latest.current = options;
  const key = JSON.stringify([
    options.workspaceId,
    options.generation,
    options.enabled,
    options.trusted,
    options.busy,
    options.selectedConfigurationId,
    options.configuration,
    options.projectContext,
    launchProfile,
  ]);
  const lifecycle = useRef({ key, port: options.port });
  if (lifecycle.current.key !== key || lifecycle.current.port !== options.port)
    lifecycle.current = { key, port: options.port };
  const owner = lifecycle.current;
  const isCurrent = () => lifecycle.current === owner;
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    lifecycle.current = owner;
    setState(undefined);
    selectionReview.current = undefined;
    return () => {
      if (lifecycle.current === owner) lifecycle.current = { key, port: options.port };
      const previous = active.current;
      active.current = undefined;
      selectionReview.current = undefined;
      if (previous)
        void previous.port.cancel(previous.request, previous.request.requestId).catch(() => {});
    };
  }, [key, options.port, owner]);
  const selected = options.configuration.projectModule;
  const modules =
    options.projectContext?.context?.modules.filter(
      (m) =>
        m.id === selected?.moduleId &&
        (!selected.providerId || m.providerId === selected.providerId),
    ) ?? [];
  const module = modules.length === 1 ? modules[0] : undefined;
  const sourceSet = module?.sourceSets.filter((s) => s.id === selected?.sourceSetId);
  let capturedContext: ReturnType<typeof captureJavaProjectOperationContext>;
  try {
    capturedContext = captureJavaProjectOperationContext(options.projectContext);
  } catch {
    capturedContext = undefined;
  }
  const available =
    !!options.port &&
    !!options.workspaceId &&
    options.enabled &&
    options.trusted &&
    !options.busy &&
    !!module &&
    sourceSet?.length === 1 &&
    !!capturedContext;
  async function discover(source?: {
    path: string;
    isCurrent(): boolean;
    operation?: "run" | "debug";
    position?: { line: number; character: number };
  }) {
    if (!isCurrent() || !available || active.current) return;
    const captured = latest.current;
    try {
      const context = captureJavaProjectOperationContext(captured.projectContext);
      if (!context || !captured.port || !captured.workspaceId || !module || !selected) return;
      const verifyBuffers = captured.reviewSavedBuffers?.();
      if (!verifyBuffers)
        throw new Error("Saved-source review is unavailable. Save the project and retry.");
      const verify = () => {
        if (!isCurrent())
          throw new Error("Main-class discovery belongs to a retired Java configuration.");
        verifyBuffers();
        if (!isCurrent())
          throw new Error("Main-class discovery belongs to a retired Java configuration.");
        if (source && !source.isCurrent())
          throw new Error(
            "The Java source action changed. Run discovery again from the current file.",
          );
      };
      verify();
      const request: JavaEntryPointRequest = {
        workspaceId: captured.workspaceId,
        generation: captured.generation,
        requestId: crypto.randomUUID(),
        projectContext: context,
        scope: {
          providerId: module.providerId,
          moduleId: module.id,
          sourceSetId: selected.sourceSetId,
        },
        limit: 100,
        ...(launchProfile !== "classic-declared-v1"
          ? { entryPointSchemaVersion: "java-entry-points-v2" as const, launchProfile }
          : {}),
        ...(source
          ? { path: source.path, ...(source.position ? { position: source.position } : {}) }
          : {}),
      };
      const flight = { key, request, port: captured.port, verify };
      active.current = flight;
      setState({
        owner,
        key,
        pending: true,
        sourcePath: source?.path,
        sourceOperation: source ? (source.operation ?? "run") : undefined,
        message: "Discovering main classes in saved sources…",
      });
      try {
        const result = await captured.port.query(request);
        if (!isCurrent() || active.current !== flight || currentKey.current !== key) return;
        verify();
        selectionReview.current = { key, result, verify };
        setState({
          owner,
          key,
          pending: false,
          message: result.message,
          result,
          sourcePath: source?.path,
          sourceOperation: source ? (source.operation ?? "run") : undefined,
        });
        if (
          source &&
          result.discovery?.candidates.length === 1 &&
          result.discovery.scopeAnalysisComplete &&
          !result.discovery.truncated &&
          result.discovery.totalEligibleCount === 1
        ) {
          await applyCandidate(result.discovery.candidates[0], verify, source.operation ?? "run");
        }
      } finally {
        if (active.current === flight) active.current = undefined;
      }
    } catch (error) {
      if (isCurrent() && currentKey.current === key)
        setState({
          owner,
          key,
          pending: false,
          message: error instanceof Error ? error.message : "Main-class discovery failed.",
        });
    }
  }
  // The captured buffer review is also required when selecting a previously displayed candidate.
  const visible = state?.owner === owner && state.key === key ? state : undefined;
  async function applyCandidate(
    candidate: JavaEntryPoint,
    verify: () => void,
    operation: "run" | "debug" | undefined,
  ) {
    verify();
    const expected = { ...latest.current.configuration, mainClass: candidate.binaryName };
    latest.current.updateConfiguration(expected);
    if (operation) {
      if (!latest.current.runSelectedConfiguration)
        throw new Error("Running a discovered main is unavailable.");
      await latest.current.runSelectedConfiguration(expected, operation);
    }
  }
  async function select(candidate: JavaEntryPoint) {
    const review = selectionReview.current;
    if (
      !isCurrent() ||
      !available ||
      !visible?.result?.discovery?.candidates.some((item) => item === candidate) ||
      review?.result !== visible.result ||
      review.key !== key
    )
      return;
    try {
      await applyCandidate(
        candidate,
        review.verify,
        visible.sourcePath ? (visible.sourceOperation ?? "run") : undefined,
      );
    } catch (error) {
      if (isCurrent() && currentKey.current === key)
        setState({
          owner,
          key,
          pending: false,
          message:
            error instanceof Error
              ? error.message
              : "Saved sources changed. Discover main classes again.",
        });
    }
  }
  function cancel() {
    const flight = active.current;
    if (!isCurrent() || !flight || flight.key !== key) return;
    active.current = undefined;
    selectionReview.current = undefined;
    setState({ owner, key, pending: false, message: "Main-class discovery was cancelled." });
    void flight.port.cancel(flight.request, flight.request.requestId).catch(() => {});
  }
  return {
    cancel,
    launchProfile,
    setLaunchProfile: (value: NonNullable<JavaEntryPointRequest["launchProfile"]>) => {
      if (
        isCurrent() &&
        !options.busy &&
        ["classic-declared-v1", "inherited-v1", "java25-v1"].includes(value)
      )
        setProfileChoice({ scope: profileScope, value });
    },
    available,
    sourceAvailable: available && !!options.runSelectedConfiguration,
    sourcePath: visible?.sourcePath,
    sourceOperation: visible?.sourceOperation,
    pending: visible?.pending === true,
    message: visible?.message,
    result: visible?.result,
    discover,
    select,
  };
}
