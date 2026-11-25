import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { startTransition, useState } from "react";
import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import type { JavaProjectContextChangeEvent, JavaProjectContextPort } from "@ide/web-core";
import type {
  JavaProjectContextRequest,
  JavaProjectLanguageSettingsResult,
  JavaProjectContextResult,
  RefactorKitCapabilities,
} from "@ide/contracts";
import { javaProjectContextResponse } from "../../../../../tests/story/fixtures/java-project-context-response";
import { useJavaProjectContextController } from "./useJavaProjectContextController";
import { JavaProjectContextPanel, workspaceRelativeProjectPath } from "./JavaProjectContextPanel";

function setup(
  supportsProviderQualifiedSourceAssociation = false,
  supportsAggregateGradleCompositeIdentity = false,
  supportsJavaProjectContextV7 = false,
  canRefreshSourceContext?: () => boolean,
) {
  let workspace = {
    workspaceId: "one" as string | null,
    generation: 1,
    isSwitching: false,
    isMetadataLoading: false,
  };
  const port: JavaProjectContextPort = {
    query: vi.fn(async (request) => javaProjectContextResponse(request)),
    stop: vi.fn(async () => {}),
  };
  const props = () => ({
    port,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    supportsProviderQualifiedSourceAssociation,
    supportsJavaProjectContextV7,
    supportsAggregateGradleCompositeIdentity,
    getWorkspaceContext: () => workspace,
    canRefreshSourceContext,
  });
  const hook = renderHook(() => useJavaProjectContextController(props()));
  act(() =>
    hook.result.current.setSettings({
      projectPath: "",
      sdkHome: "/sdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    }),
  );
  return {
    hook,
    port,
    getWorkspaceContext: () => workspace,
    switchWorkspace() {
      workspace = { ...workspace, workspaceId: "two", generation: 2 };
      hook.rerender();
    },
  };
}
describe("Java project synchronization", () => {
  it("recovers saved files only after explicit approval under the workspace write guard", async () => {
    const { hook, port } = setup();
    const recover = vi.fn(async () => {});
    port.recoverSavedSources = recover;
    vi.mocked(port.query).mockImplementation(async (request) => ({
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      projectPath: request.projectPath,
      status: "refused",
      code: "ide.java.context.savedSourceRecoveryRequired",
      message: "An interrupted saved-file transaction requires recovery.",
    }));
    await act(() => hook.result.current.synchronize());
    const request = hook.result.current.savedSourceRecovery!;
    expect(request).toBeDefined();
    expect(recover).not.toHaveBeenCalled();
    const onConfirm = vi.fn(async () => {});
    render(<JavaProjectContextPanel controller={hook.result.current} onRecoverSavedSources={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Review saved-file recovery" }));
    expect(screen.getByRole("group", { name: "Confirm saved-file recovery" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel recovery" }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review saved-file recovery" }));
    fireEvent.click(screen.getByRole("button", { name: "Recover saved files" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(request);
    const release = vi.fn();
    const beginWrite = vi.fn(() => release);
    const reconcile = vi.fn(async (isCurrent: () => boolean, recovered: boolean) => {
      expect(isCurrent()).toBe(true);
      expect(recovered).toBe(true);
      expect(release).not.toHaveBeenCalled();
      return undefined;
    });
    beginWrite.mockImplementationOnce(() => {
      throw new Error("Save open drafts before continuing.");
    });
    await act(() => hook.result.current.recoverSavedSources!(request, beginWrite, reconcile));
    expect(recover).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe("Save open drafts before continuing.");
    await act(() => hook.result.current.recoverSavedSources!(request, beginWrite, reconcile));
    expect(recover).toHaveBeenCalledExactlyOnceWith(request);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(hook.result.current.savedSourceRecovery).toBeUndefined();
    expect(hook.result.current.message).toMatch(/Synchronize the project again/);
  });

  it("keeps a scaffolded project selected for synchronization during an intervening render", async () => {
    const workspace = {
      workspaceId: "one",
      generation: 1,
      isSwitching: false,
      isMetadataLoading: false,
    };
    const port: JavaProjectContextPort = {
      query: vi.fn(async (request) => javaProjectContextResponse(request)),
      stop: vi.fn(async () => {}),
    };
    let renderExplorerUpdate = () => {};
    const hook = renderHook(() => {
      const [, setExplorerLoading] = useState(true);
      renderExplorerUpdate = () => setExplorerLoading(false);
      return useJavaProjectContextController({
        port,
        ...workspace,
        getWorkspaceContext: () => workspace,
      });
    });
    const selection = {
      workspaceId: workspace.workspaceId,
      generation: workspace.generation,
      settings: { ...hook.result.current.settings, projectPath: "gradle-starter" },
    };

    await act(async () => {
      startTransition(() => hook.result.current.setSettings(selection.settings));
      flushSync(renderExplorerUpdate);
      expect(hook.result.current.settings.projectPath).toBe("");
      await hook.result.current.synchronize(selection);
    });

    expect(hook.result.current.settings.projectPath).toBe("gradle-starter");
    expect(hook.result.current.error).toBe("Select a full JDK home before synchronizing the project.");
    expect(port.query).not.toHaveBeenCalled();
  });

  it("synchronizes a scaffolded project only while its captured workspace and settings are current", async () => {
    const { hook, port, switchWorkspace } = setup();
    const selection = {
      workspaceId: "one",
      generation: 1,
      settings: { ...hook.result.current.settings, projectPath: "created" },
    };
    act(() => hook.result.current.setSettings(selection.settings));
    await act(() => hook.result.current.synchronize(selection));
    expect(port.query).toHaveBeenCalledOnce();
    expect(port.query).toHaveBeenCalledWith(expect.objectContaining({ projectPath: "created" }));
    vi.mocked(port.query).mockClear();

    act(() => hook.result.current.setSettings({ ...selection.settings, projectPath: "different" }));
    await act(() => hook.result.current.synchronize(selection));
    expect(port.query).not.toHaveBeenCalled();
    act(() => switchWorkspace());
    act(() => hook.result.current.setSettings(selection.settings));
    await act(() => hook.result.current.synchronize(selection));
    expect(port.query).not.toHaveBeenCalled();
  });

  it("reviews fresh source-navigation context and retires its guard on replacement, disk changes and workspace switches", async () => {
    const { hook, port, switchWorkspace } = setup(true, false, true);
    let changed: ((event: JavaProjectContextChangeEvent) => void) | undefined;
    port.watch = vi.fn(async (_binding, _path, _id, listener) => {
      changed = listener;
      return () => {};
    });
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      response.context.schemaVersion = request.providerId
        ? "java-project-context-v7"
        : "java-project-context-v2";
      return response;
    });
    let first!: Awaited<ReturnType<typeof hook.result.current.reviewForSourceNavigation>>;
    await act(async () => {
      first = await hook.result.current.reviewForSourceNavigation(hook.result.current.settings);
      expect(first.isCurrent()).toBe(true);
    });
    expect(first.context.schemaVersion).toBe("java-project-context-v7");
    expect(
      vi.mocked(port.query).mock.calls.every(([request]) => request.evaluateGradle !== true),
    ).toBe(true);
    expect(vi.mocked(port.query).mock.calls.at(-1)?.[0]).toMatchObject({
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
    });
    let second!: typeof first;
    await act(async () => {
      second = await hook.result.current.reviewForSourceNavigation(hook.result.current.settings);
    });
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    act(() => changed?.({ status: "changed" } as JavaProjectContextChangeEvent));
    expect(second.isCurrent()).toBe(false);
    let third!: typeof first;
    await act(async () => {
      third = await hook.result.current.reviewForSourceNavigation(hook.result.current.settings);
    });
    act(() => switchWorkspace());
    expect(third.isCurrent()).toBe(false);
  });

  it("rejects source-navigation settings changes and a canceled acquisition", async () => {
    const { hook, port } = setup(true);
    const expected = { ...hook.result.current.settings, sdkHome: "/other-jdk" };
    await expect(hook.result.current.reviewForSourceNavigation(expected)).rejects.toThrow(
      /settings changed/,
    );
    expect(port.query).not.toHaveBeenCalled();
    vi.mocked(port.query).mockImplementation(async (request) => {
      hook.result.current.cancel();
      return javaProjectContextResponse(request);
    });
    await act(async () => {
      await expect(
        hook.result.current.reviewForSourceNavigation(hook.result.current.settings),
      ).rejects.toThrow(/Synchronize Java Project/);
    });
  });

  it("keeps a valid Maven context when the provider reports no Gradle modules", async () => {
    const { hook, port } = setup(true, true);

    await act(() => hook.result.current.synchronize());

    expect(port.query).toHaveBeenCalledOnce();
    expect(hook.result.current.context?.status).toBe("available");
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.message).toBe("Effective Java project context synchronized.");
  });

  it("shows provider-supplied Maven module coordinates in the project context panel", async () => {
    const { hook, port } = setup();
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      response.context.modules[0]!.coordinates = {
        groupId: "org.example",
        artifactId: "service",
        version: "2.4.1",
      };
      return response;
    });
    await act(() => hook.result.current.synchronize());

    render(<JavaProjectContextPanel controller={hook.result.current} />);

    expect(screen.getByText(/Module coordinates:/).textContent).toContain(
      "org.example:service:2.4.1",
    );
  });

  it("offers explorer navigation for the selected source set's generated roots", async () => {
    const { hook } = setup();
    await act(() => hook.result.current.synchronize());
    const reveal = vi.fn();
    render(<JavaProjectContextPanel controller={hook.result.current} onRevealGeneratedSourceRoot={reveal} />);
    const actions = screen.getAllByRole("button", { name: /^Reveal generated source root/ });
    expect(actions).toHaveLength(1);
    fireEvent.click(actions[0]);
    expect(reveal).toHaveBeenCalledWith("app/target/generated-sources/annotations");
  });

  it("requests Maven test JVM facts for the selected source set and exposes incomplete facts", async () => {
    const { hook, port } = setup(true, false, true);
    let releaseDetails!: () => void;
    const pendingDetails = new Promise<void>((resolve) => { releaseDetails = resolve; });
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      const module = response.context.modules[0]!;
      const sourceSet = {
        ...module.sourceSets[0]!,
        id: "app-failsafe",
        kind: "integration-test" as const,
      };
      module.sourceSets.push(sourceSet);
      if (request.sourceSetId) {
        await pendingDetails;
        response.context.schemaVersion = "java-project-context-v7";
        Object.assign(sourceSet, {
          mavenTestJvm: {
            availability: "partial",
            mode: "unknown",
            refusalCode: "java.context.mavenTestJvmConfigurationIncomplete",
            executions: [],
          },
        });
      }
      return response;
    });
    await act(() => hook.result.current.synchronize());
    const view = render(<JavaProjectContextPanel controller={hook.result.current} />);
    expect(screen.queryByText(/Maven test JVM/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Module and source set"), {
      target: { value: JSON.stringify(["maven-effective-v1", "app", "app-failsafe"]) },
    });
    fireEvent.click(screen.getByText("Maven test JVM · not reported"));
    fireEvent.click(screen.getByRole("button", { name: "Request Maven test JVM details" }));
    await waitFor(() => expect(hook.result.current.context).toBeNull());
    view.rerender(<JavaProjectContextPanel controller={hook.result.current} />);
    await act(async () => releaseDetails());
    await waitFor(() => expect(hook.result.current.context?.schemaVersion).toBe("java-project-context-v7"));
    expect(port.query).toHaveBeenLastCalledWith(expect.objectContaining({
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "app-failsafe",
      expectedSnapshotHash: "a".repeat(64),
    }));
    expect(vi.mocked(port.query).mock.lastCall?.[0].expectedContextHash).toBeUndefined();
    view.rerender(<JavaProjectContextPanel controller={hook.result.current} />);
    fireEvent.click(screen.getByText("Maven test JVM · partial"));
    expect(screen.getByText("java.context.mavenTestJvmConfigurationIncomplete")).toBeTruthy();
  });

  it("shows fork settings and argLine provenance without rendering argument text", async () => {
    const { hook, port } = setup();
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      response.context.schemaVersion = "java-project-context-v7";
      const module = response.context.modules[0]!;
      module.sourceSets.push({
        ...module.sourceSets[0]!,
        id: "test",
        kind: "test",
        mavenTestJvm: {
          availability: "complete",
          mode: "forked",
          refusalCode: null,
          executions: [{
            pluginId: "org.apache.maven.plugins:maven-surefire-plugin",
            pluginVersion: "3.5.3",
            executionId: "default-test",
            goals: ["test"],
            phase: "test",
            availability: "complete",
            mode: "forked",
            refusalCode: null,
            forkSettings: [{
              name: "forkCount", value: "1", origin: "plugin default", availability: "complete", redacted: false,
            }],
            argLineLayers: [
              { name: "argLine", value: "configured-argument", origin: "module POM", availability: "complete", redacted: false },
              { name: "argLine", value: null, origin: "profile", availability: "partial", redacted: true },
            ],
            effectiveArgLineTemplate: "effective-argument",
          }],
        },
      });
      return response;
    });
    await act(() => hook.result.current.synchronize());
    const view = render(<JavaProjectContextPanel controller={hook.result.current} />);
    fireEvent.change(screen.getByLabelText("Module and source set"), {
      target: { value: JSON.stringify(["maven-effective-v1", "app", "test"]) },
    });
    fireEvent.click(screen.getByText("Maven test JVM · complete"));
    expect(screen.getByText(/maven-surefire-plugin:3.5.3 · default-test/)).toBeTruthy();
    expect(screen.getByText("forkCount · 1")).toBeTruthy();
    expect(screen.getByText("argLine · configured")).toBeTruthy();
    expect(screen.getByText("argLine · [redacted]")).toBeTruthy();
    expect(screen.getByText("module POM")).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/configured-argument|effective-argument/u);
  });

  it("applies provider-derived language settings only for the current synchronized context", async () => {
    const { hook, port } = setup();
    const appliedMessage = "Applied verified Gradle preview settings.";
    port.applyLanguageSettings = vi.fn(async (request) => ({
      ...request,
      outcome: "applied" as const,
      message: appliedMessage,
    }));
    port.clearLanguageSettings = vi.fn(async () => {});
    act(() =>
      hook.result.current.setSettings({
        ...hook.result.current.settings,
        gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
      }),
    );
    await act(() => hook.result.current.synchronize());

    await act(async () => {
      await hook.result.current.applyLanguageSettings();
    });
    expect(port.applyLanguageSettings).toHaveBeenCalledWith({
      workspaceId: "one",
      generation: 1,
      projectPath: "",
      contextSchemaVersion: hook.result.current.context?.schemaVersion,
      snapshotHash: hook.result.current.context?.snapshotHash,
      contextHash: hook.result.current.context?.contextHash,
    });
    expect(hook.result.current.message).toBe(appliedMessage);

    act(() => hook.result.current.retireContext());
    await waitFor(() =>
      expect(port.clearLanguageSettings).toHaveBeenCalledWith({
        workspaceId: "one",
        generation: 1,
      }),
    );
  });

  it("publishes the context after watcher setup so JDT LS outcomes stay visible", async () => {
    const { hook, port } = setup();
    let resolveWatch!: (stop: () => void) => void;
    port.watch = vi.fn(
      async () =>
        await new Promise<() => void>((resolve) => {
          resolveWatch = resolve;
        }),
    );
    const appliedMessage = "Applied verified Gradle preview settings.";
    port.applyLanguageSettings = vi.fn(async (request) => ({
      ...request,
      outcome: "applied" as const,
      message: appliedMessage,
    }));
    act(() =>
      hook.result.current.setSettings({
        ...hook.result.current.settings,
        gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
      }),
    );

    let synchronization!: Promise<void>;
    await act(async () => {
      synchronization = hook.result.current.synchronize();
      await Promise.resolve();
    });
    expect(hook.result.current.context).toBeNull();
    expect(port.applyLanguageSettings).not.toHaveBeenCalled();

    await act(async () => {
      resolveWatch(() => {});
      await synchronization;
    });
    expect(hook.result.current.context?.status).toBe("available");

    await act(async () => {
      await hook.result.current.applyLanguageSettings();
    });
    expect(hook.result.current.message).toBe(appliedMessage);
  });

  it("retires the acquired context when a correlated project input changes on disk", async () => {
    const { hook, port } = setup();
    let notify!: (event: JavaProjectContextChangeEvent) => void;
    let watchId = "";
    const stop = vi.fn();
    port.watch = vi.fn(async (_authority, _projectPath, id, listener) => {
      watchId = id;
      notify = listener;
      return stop;
    });
    await act(() => hook.result.current.synchronize());
    expect(port.watch).toHaveBeenCalledWith(
      { workspaceId: "one", generation: 1 },
      "",
      expect.stringMatching(/^java-project-watch-/),
      expect.any(Function),
    );
    expect(hook.result.current.context?.status).toBe("available");
    vi.mocked(port.stop).mockClear();
    act(() =>
      notify({
        workspaceId: "one",
        generation: 1,
        projectPath: "",
        watchId,
        status: "changed",
      }),
    );
    expect(hook.result.current.context).toBeNull();
    expect(hook.result.current.message).toMatch(/changed on disk/i);
    expect(stop).toHaveBeenCalledOnce();
    expect(port.stop).not.toHaveBeenCalled();
  });

  it("refreshes source-only changes without evaluating Gradle or stopping the SDK session", async () => {
    vi.useFakeTimers();
    const h = setup(false, false, false, () => true);
    let notify!: (event: JavaProjectContextChangeEvent) => void;
    let watchId = "";
    h.port.watch = vi.fn(async (_authority, _path, id, listener) => {
      watchId = id;
      notify = listener;
      return () => {};
    });
    try {
      await act(() => h.hook.result.current.synchronize());
      vi.mocked(h.port.stop).mockClear();
      act(() =>
        notify({
          workspaceId: "one",
          generation: 1,
          projectPath: "",
          watchId,
          status: "changed",
          changeKind: "source",
        }),
      );
      expect(h.hook.result.current.context).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(h.port.query).toHaveBeenCalledTimes(2);
      expect(vi.mocked(h.port.query).mock.calls[1][0].evaluateGradle).toBeUndefined();
      expect(h.port.stop).not.toHaveBeenCalled();
      expect(h.hook.result.current.context?.status).toBe("available");
    } finally {
      h.hook.unmount();
      vi.useRealTimers();
    }
  });
  it("waits for language-setting cleanup and still cancels a refresh paused after its timer", async () => {
    vi.useFakeTimers();
    const h = setup(false, false, false, () => true);
    let notify!: (event: JavaProjectContextChangeEvent) => void;
    let watchId = "";
    h.port.watch = vi.fn(async (_authority, _path, id, listener) => {
      watchId = id;
      notify = listener;
      return () => {};
    });
    try {
      await act(() => h.hook.result.current.synchronize());
      let cleaned!: () => void;
      h.port.clearLanguageSettings = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((done) => {
              cleaned = done;
            }),
        )
        .mockResolvedValue(undefined);
      act(() =>
        notify({
          workspaceId: "one",
          generation: 1,
          projectPath: "",
          watchId,
          status: "changed",
          changeKind: "source",
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(h.port.query).toHaveBeenCalledOnce();
      await act(() => h.hook.result.current.pauseMonitoring());
      await act(async () => {
        cleaned();
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(h.port.query).toHaveBeenCalledOnce();
    } finally {
      h.hook.unmount();
      vi.useRealTimers();
    }
  });
  it("refreshes after a short editor operation ends before the source-refresh timer", async () => {
    vi.useFakeTimers();
    let ready = false;
    const h = setup(false, false, false, () => ready);
    let notify!: (event: JavaProjectContextChangeEvent) => void;
    let watchId = "";
    h.port.watch = vi.fn(async (_authority, _path, id, listener) => {
      watchId = id;
      notify = listener;
      return () => {};
    });
    try {
      await act(() => h.hook.result.current.synchronize());
      act(() =>
        notify({
          workspaceId: "one",
          generation: 1,
          projectPath: "",
          watchId,
          status: "changed",
          changeKind: "source",
        }),
      );
      ready = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(h.port.query).toHaveBeenCalledTimes(2);
    } finally {
      h.hook.unmount();
      vi.useRealTimers();
    }
  });
  it.each(["buildConfiguration", undefined] as const)(
    "keeps %s changes manual even with source refresh enabled",
    async (changeKind) => {
      vi.useFakeTimers();
      const h = setup(false, false, false, () => true);
      let notify!: (event: JavaProjectContextChangeEvent) => void;
      let watchId = "";
      h.port.watch = vi.fn(async (_authority, _path, id, listener) => {
        watchId = id;
        notify = listener;
        return () => {};
      });
      try {
        await act(() => h.hook.result.current.synchronize());
        act(() =>
          notify({
            workspaceId: "one",
            generation: 1,
            projectPath: "",
            watchId,
            status: "changed",
            ...(changeKind ? { changeKind } : {}),
          }),
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
        expect(h.port.query).toHaveBeenCalledOnce();
        expect(h.hook.result.current.context).toBeNull();
        expect(h.hook.result.current.message).toMatch(/Synchronize/);
      } finally {
        h.hook.unmount();
        vi.useRealTimers();
      }
    },
  );
  it.each(["workspace", "cancel", "write", "pause", "guardFailure"] as const)(
    "drops queued source refresh after %s changes",
    async (action) => {
      vi.useFakeTimers();
      let writable = true;
      let guardFailure = false;
      const h = setup(false, false, false, () => {
        if (guardFailure) throw new Error("editor unavailable");
        return writable;
      });
      let notify!: (event: JavaProjectContextChangeEvent) => void;
      let watchId = "";
      h.port.watch = vi.fn(async (_authority, _path, id, listener) => {
        watchId = id;
        notify = listener;
        return () => {};
      });
      try {
        await act(() => h.hook.result.current.synchronize());
        act(() =>
          notify({
            workspaceId: "one",
            generation: 1,
            projectPath: "",
            watchId,
            status: "changed",
            changeKind: "source",
          }),
        );
        if (action === "workspace") act(() => h.switchWorkspace());
        if (action === "cancel") act(() => h.hook.result.current.cancel());
        if (action === "write") writable = false;
        if (action === "guardFailure") guardFailure = true;
        if (action === "pause") await act(() => h.hook.result.current.pauseMonitoring());
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
        expect(h.port.query).toHaveBeenCalledOnce();
        expect(h.hook.result.current.context).toBeNull();
        if (action === "guardFailure") expect(h.hook.result.current.message).toMatch(/Synchronize/);
      } finally {
        h.hook.unmount();
        vi.useRealTimers();
      }
    },
  );
  it("waits for native file monitoring to stop before pausing it", async () => {
    const { hook, port } = setup();
    let finishStopping!: () => void;
    const stopping = new Promise<void>((resolve) => {
      finishStopping = resolve;
    });
    const stop = vi.fn(() => stopping);
    port.watch = vi.fn(async () => stop);
    await act(async () => hook.result.current.synchronize());

    let pauseFinished = false;
    let pause!: Promise<void>;
    await act(async () => {
      pause = hook.result.current.pauseMonitoring().then(() => {
        pauseFinished = true;
      });
      await Promise.resolve();
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(pauseFinished).toBe(false);

    finishStopping();
    await act(async () => pause);
    expect(pauseFinished).toBe(true);
  });

  it("keeps a usable manual context when native change tracking cannot start", async () => {
    const { hook, port } = setup();
    port.watch = vi.fn().mockRejectedValue(new Error("private watcher error"));
    await act(() => hook.result.current.synchronize());
    expect(hook.result.current.context?.status).toBe("available");
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.message).toMatch(/tracking is unavailable/i);
    expect(hook.result.current.message).not.toContain("private");
  });

  it("retires source authority for an editor rename without stopping its transaction-owning daemon", async () => {
    const { hook, port } = setup();
    await act(() => hook.result.current.synchronize());
    expect(hook.result.current.context).not.toBeNull();
    vi.mocked(port.stop).mockClear();
    act(() => hook.result.current.retireContext());
    expect(hook.result.current.context).toBeNull();
    expect(hook.result.current.isBusy).toBe(false);
    expect(hook.result.current.settings.sdkHome).toBe("/sdk");
    expect(port.stop).not.toHaveBeenCalled();
  });

  it("removes synchronized project authority from the panel after a stale preview refusal", async () => {
    const { hook } = setup();
    await act(() => hook.result.current.synchronize());
    const view = render(<JavaProjectContextPanel controller={hook.result.current} />);
    expect(screen.getByText(/Effective project context · RefactorKit/)).toBeTruthy();

    act(() =>
      hook.result.current.retireContext(
        "The selected Java project context changed. Synchronize the project and preview again.",
      ),
    );
    view.rerender(<JavaProjectContextPanel controller={hook.result.current} />);

    expect(hook.result.current.context).toBeNull();
    expect(screen.queryByText(/Effective project context · RefactorKit/)).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "Synchronize the project and preview again",
    );
    expect(
      screen.getByRole("button", { name: "Synchronize project" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("offers Maven verification for the current offline-missing provider and clears the guidance after synchronization", async () => {
    const { hook, port } = setup();
    const openJavaRun = vi.fn();
    vi.mocked(port.query).mockImplementationOnce(async (request) => {
      const response = javaProjectContextResponse(request);
      if (response.status !== "available" && response.status !== "partial")
        throw new Error("Expected a project-context fixture.");
      response.context.providers[0] = {
        ...response.context.providers[0]!,
        providerId: "maven-effective-v1",
        status: "offline-missing",
        diagnostics: ["classpath.offlineMissing"],
      };
      return { ...response, status: "partial", context: { ...response.context, status: "partial" } };
    });
    await act(() => hook.result.current.synchronize());
    const view = render(<JavaProjectContextPanel controller={hook.result.current} onOpenMavenVerification={openJavaRun} />);
    expect(screen.getByText(/The local Maven repository is missing artifacts/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Java Run for Maven verification" }));
    expect(openJavaRun).toHaveBeenCalledOnce();
    expect(port.query).toHaveBeenCalledTimes(1);

    await act(() => hook.result.current.synchronize());
    view.rerender(<JavaProjectContextPanel controller={hook.result.current} onOpenMavenVerification={openJavaRun} />);
    expect(screen.queryByText(/The local Maven repository is missing artifacts/)).toBeNull();
  });

  it("evaluates Gradle only on the explicit action and never repeats execution for source inspection or ordinary synchronization", async () => {
    const { hook, port } = setup();
    act(() =>
      hook.result.current.setSettings({
        ...hook.result.current.settings,
        gradle: { executable: "/gradle", userHome: "/cache", projectProperties: {} },
      }),
    );
    const view = render(<JavaProjectContextPanel controller={hook.result.current} />);
    fireEvent.change(screen.getByLabelText("Gradle project properties"), {
      target: { value: "fixtureMode=base\nliteral=x=y" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Evaluate Gradle project" }));
    await waitFor(() => expect(hook.result.current.isBusy).toBe(false));
    expect(port.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        evaluateGradle: true,
        gradle: expect.objectContaining({
          executable: "/gradle",
          projectProperties: { fixtureMode: "base", literal: "x=y" },
        }),
      }),
    );
    await act(() =>
      hook.result.current.inspectSource(undefined, "app", "main", "pkg/Runner.java", "pkg.Peer"),
    );
    expect(vi.mocked(port.query).mock.calls.at(-1)?.[0].evaluateGradle).toBeUndefined();
    await act(() => hook.result.current.synchronize());
    expect(vi.mocked(port.query).mock.calls.at(-1)?.[0].evaluateGradle).toBeUndefined();
    view.unmount();
  });
  it.each([
    ["java.context.compilerOptionsIncomplete", "Then select Synchronize project again.", false],
    ["java.context.compilerOptionsIncomplete", "Then select Evaluate Gradle project again.", true],
    ["java.context.sdkRequired", null, false],
  ] as const)("scopes compiler configuration guidance for %s (%s)", async (code, retry, evaluateGradle) => {
    const { hook, port } = setup();
    if (evaluateGradle) {
      act(() => hook.result.current.setSettings({
        ...hook.result.current.settings,
        gradle: { executable: "/gradle", userHome: "/cache", projectProperties: {} },
      }));
    }
    vi.mocked(port.query).mockImplementationOnce(async (request) => ({
      ...request,
      status: "refused",
      code,
      message: "RefactorKit could not synchronize the selected project.",
    }));
    await act(() => evaluateGradle ? hook.result.current.evaluateGradle() : hook.result.current.synchronize());
    expect(hook.result.current.error).toBe("RefactorKit could not synchronize the selected project.");
    expect(hook.result.current.context).toBeNull();
    expect(hook.result.current.recoveryAction).toBeUndefined();
    if (retry) {
      expect(hook.result.current.message).toContain("Declare the intended Java release");
      expect(hook.result.current.message).toContain(retry);
    } else {
      expect(hook.result.current.message).toBeNull();
    }
    await act(() => hook.result.current.synchronize());
    expect(hook.result.current.context?.status).toBe("available");
    expect(hook.result.current.message).not.toContain("Declare the intended Java release");
  });
  it.each([
    ["offlineDependencyUnavailable", "select Prepare Gradle dependencies", "prepare-gradle"],
    ["offlinePluginResolutionFailed", "Check the plugin version and plugin repositories", "prepare-gradle"],
    ["unknown", "If dependencies are missing", undefined],
    ["cachePermissionDenied", "Choose a writable Gradle user home", "edit-gradle-user-home"],
    ["cacheReadOnly", "Choose a writable Gradle user home", "edit-gradle-user-home"],
    ["filesystemReadOnly", null, undefined],
    ["filesystemPermissionDenied", null, undefined],
  ] as const)("scopes Gradle recovery guidance for %s", async (cause, guidance, recoveryAction) => {
    const { hook, port } = setup();
    act(() =>
      hook.result.current.setSettings({
        ...hook.result.current.settings,
        gradle: { executable: "/gradle", userHome: "/cache", projectProperties: {} },
      }),
    );
    vi.mocked(port.query).mockImplementationOnce(async (request) => ({
      ...request,
      status: "refused",
      code: "gradle.sync.exportFailed",
      message: "Gradle evaluation failed.",
      gradleFailureCause: `gradle.sync.cause.${cause}`,
    }));
    await act(() => hook.result.current.evaluateGradle());
    expect(hook.result.current.error).toBe("Gradle evaluation failed.");
    expect(hook.result.current.context).toBeNull();
    expect(hook.result.current.recoveryAction).toBe(recoveryAction);
    if (guidance) expect(hook.result.current.message).toContain(guidance);
    else expect(hook.result.current.message).toBeNull();
    const view = render(<JavaProjectContextPanel controller={hook.result.current} />);
    if (recoveryAction === "edit-gradle-user-home") {
      const field = screen.getByLabelText("Gradle user home");
      const settings = field.closest("details") as HTMLDetailsElement;
      expect(settings.open).toBe(false);
      const queryCount = vi.mocked(port.query).mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "Edit Gradle user home" }));
      expect(settings.open).toBe(true);
      expect(document.activeElement).toBe(field);
      expect(port.query).toHaveBeenCalledTimes(queryCount);
    } else {
      expect(screen.queryByRole("button", { name: "Edit Gradle user home" })).toBeNull();
    }
    act(() => hook.result.current.setSettings({
      ...hook.result.current.settings,
      projectPath: "another-project",
    }));
    expect(hook.result.current.recoveryAction).toBeUndefined();
    view.rerender(<JavaProjectContextPanel controller={hook.result.current} />);
    expect(screen.queryByRole("button", { name: "Edit Gradle user home" })).toBeNull();
  });
  it.each(["not reported", "unavailable", "partial"] as const)(
    "requests Gradle JPMS facts when the selected source set initially reports %s",
    async (initialAvailability) => {
      const { hook, port } = setup(true);
      vi.mocked(port.query).mockImplementation(async (request) => {
        const response = javaProjectContextResponse(request);
        response.context.schemaVersion = "java-project-context-v3";
        response.context.providers[0]!.providerId = "gradle-effective-v1";
        const module = response.context.modules[0]!;
        module.providerId = "gradle-effective-v1";
        module.buildRoot = "gradle";
        module.projectPath = ":";
        module.sourceSets[0]!.jpms = request.requiredFacts?.includes("jpms")
          ? {
              availability: "complete",
              modulePath: [
                {
                  path: "/workspace/gradle/test-modules/fixture.jar",
                  moduleNames: ["fixture.dependency"],
                  fingerprint: "module-path:fingerprint",
                },
              ],
              descriptors: [],
              refusalCode: null,
            }
          : initialAvailability === "not reported"
            ? undefined
            : {
                availability: initialAvailability,
                modulePath: [],
                descriptors: [],
                refusalCode:
                  initialAvailability === "unavailable"
                    ? "java.context.jpmsContextUnavailable"
                    : initialAvailability === "partial"
                      ? "java.context.jpmsDirectivesNotReported"
                      : null,
              };
        return response;
      });
      await act(() => hook.result.current.synchronize());
      const capabilities = {
        methods: [
          {
            name: "project.context",
            stability: "experimental",
            requiresProject: true,
            writesWorkspace: false,
            features: { typedSchemaV3: true, providerQualifiedSourceAssociation: true },
          },
        ],
      } as unknown as RefactorKitCapabilities;
      const view = render(
        <JavaProjectContextPanel
          controller={hook.result.current}
          refactorKitCapabilities={capabilities}
        />,
      );

      fireEvent.click(screen.getByText(`Java module system · ${initialAvailability}`));
      fireEvent.click(screen.getByRole("button", { name: "Request Java module-system details" }));
      await waitFor(() =>
        expect(hook.result.current.context?.modules[0]?.sourceSets[0]?.jpms?.availability).toBe(
          "complete",
        ),
      );
      expect(port.query).toHaveBeenLastCalledWith(
        expect.objectContaining({
          providerId: "gradle-effective-v1",
          moduleId: "app",
          sourceSetId: "main",
          requiredFacts: ["jpms"],
        }),
      );
      view.rerender(
        <JavaProjectContextPanel
          controller={hook.result.current}
          refactorKitCapabilities={capabilities}
        />,
      );
      fireEvent.click(screen.getByText("Java module system · complete"));
      expect(screen.getByText("fixture.dependency")).toBeTruthy();
    },
  );
  it("requests JPMS facts for the selected source set and retains them during source inspection", async () => {
    const { hook, port } = setup(true);
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      if (request.providerId) {
        response.context.schemaVersion = request.requiredFacts?.includes("jpms")
          ? "java-project-context-v5"
          : "java-project-context-v3";
        response.context.modules[0]!.providerId = request.providerId;
        if (response.context.schemaVersion === "java-project-context-v5")
          response.context.modules[0]!.sourceSets[0]!.mavenFailsafe = {
            availability: "not-declared",
            refusalCode: null,
            executions: [],
          };
        if (response.context.selectedSource)
          response.context.selectedSource.providerId = request.providerId;
      }
      response.context.modules[0]!.sourceSets[0]!.jpms = request.requiredFacts?.includes("jpms")
        ? {
            availability: "complete",
            modulePath: [],
            descriptors: [],
            refusalCode: null,
          }
        : {
            availability: "not-declared",
            modulePath: [],
            descriptors: [],
            refusalCode: null,
          };
      return response;
    });
    await act(() => hook.result.current.synchronize());

    await act(() =>
      hook.result.current.inspectSource(
        "gradle-effective-v1",
        "app",
        "main",
        "pkg/Runner.java",
        "pkg.Runner",
      ),
    );
    expect(port.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceRelativePath: "pkg/Runner.java" }),
    );
    expect(port.query).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ requiredFacts: expect.anything() }),
    );

    await act(() => hook.result.current.inspectJpms("gradle-effective-v1", "app", "main"));
    expect(port.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerId: "gradle-effective-v1",
        moduleId: "app",
        sourceSetId: "main",
        requiredFacts: ["jpms"],
        expectedContextHash: "b".repeat(64),
      }),
    );
    expect(hook.result.current.context?.modules[0]?.sourceSets[0]?.jpms?.availability).toBe(
      "complete",
    );

    await act(() => hook.result.current.inspectJpms("gradle-effective-v1", "app", "main"));
    expect(port.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerId: "gradle-effective-v1",
        moduleId: "app",
        sourceSetId: "main",
        requiredFacts: ["jpms"],
        expectedContextHash: "b".repeat(64),
      }),
    );

    await act(() =>
      hook.result.current.inspectSource(
        "gradle-effective-v1",
        "app",
        "main",
        "pkg/Runner.java",
        "pkg.Runner",
      ),
    );
    expect(port.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ requiredFacts: ["jpms"], sourceRelativePath: "pkg/Runner.java" }),
    );
  });
  it("uses the advertised v3 selector to inspect a source in colliding provider scopes", async () => {
    const { hook, port } = setup();
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      if (!request.providerId) {
        response.context.schemaVersion = "java-project-context-v2";
        response.context.providers.push({
          providerId: "gradle-effective-v1",
          status: "available",
          strategy: "gradle-evaluated-v1",
          buildCodeExecution: "denied",
          credentialsAccess: "denied",
          networkAccess: "denied",
          diagnostics: [],
        });
        const gradleModule = structuredClone(response.context.modules[0]!);
        gradleModule.providerId = "gradle-effective-v1";
        for (const sourceSet of gradleModule.sourceSets)
          for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath])
            entry.providerId = gradleModule.providerId;
        response.context.modules.push(gradleModule);
      }
      return response;
    });
    await act(() => hook.result.current.synchronize());
    const capabilities = {
      methods: [
        {
          name: "project.context",
          stability: "experimental",
          requiresProject: true,
          writesWorkspace: false,
          features: { typedSchemaV3: true, providerQualifiedSourceAssociation: true },
        },
      ],
    } as unknown as RefactorKitCapabilities;
    const view = render(
      <JavaProjectContextPanel
        controller={hook.result.current}
        refactorKitCapabilities={capabilities}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("pkg/Runner.java"), {
      target: { value: "pkg/Runner.java" },
    });
    const inspect = screen.getByRole("button", { name: "Resolve source ownership" });
    expect((inspect as HTMLButtonElement).disabled).toBe(false);
    await act(async () => fireEvent.click(inspect));
    await waitFor(() => expect(port.query).toHaveBeenCalledTimes(2));
    expect(vi.mocked(port.query).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "main",
        sourceRelativePath: "pkg/Runner.java",
      }),
    );
    view.unmount();
  });

  it("retains the selected v3 provider scope when execution refreshes project metadata", async () => {
    const { hook, port } = setup();
    const providerId = "gradle-effective-v1";
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      response.context.schemaVersion = request.providerId
        ? "java-project-context-v3"
        : "java-project-context-v2";
      if (request.providerId) {
        response.context.providers[0]!.providerId = providerId;
        const module = response.context.modules[0]!;
        module.providerId = providerId;
        module.buildRoot = "included-build";
        module.projectPath = ":app";
        if (response.context.selectedSource)
          response.context.selectedSource.providerId = providerId;
      }
      return response;
    });
    await act(() => hook.result.current.synchronize());
    expect(hook.result.current.context?.schemaVersion).toBe("java-project-context-v2");
    await act(() =>
      hook.result.current.inspectSource(providerId, "app", "main", "pkg/Runner.java", "pkg.Runner"),
    );
    expect(hook.result.current.context?.schemaVersion).toBe("java-project-context-v3");

    let fresh!: Awaited<ReturnType<typeof hook.result.current.refreshForExecution>>;
    await act(async () => {
      fresh = await hook.result.current.refreshForExecution(hook.result.current.settings, {
        providerId,
        moduleId: "app",
        sourceSetId: "main",
      });
    });
    expect(port.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerId, moduleId: "app", sourceSetId: "main" }),
    );
    expect(fresh.schemaVersion).toBe("java-project-context-v3");
    expect(fresh.modules[0]).toEqual(
      expect.objectContaining({ buildRoot: "included-build", projectPath: ":app" }),
    );
  });

  it("qualifies aggregate Gradle identities before exposing them to project execution", async () => {
    const { hook, port } = setup(true, true);
    const providerId = "gradle-effective-v1";
    act(() =>
      hook.result.current.setSettings({
        ...hook.result.current.settings,
        gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
      }),
    );
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      response.context.schemaVersion =
        request.aggregateGradleCompositeContext || request.providerId
          ? "java-project-context-v3"
          : "java-project-context-v2";
      response.context.providers[0]!.providerId = providerId;
      const module = response.context.modules[0]!;
      module.providerId = providerId;
      module.id = "included-build-hash::app";
      module.name = "app";
      module.root = "gradle/app";
      for (const sourceSet of module.sourceSets)
        for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath]) {
          entry.providerId = providerId;
          entry.moduleId = module.id;
        }
      if (request.aggregateGradleCompositeContext || request.providerId) {
        module.buildRoot = "gradle/included-build";
        module.projectPath = ":app";
      }
      return response;
    });

    await act(() => hook.result.current.synchronize());
    expect(hook.result.current.context?.schemaVersion).toBe("java-project-context-v3");
    expect(port.query).toHaveBeenCalledTimes(2);
    expect(vi.mocked(port.query).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        providerId,
        moduleId: "included-build-hash::app",
        sourceSetId: "main",
        expectedSnapshotHash: expect.any(String),
      }),
    );
    expect(vi.mocked(port.query).mock.calls[1]?.[0]).not.toHaveProperty("expectedContextHash");
    expect(hook.result.current.context?.modules[0]).toEqual(
      expect.objectContaining({ buildRoot: "gradle/included-build", projectPath: ":app" }),
    );

    await act(() => hook.result.current.evaluateGradle());
    expect(port.query).toHaveBeenCalledTimes(3);
    expect(vi.mocked(port.query).mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        evaluateGradle: true,
        aggregateGradleCompositeContext: true,
      }),
    );
    expect(hook.result.current.context?.schemaVersion).toBe("java-project-context-v3");

    let fresh!: Awaited<ReturnType<typeof hook.result.current.refreshForExecution>>;
    await act(async () => {
      fresh = await hook.result.current.refreshForExecution(hook.result.current.settings, {
        providerId,
        moduleId: "app",
        sourceSetId: "main",
      });
    });

    const request = vi.mocked(port.query).mock.calls.at(-1)?.[0];
    expect(request).toEqual(
      expect.objectContaining({ providerId, moduleId: "app", sourceSetId: "main" }),
    );
    expect(request).toHaveProperty("expectedSnapshotHash");
    expect(request).toHaveProperty("expectedContextHash");
    expect(fresh.schemaVersion).toBe("java-project-context-v3");
    expect(fresh.modules[0]).toEqual(
      expect.objectContaining({ buildRoot: "gradle/included-build", projectPath: ":app" }),
    );
  });

  it("refuses a Gradle v3 composite whose included modules omit build identity", async () => {
    const { hook, port } = setup(true, true);
    const providerId = "gradle-effective-v1";
    act(() =>
      hook.result.current.setSettings({
        ...hook.result.current.settings,
        gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
      }),
    );
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      response.context.schemaVersion = "java-project-context-v3";
      response.context.providers[0]!.providerId = providerId;
      const app = response.context.modules[0]!;
      app.providerId = providerId;
      app.root = "gradle/included/app";
      app.name = "app";
      const library = structuredClone(app);
      library.id = "library";
      library.root = "gradle/included/library";
      library.name = "library";
      response.context.modules.push(library);
      return response;
    });

    await act(() => hook.result.current.evaluateGradle());

    expect(port.query).toHaveBeenCalledTimes(2);
    expect(port.query).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        evaluateGradle: true,
        aggregateGradleCompositeContext: true,
      }),
    );
    expect(port.query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        providerId,
        moduleId: "app",
        sourceSetId: "main",
        expectedSnapshotHash: expect.any(String),
      }),
    );
    expect(hook.result.current.context).toBeNull();
    expect(hook.result.current.error).toMatch(
      /omitted buildRoot or projectPath.*composite project selection/i,
    );
  });

  it("allows owner-only Gradle v7 source selection while refusing unqualified symbols", async () => {
    const { hook, port } = setup(true, true);
    const providerId = "gradle-effective-v1";
    act(() =>
      hook.result.current.setSettings({
        ...hook.result.current.settings,
        gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
      }),
    );
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      response.context.schemaVersion = "java-project-context-v7";
      response.context.providers[0]!.providerId = providerId;
      const module = response.context.modules[0]!;
      module.providerId = providerId;
      module.id = ":app";
      module.buildRoot = ".";
      module.projectPath = ":app";
      response.context.semanticAnalysis = {
        availability: "unqualified",
        refusalCode: "java.context.sourceAnalysisUnqualified",
      };
      response.context.analysis = null;
      response.context.selectedSource = null;
      if (request.sourceRelativePath && !request.symbol) {
        const sourceSet = module.sourceSets.find((candidate) => candidate.id === "main")!;
        const sourceRoot = sourceSet.sourceRoots[0]!;
        response.context.selectedSource = {
          path: `${sourceRoot}/${request.sourceRelativePath}`,
          symbol: null,
          providerId,
          moduleId: ":app",
          sourceSetId: "main",
          sourceRoot,
          generated: false,
          bindingKey: null,
          evidence: "SOURCE_ROOT_OWNERSHIP",
        };
      }
      for (const sourceSet of module.sourceSets) {
        sourceSet.mavenTestJvm = {
          availability: "not-applicable",
          mode: "unknown",
          refusalCode: null,
          executions: [],
        };
      }
      return response;
    });

    await act(() => hook.result.current.evaluateGradle());

    expect(port.query).toHaveBeenCalledOnce();
    expect(hook.result.current.context?.schemaVersion).toBe("java-project-context-v7");
    expect(hook.result.current.context?.modules[0]).toEqual(
      expect.objectContaining({ buildRoot: ".", projectPath: ":app" }),
    );
    const callsAfterSync = vi.mocked(port.query).mock.calls.length;
    await act(() =>
      hook.result.current.inspectSource(providerId, ":app", "main", "pkg/Runner.java", ""),
    );
    await waitFor(() => expect(port.query).toHaveBeenCalledTimes(callsAfterSync + 1));
    expect(vi.mocked(port.query).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        providerId,
        moduleId: ":app",
        sourceSetId: "main",
        sourceRelativePath: "pkg/Runner.java",
      }),
    );
    expect(vi.mocked(port.query).mock.calls.at(-1)?.[0]).not.toHaveProperty("symbol");
    expect(hook.result.current.context?.selectedSource).toMatchObject({
      symbol: null,
      evidence: "SOURCE_ROOT_OWNERSHIP",
      bindingKey: null,
    });

    const callsAfterOwnerLookup = vi.mocked(port.query).mock.calls.length;
    await act(() =>
      hook.result.current.inspectSource(
        providerId,
        ":app",
        "main",
        "pkg/Runner.java",
        "pkg.Runner",
      ),
    );
    expect(port.query).toHaveBeenCalledTimes(callsAfterOwnerLookup);
    expect(hook.result.current.message).toMatch(/Java symbol analysis is unavailable/i);
  });

  it("does not reuse a v2 context hash when upgrading a source query to v7", async () => {
    const { hook, port } = setup(false, false, true);
    const providerId = "maven-effective-v1";
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      if (!request.providerId) {
        response.context.schemaVersion = "java-project-context-v2";
        return response;
      }

      response.context.schemaVersion = "java-project-context-v7";
      response.context.providers[0]!.providerId = providerId;
      const module = response.context.modules[0]!;
      module.providerId = providerId;
      response.context.analysis = null;
      response.context.semanticAnalysis = {
        availability: "unqualified",
        refusalCode: "java.context.sourceAnalysisUnqualified",
      };
      response.context.selectedSource = {
        path: "app/src/main/java/pkg/Runner.java",
        sourceRoot: "app/src/main/java",
        moduleId: "app",
        sourceSetId: "main",
        providerId,
        symbol: null,
        generated: false,
        bindingKey: null,
        evidence: "SOURCE_ROOT_OWNERSHIP",
      };
      for (const sourceSet of module.sourceSets) {
        sourceSet.mavenTestJvm = {
          availability: "not-applicable",
          mode: "unknown",
          refusalCode: null,
          executions: [],
        };
      }
      return response;
    });

    await act(() => hook.result.current.synchronize());
    const v2Context = hook.result.current.context;
    expect(v2Context?.schemaVersion).toBe("java-project-context-v2");

    await act(() =>
      hook.result.current.inspectSource(providerId, "app", "main", "pkg/Runner.java", ""),
    );
    const firstV7Request = vi.mocked(port.query).mock.calls.at(-1)?.[0];
    expect(firstV7Request).toEqual(
      expect.objectContaining({
        providerId,
        moduleId: "app",
        sourceSetId: "main",
        sourceRelativePath: "pkg/Runner.java",
        expectedSnapshotHash: v2Context?.snapshotHash,
      }),
    );
    expect(firstV7Request).not.toHaveProperty("expectedContextHash");
    const v7Context = hook.result.current.context;
    expect(v7Context?.schemaVersion).toBe("java-project-context-v7");

    await act(() =>
      hook.result.current.inspectSource(providerId, "app", "main", "pkg/Runner.java", ""),
    );
    expect(vi.mocked(port.query).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ expectedContextHash: v7Context?.contextHash }),
    );
  });

  it("keeps v6 metadata-only source ownership unavailable", async () => {
    const { hook, port } = setup();
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      response.context.schemaVersion = "java-project-context-v6";
      response.context.analysis = null;
      response.context.selectedSource = null;
      response.context.semanticAnalysis = {
        availability: "unqualified",
        refusalCode: "java.context.sourceAnalysisUnqualified",
      };
      return response;
    });

    await act(() => hook.result.current.synchronize());
    const callsAfterSync = vi.mocked(port.query).mock.calls.length;
    await act(() =>
      hook.result.current.inspectSource("maven-effective-v1", "app", "main", "pkg/Runner.java", ""),
    );
    expect(port.query).toHaveBeenCalledTimes(callsAfterSync);
    expect(hook.result.current.message).toMatch(/unavailable for this metadata-only context/i);
  });

  it("reacquires selected provider context after a reviewed save retires the prior snapshot", async () => {
    const { hook, port } = setup();
    const providerId = "maven-effective-v1";
    await act(() => hook.result.current.synchronize());
    act(() => hook.result.current.retireContext("Source files were saved."));

    let fresh!: Awaited<ReturnType<typeof hook.result.current.refreshForExecution>>;
    await act(async () => {
      fresh = await hook.result.current.refreshForExecution(
        hook.result.current.settings,
        {
          providerId,
          moduleId: "app",
          sourceSetKind: "integration-test",
        },
        { afterSavedBufferReview: true },
      );
    });

    const request = vi.mocked(port.query).mock.calls.at(-1)?.[0];
    expect(request).toEqual(
      expect.objectContaining({
        providerId,
        moduleId: "app",
        sourceSetKind: "integration-test",
      }),
    );
    expect(request).not.toHaveProperty("expectedSnapshotHash");
    expect(request).not.toHaveProperty("expectedContextHash");
    expect(fresh.status).toBe("available");
  });

  it("retries a reviewed execution refresh once when its response is superseded", async () => {
    const { hook, port } = setup(true);
    const providerId = "maven-effective-v1";
    await act(() => hook.result.current.synchronize());
    vi.mocked(port.query).mockImplementationOnce(async (request) => {
      const response = javaProjectContextResponse(request);
      hook.result.current.retireContext("Source inputs changed during execution refresh.");
      return response;
    });

    let fresh!: Awaited<ReturnType<typeof hook.result.current.refreshForExecution>>;
    await act(async () => {
      fresh = await hook.result.current.refreshForExecution(
        hook.result.current.settings,
        { providerId, moduleId: "app", sourceSetKind: "integration-test" },
        { afterSavedBufferReview: true },
      );
    });

    expect(port.query).toHaveBeenCalledTimes(3);
    expect(vi.mocked(port.query).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ providerId, moduleId: "app", sourceSetKind: "integration-test" }),
    );
    expect(vi.mocked(port.query).mock.calls[2]?.[0]).not.toHaveProperty("expectedSnapshotHash");
    expect(fresh.status).toBe("available");
  });

  it("reports why both reviewed execution refresh attempts were invalidated", async () => {
    const { hook, port } = setup(true);
    const providerId = "maven-effective-v1";
    await act(() => hook.result.current.synchronize());
    vi.mocked(port.query).mockImplementation(async (request) => {
      const response = javaProjectContextResponse(request);
      act(() =>
        hook.result.current.retireContext("Source inputs changed during execution refresh."),
      );
      return response;
    });

    await act(async () => {
      await expect(
        hook.result.current.refreshForExecution(
          hook.result.current.settings,
          { providerId, moduleId: "app", sourceSetKind: "integration-test" },
          { afterSavedBufferReview: true },
        ),
      ).rejects.toThrow(
        /invalidated because the editor or another operation retired the project context/i,
      );
    });
    expect(port.query).toHaveBeenCalledTimes(3);
  });

  it("requests provider-complete JPMS facts for named-module execution", async () => {
    const { hook, port } = setup();
    await act(() => hook.result.current.synchronize());
    let fresh!: Awaited<ReturnType<typeof hook.result.current.refreshForExecution>>;
    await act(async () => {
      fresh = await hook.result.current.refreshForExecution(
        hook.result.current.settings,
        { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
        { requiredFacts: ["jpms"] },
      );
    });
    expect(vi.mocked(port.query).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "main",
        requiredFacts: ["jpms"],
      }),
    );
    expect(fresh.status).toBe("available");
  });

  it("keeps execution refresh pinned when saved-buffer review is not authorized", async () => {
    const { hook, port } = setup();
    await act(() => hook.result.current.synchronize());
    act(() => hook.result.current.retireContext());

    await expect(
      hook.result.current.refreshForExecution(hook.result.current.settings, {
        moduleId: "app",
        sourceSetId: "main",
      }),
    ).rejects.toThrow(/available project context is required/i);
    expect(port.query).toHaveBeenCalledTimes(1);
  });

  it("shows session-scoped JDT LS Gradle authorization and reports explicit changes", () => {
    const { hook } = setup();
    const onAuthorizationChange = vi.fn();
    render(
      <JavaProjectContextPanel
        controller={hook.result.current}
        onGradleImportAuthorizationChange={onAuthorizationChange}
      />,
    );
    expect(screen.getByText(/scripts can still access the network and credentials/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Allow JDT LS Gradle import for this session" }),
    );
    expect(onAuthorizationChange).toHaveBeenCalledWith(true);
  });
  it("uses native path selections for the JDK, Maven repository and Gradle settings", async () => {
    const { hook, getWorkspaceContext } = setup();
    const pathPicker = {
      selectDirectory: vi
        .fn()
        .mockResolvedValueOnce("/home/workspace/sample-java")
        .mockResolvedValueOnce("/opt/jdks/temurin-25")
        .mockResolvedValueOnce("/home/dev/.m2/repository")
        .mockResolvedValueOnce("/opt/jdks/temurin-21")
        .mockResolvedValueOnce("/home/dev/.gradle")
        .mockResolvedValueOnce(null),
      selectFile: vi.fn().mockResolvedValueOnce("/opt/gradle/bin/gradle"),
    };
    const renderPanel = () => (
      <JavaProjectContextPanel
        controller={hook.result.current}
        workspaceId="one"
        generation={1}
        workspaceRootPath="/home/workspace"
        getWorkspaceContext={getWorkspaceContext}
        pathPicker={pathPicker}
      />
    );
    const view = render(renderPanel());

    fireEvent.click(screen.getByRole("button", { name: "Choose project directory" }));
    await waitFor(() => expect(hook.result.current.settings.projectPath).toBe("sample-java"));
    expect(pathPicker.selectDirectory).toHaveBeenNthCalledWith(1, "/home/workspace");
    view.rerender(renderPanel());
    fireEvent.click(screen.getByRole("button", { name: "Choose JDK home" }));
    await waitFor(() => expect(hook.result.current.settings.sdkHome).toBe("/opt/jdks/temurin-25"));
    view.rerender(renderPanel());
    fireEvent.click(screen.getByRole("button", { name: "Choose Maven repository" }));
    await waitFor(() =>
      expect(hook.result.current.settings.mavenRepository).toBe("/home/dev/.m2/repository"),
    );
    view.rerender(renderPanel());
    fireEvent.click(screen.getByText("Gradle settings"));
    fireEvent.click(screen.getByRole("button", { name: "Choose Gradle executable" }));
    await waitFor(() =>
      expect(hook.result.current.settings.gradle?.executable).toBe("/opt/gradle/bin/gradle"),
    );
    view.rerender(renderPanel());
    fireEvent.click(screen.getByRole("button", { name: "Choose Gradle runtime JDK home" }));
    await waitFor(() =>
      expect(hook.result.current.settings.gradle?.gradleRuntimeHome).toBe("/opt/jdks/temurin-21"),
    );
    view.rerender(renderPanel());
    fireEvent.click(screen.getByRole("button", { name: "Choose Gradle user home" }));
    await waitFor(() =>
      expect(hook.result.current.settings.gradle?.userHome).toBe("/home/dev/.gradle"),
    );
    view.rerender(renderPanel());
    fireEvent.click(screen.getByRole("button", { name: "Choose JDK home" }));
    await waitFor(() => expect(pathPicker.selectDirectory).toHaveBeenCalledTimes(6));
    expect(hook.result.current.settings.sdkHome).toBe("/opt/jdks/temurin-25");
  });

  it("searches the selected Java project and opens the chosen workspace-relative result", async () => {
    const { hook, getWorkspaceContext } = setup();
    act(() =>
      hook.result.current.setSettings({
        ...hook.result.current.settings,
        projectPath: "app",
      }),
    );
    const searchController = {
      matches: [
        {
          path: "app/src/main/java/example/Widget.java",
          line: 9,
          column: 7,
          snippet: "class Widget {}",
        },
      ],
      scannedFiles: 6,
      skippedFiles: 0,
      searchedDraftFiles: 0,
      skippedDraftFiles: 0,
      truncated: false,
      hasSearched: true,
      isBusy: false,
      error: null,
      search: vi.fn(async () => {}),
      searchAndGetSnapshot: vi.fn(async () => null),
      clear: vi.fn(),
    };
    const onNavigateLocation = vi.fn();
    const renderPanel = () => (
      <JavaProjectContextPanel
        controller={hook.result.current}
        workspaceId="one"
        generation={1}
        getWorkspaceContext={getWorkspaceContext}
        searchController={searchController}
        onNavigateLocation={onNavigateLocation}
      />
    );
    const view = render(renderPanel());

    fireEvent.change(screen.getByRole("searchbox", { name: "Text to find" }), {
      target: { value: "Widget" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }));
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(searchController.search).toHaveBeenCalledWith("Widget", true, "app");
    view.rerender(renderPanel());
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open app/src/main/java/example/Widget.java at line 9, column 7",
      }),
    );
    expect(onNavigateLocation).toHaveBeenCalledWith({
      path: "app/src/main/java/example/Widget.java",
      line: 9,
      column: 7,
    });
  });

  it("surfaces a rejected JDT LS settings request without retaining a success message", async () => {
    const { hook, port } = setup();
    port.applyLanguageSettings = vi.fn(async () => {
      throw new Error("JDT LS refused the Gradle preview setting.");
    });
    act(() =>
      hook.result.current.setSettings({
        ...hook.result.current.settings,
        gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
      }),
    );
    await act(() => hook.result.current.synchronize());

    await act(async () => {
      await hook.result.current.applyLanguageSettings();
    });

    expect(hook.result.current.error).toBe("JDT LS refused the Gradle preview setting.");
    expect(hook.result.current.message).toBeNull();
  });

  it("refuses a project directory selected outside the active workspace", async () => {
    const { hook, getWorkspaceContext } = setup();
    const pathPicker = {
      selectDirectory: vi.fn(async () => "/home/other/project"),
      selectFile: vi.fn(async () => null),
    };
    render(
      <JavaProjectContextPanel
        controller={hook.result.current}
        workspaceId="one"
        generation={1}
        workspaceRootPath="/home/workspace"
        getWorkspaceContext={getWorkspaceContext}
        pathPicker={pathPicker}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose project directory" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("inside the active workspace"),
    );
    expect(hook.result.current.settings.projectPath).toBe("");
  });

  it("converts a Windows project directory to a workspace-relative path", async () => {
    expect(
      workspaceRelativeProjectPath(
        "C:\\Users\\Dev\\Workspace",
        "c:\\users\\dev\\workspace\\sample",
      ),
    ).toBe("sample");
    const { hook, getWorkspaceContext } = setup();
    const pathPicker = {
      selectDirectory: vi.fn(async () => "c:\\users\\dev\\workspace\\sample"),
      selectFile: vi.fn(async () => null),
    };
    render(
      <JavaProjectContextPanel
        controller={hook.result.current}
        workspaceId="one"
        generation={1}
        workspaceRootPath={"C:\\Users\\Dev\\Workspace"}
        getWorkspaceContext={getWorkspaceContext}
        pathPicker={pathPicker}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose project directory" }));
    await waitFor(() => expect(pathPicker.selectDirectory).toHaveBeenCalledOnce());
    expect(pathPicker.selectDirectory).toHaveBeenCalledWith("C:\\Users\\Dev\\Workspace");
    await waitFor(() => expect(hook.result.current.settings.projectPath).toBe("sample"));
  });

  it("refuses a path-picker result after the active workspace changes", async () => {
    const { hook, getWorkspaceContext, switchWorkspace } = setup();
    let select!: (path: string | null) => void;
    const pathPicker = {
      selectDirectory: vi.fn(
        () =>
          new Promise<string | null>((resolve) => {
            select = resolve;
          }),
      ),
      selectFile: vi.fn(async () => null),
    };
    render(
      <JavaProjectContextPanel
        controller={hook.result.current}
        workspaceId="one"
        generation={1}
        getWorkspaceContext={getWorkspaceContext}
        pathPicker={pathPicker}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose JDK home" }));
    await waitFor(() => expect(pathPicker.selectDirectory).toHaveBeenCalledOnce());
    act(() => switchWorkspace());
    select("/opt/jdks/stale");

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("workspace changed"),
    );
    expect(hook.result.current.settings.sdkHome).toBe("");
  });
  it("does not restore build execution authorization from persisted settings", async () => {
    const configured = {
      projectPath: "",
      sdkHome: "/sdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
      gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
      evaluateGradle: true,
    };
    const port: JavaProjectContextPort = {
      query: vi.fn(async (r) => javaProjectContextResponse(r)),
      stop: vi.fn(async () => {}),
    };
    const storage = { getItem: () => JSON.stringify(configured), setItem: vi.fn() };
    const workspace = {
      workspaceId: "persisted",
      generation: 1,
      isSwitching: false,
      isMetadataLoading: false,
    };
    const hook = renderHook(() =>
      useJavaProjectContextController({
        port,
        ...workspace,
        getWorkspaceContext: () => workspace,
        storage,
      }),
    );
    await act(() => hook.result.current.synchronize());
    expect(vi.mocked(port.query).mock.calls[0][0].evaluateGradle).toBeUndefined();
    expect(hook.result.current.settings).not.toHaveProperty("evaluateGradle");
  });
  it("binds source inspection to the acquired snapshot/context and retires it on failure", async () => {
    const { hook, port } = setup();
    await act(() => hook.result.current.synchronize());
    expect(hook.result.current.context?.status).toBe("available");
    await act(() =>
      hook.result.current.inspectSource(
        "maven-effective-v1",
        "app",
        "main",
        "pkg/Runner.java",
        "pkg.Peer",
      ),
    );
    expect(port.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedSnapshotHash: "a".repeat(64),
        expectedContextHash: "b".repeat(64),
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "main",
        symbol: "pkg.Peer",
      }),
    );
    vi.mocked(port.query).mockImplementationOnce(async (r) => ({
      workspaceId: r.workspaceId,
      generation: r.generation,
      requestId: r.requestId,
      projectPath: r.projectPath,
      status: "refused",
      code: "java.context.snapshotStale",
      message: "Project changed",
    }));
    await act(() => hook.result.current.synchronize());
    expect(hook.result.current.context).toBeNull();
    expect(hook.result.current.error).toBe("Project changed");
  });
  it("rejects a delayed result after workspace change, cancellation and settings change", async () => {
    for (const retire of ["workspace", "cancel", "settings"]) {
      const { hook, port, switchWorkspace } = setup();
      let complete!: (r: JavaProjectContextResult) => void;
      let request!: JavaProjectContextRequest;
      vi.mocked(port.query).mockImplementationOnce((r) => {
        request = r;
        return new Promise((resolve) => {
          complete = resolve;
        });
      });
      let running!: Promise<void>;
      act(() => {
        running = hook.result.current.synchronize();
      });
      await waitFor(() => expect(port.query).toHaveBeenCalled());
      if (retire === "workspace") act(() => switchWorkspace());
      else if (retire === "cancel") act(() => hook.result.current.cancel());
      else
        act(() =>
          hook.result.current.setSettings({
            ...hook.result.current.settings,
            sdkHome: "/different-sdk",
          }),
        );
      await act(async () => {
        complete(javaProjectContextResponse(request));
        await running;
      });
      expect(hook.result.current.context).toBeNull();
      expect(hook.result.current.isBusy).toBe(false);
      hook.unmount();
    }
  });
  it("waits for the preceding stop before acquiring a new context", async () => {
    const { hook, port } = setup();
    await act(() => hook.result.current.synchronize());
    vi.mocked(port.stop).mockClear();
    vi.mocked(port.query).mockClear();
    let stopped!: () => void;
    vi.mocked(port.stop).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          stopped = resolve;
        }),
    );
    act(() =>
      hook.result.current.setSettings({ ...hook.result.current.settings, sdkHome: "/new-sdk" }),
    );
    await waitFor(() => expect(port.stop).toHaveBeenCalledOnce());
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.synchronize();
    });
    expect(port.query).not.toHaveBeenCalled();
    await act(async () => {
      stopped();
      await running;
    });
    expect(port.query).toHaveBeenCalledWith(expect.objectContaining({ sdkHome: "/new-sdk" }));
  });
  it("serializes repeated settings stops before synchronizing the latest project settings", async () => {
    const { hook, port } = setup();
    await act(() => hook.result.current.synchronize());
    vi.mocked(port.stop).mockClear();
    vi.mocked(port.query).mockClear();

    let finishFirst!: () => void;
    let finishSecond!: () => void;
    vi.mocked(port.stop)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishSecond = resolve;
          }),
      );
    act(() =>
      hook.result.current.setSettings({ ...hook.result.current.settings, sdkHome: "/first-sdk" }),
    );
    await waitFor(() => expect(port.stop).toHaveBeenCalledOnce());
    act(() =>
      hook.result.current.setSettings({ ...hook.result.current.settings, sdkHome: "/latest-sdk" }),
    );
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.synchronize();
    });
    expect(port.query).not.toHaveBeenCalled();
    expect(port.stop).toHaveBeenCalledOnce();

    finishFirst();
    await waitFor(() => expect(port.stop).toHaveBeenCalledTimes(2));
    expect(port.query).not.toHaveBeenCalled();
    finishSecond();
    await act(async () => running);

    expect(port.query).toHaveBeenCalledWith(expect.objectContaining({ sdkHome: "/latest-sdk" }));
  });
  it("shows partial readiness, preserves compiler order and accepts multiline profile typing", async () => {
    const { hook, port } = setup();
    vi.mocked(port.query).mockImplementation(async (r) => javaProjectContextResponse(r, "partial"));
    await act(() => hook.result.current.synchronize());
    const view = render(<JavaProjectContextPanel controller={hook.result.current} />);
    expect(screen.getByText(/Partial project context. Effective import/)).toBeTruthy();
    expect(screen.getByText("/repository/z-first.jar")).toBeTruthy();
    expect(screen.getByText("/repository/a-second.jar")).toBeTruthy();
    const profiles = screen.getByLabelText("Active profiles (one per line)");
    fireEvent.change(profiles, { target: { value: "first\n" } });
    view.rerender(<JavaProjectContextPanel controller={hook.result.current} />);
    expect(
      (screen.getByLabelText("Active profiles (one per line)") as HTMLTextAreaElement).value,
    ).toBe("first\n");
    fireEvent.change(profiles, { target: { value: "first\nsecond" } });
    expect(hook.result.current.settings.activeMavenProfiles).toEqual(["first", "second"]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7] as const)("resolves Maven parent paths and root choices for context v%s", async (version) => {
    const { hook } = setup();
    act(() =>
      hook.result.current.setSettings({
        ...hook.result.current.settings,
        projectPath: "maven",
      }),
    );
    await act(() => hook.result.current.synchronize());
    const context = structuredClone(hook.result.current.context!);
    context.schemaVersion = `java-project-context-v${version}`;
    if (version >= 3) for (const module of context.modules) module.root = `maven/${module.root}`;
    const onCreateMavenModule = vi.fn();
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
    const view = render(
      <JavaProjectContextPanel
        controller={{ ...hook.result.current, context }}
        workspaceId="one"
        generation={1}
        refactorKitCapabilities={capabilities}
        onCreateMavenModule={onCreateMavenModule}
      />,
    );

    const parentSelect = screen.getByLabelText("Maven module parent");
    expect(parentSelect.textContent).toContain("Project root · maven");
    fireEvent.change(parentSelect, { target: { value: "__maven_project_root_parent__" } });
    fireEvent.click(screen.getByRole("button", { name: "Review Add Module" }));
    expect(onCreateMavenModule).toHaveBeenCalledWith("maven/pom.xml");
    fireEvent.change(parentSelect, { target: { value: "app" } });
    fireEvent.click(screen.getByRole("button", { name: "Review Add Module" }));
    expect(onCreateMavenModule).toHaveBeenLastCalledWith("maven/app/pom.xml");
    expect(screen.getByText(version >= 3 ? /Workspace-relative module directory:/ : /^Module directory:/)).toBeTruthy();
    context.modules.push({ ...context.modules[0], id: "root", name: "Root reactor", root: version >= 3 ? "maven" : "" });
    view.rerender(<JavaProjectContextPanel controller={{ ...hook.result.current, context }} workspaceId="one" generation={1}
      refactorKitCapabilities={capabilities} onCreateMavenModule={onCreateMavenModule} />);
    expect(parentSelect.querySelector('option[value="__maven_project_root_parent__"]')).toBeNull();
    fireEvent.change(parentSelect, { target: { value: "root" } });
    fireEvent.click(screen.getByRole("button", { name: "Review Add Module" }));
    expect(onCreateMavenModule).toHaveBeenLastCalledWith("maven/pom.xml");
  });
});

it.each(["retire", "cancel", "refresh", "workspace", "unmount"] as const)("refuses retained language-settings callbacks after %s before calling the adapter", async (change) => {
  const h = setup();
  h.port.applyLanguageSettings = vi.fn(async (request) => ({ ...request, outcome: "applied", message: "current compiler settings" }));
  await act(() => h.hook.result.current.synchronize());
  const old = h.hook.result.current.applyLanguageSettings;
  if (change === "retire") act(() => h.hook.result.current.retireContext());
  else if (change === "cancel") act(() => h.hook.result.current.cancel());
  else if (change === "refresh") await act(() => h.hook.result.current.synchronize());
  else if (change === "workspace") h.switchWorkspace();
  else h.hook.unmount();
  await act(async () => { expect(await old()).toBeNull(); });
  expect(h.port.applyLanguageSettings).not.toHaveBeenCalled();
});

it("does not return a retired language-settings result as current authority", async () => {
  const h = setup();
  let finish!: () => void;
  h.port.applyLanguageSettings = vi.fn((request) => new Promise<JavaProjectLanguageSettingsResult>((done) => { finish = () => done({ ...request, outcome: "applied", message: "retired success" }); }));
  await act(() => h.hook.result.current.synchronize());
  let pending!: ReturnType<typeof h.hook.result.current.applyLanguageSettings>;
  act(() => { pending = h.hook.result.current.applyLanguageSettings(); });
  act(() => h.hook.result.current.retireContext("Sources changed"));
  await act(async () => { finish(); expect(await pending).toBeNull(); });
  expect(h.hook.result.current.message).toBe("Sources changed");
});

it.each([{ projectPath: "another-project" }, { contextSchemaVersion: "java-project-context-v7" }, { contextHash: "f".repeat(64) }])("refuses uncorrelated compiler settings response %j", async (changed) => {
  const h = setup();
  h.port.applyLanguageSettings = vi.fn(async (request) => ({ ...request, ...changed, outcome: "applied", message: "unrelated success" } as import("@ide/contracts").JavaProjectLanguageSettingsResult));
  await act(() => h.hook.result.current.synchronize());
  await act(async () => { expect(await h.hook.result.current.applyLanguageSettings()).toBeNull(); });
  expect(h.hook.result.current.message).toBeNull();
  expect(h.hook.result.current.error).toContain("does not match");
});
