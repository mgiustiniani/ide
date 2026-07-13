import type {
  AiAgentCommand,
  AiAgentResponse,
  PiAgentRun,
  PiAgentRunTrace,
  PiAgentSessionMessages,
  PiAgentSettings,
  PiAgentStatus,
  WorkspaceInfo,
} from "@ide/contracts";
import type { AiAgentPort } from "@ide/web-core/ports";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAiAgentController } from "./useAiAgentController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const settings = (enabled: boolean, model: string): PiAgentSettings => ({
  enabled,
  provider: "pi",
  preferredIntegration: "rpc",
  fallbackIntegrations: [],
  model,
});

const status = (enabled: boolean, available: boolean, version: string): PiAgentStatus => ({
  provider: "pi",
  enabled,
  available,
  availability: available ? "available" : enabled ? "not-installed" : "disabled",
  preferredIntegration: "rpc",
  activeIntegration: available ? "rpc" : undefined,
  version,
});

const workspace = (id: string, rootPath = `/workspaces/${id}`): WorkspaceInfo => ({
  id,
  name: id,
  rootPath,
});

const session = (
  workspaceId: string,
  messages: PiAgentSessionMessages["messages"] = [],
): PiAgentSessionMessages => ({
  workspaceId,
  sessionId: `session-${workspaceId}`,
  messages,
});

function createHarness() {
  const getSettings = vi.fn(async () => settings(true, "default-model"));
  const getStatus = vi.fn(async () => status(true, true, "1.0.0"));
  const listCommands = vi.fn(async (): Promise<AiAgentCommand[]> => []);
  const updateSettings = vi.fn(async () => settings(true, "saved-model"));
  const installPiAgent = vi.fn(async () => ({
    provider: "pi" as const,
    success: true,
    outcome: "installed" as const,
  }));
  const listAgentRuns = vi.fn(async (): Promise<PiAgentRun[]> => []);
  const getAgentRunTrace = vi.fn(async (runId: string): Promise<PiAgentRunTrace> => ({
    runId,
    events: [],
  }));
  const getSessionMessages = vi.fn(async () => session("default"));
  const sendPrompt = vi.fn(async (prompt: string): Promise<AiAgentResponse> => ({
    text: `response:${prompt}`,
  }));

  const aiAgent: AiAgentPort = {
    getSettings,
    getStatus,
    listCommands,
    updateSettings,
    installPiAgent,
    listAgentRuns,
    getAgentRunTrace,
    getSessionMessages,
    sendPrompt,
  };

  return {
    aiAgent,
    getSettings,
    getStatus,
    listCommands,
    updateSettings,
    installPiAgent,
    listAgentRuns,
    getAgentRunTrace,
    getSessionMessages,
    sendPrompt,
  };
}

function renderController(
  harness: ReturnType<typeof createHarness>,
  initialWorkspace: WorkspaceInfo | null = null,
  isWorkspaceLoading = true,
) {
  return renderHook(
    (props: { workspaceInfo: WorkspaceInfo | null; isWorkspaceLoading: boolean }) =>
      useAiAgentController({
        aiAgent: harness.aiAgent,
        workspaceInfo: props.workspaceInfo,
        isWorkspaceLoading: props.isWorkspaceLoading,
      }),
    { initialProps: { workspaceInfo: initialWorkspace, isWorkspaceLoading } },
  );
}

async function waitForBootstrap(controller: ReturnType<typeof renderController>) {
  await waitFor(() => expect(controller.result.current.isInitialLoading).toBe(false));
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAiAgentController", () => {
  it("bootstraps settings/status, reports active errors, and suppresses stale configuration completion", async () => {
    const harness = createHarness();
    const firstSettings = deferred<PiAgentSettings>();
    const firstStatus = deferred<PiAgentStatus>();
    const secondSettings = deferred<PiAgentSettings>();
    const secondStatus = deferred<PiAgentStatus>();
    harness.getSettings
      .mockImplementationOnce(() => firstSettings.promise)
      .mockImplementationOnce(() => secondSettings.promise);
    harness.getStatus
      .mockImplementationOnce(() => firstStatus.promise)
      .mockImplementationOnce(() => secondStatus.promise);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const controller = renderController(harness);

    expect(controller.result.current.isInitialLoading).toBe(true);
    expect(controller.result.current.settings).toBeUndefined();
    expect(controller.result.current.status).toBeNull();

    let newestLoad!: Promise<void>;
    act(() => {
      newestLoad = controller.result.current.loadConfiguration();
    });
    secondSettings.resolve(settings(false, "newest-model"));
    secondStatus.resolve(status(false, false, "2.0.0"));
    await act(async () => newestLoad);

    expect(controller.result.current).toMatchObject({
      settings: expect.objectContaining({ enabled: false, model: "newest-model" }),
      status: expect.objectContaining({ enabled: false, version: "2.0.0" }),
      isInitialLoading: false,
      initialError: null,
      isEnabled: false,
      isAvailable: false,
    });

    firstSettings.resolve(settings(true, "stale-model"));
    firstStatus.reject(new Error("stale configuration failure"));
    await flushMicrotasks();

    expect(controller.result.current.settings?.model).toBe("newest-model");
    expect(controller.result.current.status?.version).toBe("2.0.0");
    expect(controller.result.current.initialError).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();

    harness.getSettings.mockRejectedValueOnce(new TypeError("active configuration failure"));
    harness.getStatus.mockResolvedValueOnce(status(true, true, "3.0.0"));
    await act(() => controller.result.current.loadConfiguration());

    expect(controller.result.current.isInitialLoading).toBe(false);
    expect(controller.result.current.initialError).toBe("active configuration failure");
    expect(controller.result.current.panelError).toBe("active configuration failure");
    expect(errorSpy).toHaveBeenLastCalledWith("[AiAgent] Failed to load Pi Agent configuration", {
      errorType: "TypeError",
    });
  });

  it("keeps command loading workspace-scoped and accepts only the newest request", async () => {
    const harness = createHarness();
    (harness.aiAgent as Partial<AiAgentPort>).getSessionMessages = undefined;
    (harness.aiAgent as Partial<AiAgentPort>).listAgentRuns = undefined;
    const controller = renderController(harness);
    await waitForBootstrap(controller);
    harness.listCommands.mockClear();

    const oldWorkspaceCommands = deferred<AiAgentCommand[]>();
    const firstCurrentCommands = deferred<AiAgentCommand[]>();
    const newestCurrentCommands = deferred<AiAgentCommand[]>();
    harness.listCommands
      .mockImplementationOnce(() => oldWorkspaceCommands.promise)
      .mockImplementationOnce(() => firstCurrentCommands.promise)
      .mockImplementationOnce(() => newestCurrentCommands.promise);

    let oldKey!: string;
    let oldLoad!: Promise<void>;
    act(() => {
      oldKey = controller.result.current.workspaceCollaborator.activateWorkspace(
        workspace("workspace-old"),
      );
      oldLoad = controller.result.current.workspaceCollaborator.loadCommands(oldKey);
    });
    expect(controller.result.current.isCommandsLoading).toBe(true);

    let firstCurrentLoad!: Promise<void>;
    let newestCurrentLoad!: Promise<void>;
    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      const currentKey = controller.result.current.workspaceCollaborator.activateWorkspace(
        workspace("workspace-current"),
      );
      firstCurrentLoad = controller.result.current.workspaceCollaborator.loadCommands(currentKey);
      newestCurrentLoad = controller.result.current.workspaceCollaborator.loadCommands(currentKey);
    });

    await act(async () => {
      newestCurrentCommands.resolve([
        { name: "newest", source: "skill", description: "newest command" },
      ]);
      await newestCurrentLoad;
    });
    expect(controller.result.current.commands.map((command) => command.name)).toEqual(["newest"]);
    expect(controller.result.current.isCommandsLoading).toBe(false);

    await act(async () => {
      firstCurrentCommands.reject(new Error("superseded command secret"));
      oldWorkspaceCommands.resolve([{ name: "old", source: "prompt" }]);
      await Promise.all([firstCurrentLoad, oldLoad]);
    });

    expect(controller.result.current.commands.map((command) => command.name)).toEqual(["newest"]);
    expect(controller.result.current.commandsError).toBeNull();
    expect(controller.result.current.isCommandsLoading).toBe(false);
  });

  it("restores only the active workspace session and trace with run summaries and deduped files", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    await waitForBootstrap(controller);

    const oldSession = deferred<PiAgentSessionMessages>();
    const currentSession = deferred<PiAgentSessionMessages>();
    const oldRuns = deferred<PiAgentRun[]>();
    const currentRuns = deferred<PiAgentRun[]>();
    const currentTrace = deferred<PiAgentRunTrace>();
    harness.getSessionMessages
      .mockImplementationOnce(() => oldSession.promise)
      .mockImplementationOnce(() => currentSession.promise);
    harness.listAgentRuns
      .mockImplementationOnce(() => oldRuns.promise)
      .mockImplementationOnce(() => currentRuns.promise);
    harness.getAgentRunTrace.mockImplementationOnce(() => currentTrace.promise);

    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("old"));
    });
    await waitFor(() => expect(harness.getSessionMessages).toHaveBeenCalledTimes(1));

    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("current"));
    });
    await waitFor(() => expect(harness.getSessionMessages).toHaveBeenCalledTimes(2));

    currentSession.resolve(
      session("current", [
        { id: "restored-user", role: "human", content: "restored question" },
        {
          id: "restored-assistant",
          role: "model",
          content: [{ text: "restored answer" }],
        },
        { id: "restored-tool", role: "tool", content: "tool output" },
      ]),
    );
    currentRuns.resolve([
      {
        runId: "run-current",
        traceId: "trace-current",
        agentId: "agent-current",
        workspaceId: "current",
        startedAt: "2026-07-13T10:00:00.000Z",
      },
    ]);
    await waitFor(() => expect(harness.getAgentRunTrace).toHaveBeenCalledWith("run-current"));
    currentTrace.resolve({
      runId: "run-current",
      events: [
        {
          type: "tool_execution_end",
          toolName: "write",
          status: "completed",
          result: {
            changedFiles: [
              { path: "src/changed.ts", status: "modified" },
              { path: "src/changed.ts", status: "modified" },
            ],
            details: {
              changedFiles: [
                { path: "src/changed.ts", status: "modified" },
                { path: "src/added.ts", status: "added" },
              ],
            },
          },
        },
      ],
    });

    await waitFor(() => expect(controller.result.current.activities).toHaveLength(1));
    expect(
      controller.result.current.messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: "user", content: "restored question" },
      { role: "assistant", content: "restored answer" },
      { role: "tool", content: "tool output" },
    ]);
    expect(controller.result.current.panelMessages.at(-1)?.role).toBe("system");
    expect(controller.result.current.latestResponse).toBe("restored answer");
    expect(controller.result.current.isResponsePanelOpen).toBe(true);
    expect(controller.result.current.activities[0]).toMatchObject({
      id: "ai-agent-trace-run-current-0-tool_execution_end",
      type: "tool_execution_end",
      pluginName: "write",
      status: "success",
      agentId: "agent-current",
      runId: "run-current",
      changedFiles: [
        { path: "src/changed.ts", status: "modified" },
        { path: "src/added.ts", status: "added" },
      ],
    });
    expect(controller.result.current.activities[0].detail).toContain("changed files:");
    expect(controller.result.current.activities[0].detail).toContain("agent: agent-current");

    oldSession.resolve(
      session("old", [{ role: "assistant", content: "OLD WORKSPACE MUST NOT APPEAR" }]),
    );
    oldRuns.resolve([{ runId: "old-run", agentId: "old-agent" }]);
    await flushMicrotasks();

    expect(JSON.stringify(controller.result.current.messages)).not.toContain("OLD WORKSPACE");
    expect(harness.getAgentRunTrace).not.toHaveBeenCalledWith("old-run");
    expect(controller.result.current.activities[0].runId).toBe("run-current");
  });

  it("isolates messages, response, activity, panel, sending, and error state across workspaces", async () => {
    const harness = createHarness();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const controller = renderController(harness);
    await waitForBootstrap(controller);

    const workspaceOneResponse = deferred<AiAgentResponse>();
    harness.sendPrompt.mockImplementation((prompt) => {
      if (prompt === "workspace one prompt") return workspaceOneResponse.promise;
      return Promise.reject(new Error("workspace two failure"));
    });

    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("one"));
    });
    await flushMicrotasks();

    let firstSend!: Promise<void>;
    act(() => {
      firstSend = controller.result.current.sendPrompt("workspace one prompt");
    });
    expect(controller.result.current).toMatchObject({
      isSending: true,
      latestResponse: null,
      isResponsePanelOpen: true,
      sendError: null,
    });
    expect(controller.result.current.messages.at(-1)).toMatchObject({
      role: "user",
      content: "workspace one prompt",
    });

    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("two"));
    });
    expect(controller.result.current).toMatchObject({
      messages: [],
      activities: [],
      latestResponse: null,
      isResponsePanelOpen: false,
      isSending: false,
      sendError: null,
    });

    await act(() => controller.result.current.sendPrompt("workspace two prompt"));
    expect(controller.result.current.messages).toHaveLength(1);
    expect(controller.result.current.messages[0].content).toBe("workspace two prompt");
    expect(controller.result.current.sendError).toBe("workspace two failure");
    expect(controller.result.current.isSending).toBe(false);
    expect(controller.result.current.isResponsePanelOpen).toBe(true);

    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("one"));
    });
    expect(controller.result.current.isSending).toBe(true);
    expect(controller.result.current.sendError).toBeNull();
    expect(controller.result.current.messages).toHaveLength(1);

    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("two"));
    });
    workspaceOneResponse.resolve({
      text: "workspace one answer",
      metadata: {
        events: [{ id: "one-event", type: "agent_end", status: "completed" }],
      },
    });
    await act(async () => firstSend);

    expect(controller.result.current.sendError).toBe("workspace two failure");
    expect(JSON.stringify(controller.result.current.messages)).not.toContain(
      "workspace one answer",
    );

    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("one"));
    });
    expect(controller.result.current).toMatchObject({
      latestResponse: "workspace one answer",
      isSending: false,
      sendError: null,
      isResponsePanelOpen: true,
    });
    expect(controller.result.current.messages.map((message) => message.content)).toEqual([
      "workspace one prompt",
      "workspace one answer",
    ]);
    expect(controller.result.current.activities.map((activity) => activity.id)).toEqual([
      "one-event",
    ]);
  });

  it("handles prompt guards, response metadata, trace append/merge, and close without resetting content", async () => {
    const harness = createHarness();
    const response = deferred<AiAgentResponse>();
    const runs = deferred<PiAgentRun[]>();
    const trace = deferred<PiAgentRunTrace>();
    harness.sendPrompt.mockImplementationOnce(() => response.promise);
    harness.listAgentRuns.mockImplementationOnce(() => runs.promise);
    harness.getAgentRunTrace.mockImplementationOnce(() => trace.promise);
    const controller = renderController(harness);
    await waitForBootstrap(controller);

    await act(() => controller.result.current.sendPrompt("   \n\t  "));
    expect(harness.sendPrompt).not.toHaveBeenCalled();

    let sending!: Promise<void>;
    act(() => {
      sending = controller.result.current.sendPrompt("  explicit prompt  ");
    });
    expect(harness.sendPrompt).toHaveBeenCalledOnce();
    expect(harness.sendPrompt).toHaveBeenCalledWith("explicit prompt");
    expect(controller.result.current.isResponsePanelVisible).toBe(true);
    expect(controller.result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "explicit prompt" }),
    ]);

    await act(() => controller.result.current.sendPrompt("duplicate must be ignored"));
    expect(harness.sendPrompt).toHaveBeenCalledOnce();

    response.resolve({
      text: "assistant response",
      metadata: {
        events: [
          {
            id: "shared-event",
            type: "tool_execution_end",
            toolName: "edit",
            status: "completed",
            changedFiles: [{ path: "src/from-response.ts", status: "modified" }],
            agentId: "response-agent",
            runId: "response-run",
          },
        ],
      },
    });
    await act(async () => sending);

    expect(controller.result.current).toMatchObject({
      latestResponse: "assistant response",
      isSending: false,
      sendError: null,
      isResponsePanelOpen: true,
      isResponsePanelVisible: true,
    });
    expect(
      controller.result.current.messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: "user", content: "explicit prompt" },
      { role: "assistant", content: "assistant response" },
    ]);
    expect(controller.result.current.activities).toEqual([
      expect.objectContaining({
        id: "shared-event",
        agentId: "response-agent",
        runId: "response-run",
        changedFiles: [{ path: "src/from-response.ts", status: "modified" }],
      }),
    ]);

    runs.resolve([{ runId: "persisted-run", agentId: "persisted-agent" }]);
    await waitFor(() => expect(harness.getAgentRunTrace).toHaveBeenCalledWith("persisted-run"));
    trace.resolve({
      runId: "persisted-run",
      events: [
        { id: "shared-event", type: "tool_execution_end", detail: "duplicate" },
        {
          id: "persisted-event",
          type: "agent_end",
          status: "completed",
          changedFiles: [
            { path: "src/persisted.ts", status: "added" },
            { path: "src/persisted.ts", status: "added" },
          ],
        },
      ],
    });
    await waitFor(() => expect(controller.result.current.activities).toHaveLength(2));
    expect(controller.result.current.activities.map((activity) => activity.id)).toEqual([
      "shared-event",
      "persisted-event",
    ]);
    expect(controller.result.current.activities[1]).toMatchObject({
      agentId: "persisted-agent",
      runId: "persisted-run",
      changedFiles: [{ path: "src/persisted.ts", status: "added" }],
    });

    act(() => controller.result.current.closeResponsePanel());
    expect(controller.result.current.isResponsePanelOpen).toBe(false);
    expect(controller.result.current.isResponsePanelVisible).toBe(false);
    expect(controller.result.current.latestResponse).toBe("assistant response");
    expect(controller.result.current.messages).toHaveLength(2);
    expect(controller.result.current.activities).toHaveLength(2);
    expect(controller.result.current.sendError).toBeNull();
  });

  it("sends only the explicit trimmed prompt and never logs sensitive prompt/session/trace payloads", async () => {
    const harness = createHarness();
    const canaries = {
      explicitPrompt: "PROMPT_CANARY_7fd3",
      source: "SOURCE_CANARY_a9e1",
      diagnostics: "DIAGNOSTICS_CANARY_2bc4",
      clipboard: "CLIPBOARD_CANARY_6d82",
      refactorPlan: "REFACTOR_PLAN_CANARY_f174",
      refactorResult: "REFACTOR_RESULT_CANARY_095a",
      xcomSetup: "XCOM_SETUP_CANARY_d013",
      xcomTransaction: "XCOM_TRANSACTION_CANARY_875b",
      editorContents: "EDITOR_CONTENTS_CANARY_cafe",
      editorSelection: "EDITOR_SELECTION_CANARY_babe",
      workspaceFile: "WORKSPACE_FILE_CANARY_ee55",
      workspace: "WORKSPACE_CANARY_44aa",
      session: "SESSION_CANARY_11cc",
      trace: "TRACE_CANARY_22dd",
      payload: "PAYLOAD_CANARY_33ee",
    };
    const sensitiveValues = Object.values(canaries);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    harness.getSessionMessages.mockResolvedValueOnce(
      session("private-workspace", [
        { role: "user", content: `${canaries.session} ${canaries.source}` },
      ]),
    );
    harness.listAgentRuns.mockResolvedValueOnce([
      { runId: "private-run", agentId: "private-agent" },
    ]);
    harness.getAgentRunTrace.mockResolvedValueOnce({
      runId: "private-run",
      events: [
        {
          type: "tool_execution_end",
          detail: [
            canaries.trace,
            canaries.payload,
            canaries.diagnostics,
            canaries.clipboard,
            canaries.refactorPlan,
            canaries.refactorResult,
            canaries.xcomSetup,
            canaries.xcomTransaction,
            canaries.editorContents,
            canaries.editorSelection,
            canaries.workspaceFile,
          ].join(" "),
        },
      ],
    });
    const controller = renderController(harness);
    await waitForBootstrap(controller);

    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      controller.result.current.workspaceCollaborator.activateWorkspace(
        workspace("private-workspace", `/private/${canaries.workspace}`),
      );
    });
    await waitFor(() => expect(controller.result.current.activities).toHaveLength(1));
    expect(JSON.stringify(controller.result.current.messages)).toContain(canaries.session);
    expect(JSON.stringify(controller.result.current.activities)).toContain(canaries.trace);

    harness.getSessionMessages.mockRejectedValueOnce(
      new Error(`${canaries.session} ${canaries.payload}`),
    );
    harness.listAgentRuns.mockRejectedValueOnce(new Error(`${canaries.trace} ${canaries.payload}`));
    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("warning-space"));
    });
    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(2));

    act(() => {
      controller.result.current.workspaceCollaborator.beginWorkspaceSwitch();
      controller.result.current.workspaceCollaborator.activateWorkspace(
        workspace("private-workspace", `/private/${canaries.workspace}`),
      );
    });
    harness.sendPrompt.mockRejectedValueOnce(new Error(sensitiveValues.join("|")));

    await act(() => controller.result.current.sendPrompt(`  ${canaries.explicitPrompt}  `));

    expect(harness.sendPrompt).toHaveBeenCalledOnce();
    const sendCall = harness.sendPrompt.mock.calls[0];
    expect(sendCall).toHaveLength(1);
    expect(sendCall[0]).toBe(canaries.explicitPrompt);
    for (const sensitive of sensitiveValues.filter((value) => value !== canaries.explicitPrompt)) {
      expect(sendCall[0]).not.toContain(sensitive);
    }

    expect(errorSpy).toHaveBeenCalledWith("[AiAgent] Failed to send AI Agent prompt", {
      errorType: "Error",
    });
    expect(warnSpy.mock.calls).toEqual(
      expect.arrayContaining([
        ["[AiAgent] Failed to restore Pi Agent session messages", { errorType: "Error" }],
        ["[AiAgent] Failed to load recent Pi Agent traces", { errorType: "Error" }],
      ]),
    );
    const serializedLogs = JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    for (const sensitive of sensitiveValues) {
      expect(serializedLogs).not.toContain(sensitive);
    }
  });

  it("invalidates configuration, command, session, trace, and send completions on unmount", async () => {
    const harness = createHarness();
    const pendingSettings = deferred<PiAgentSettings>();
    const pendingStatus = deferred<PiAgentStatus>();
    const pendingCommands = deferred<AiAgentCommand[]>();
    const pendingSend = deferred<AiAgentResponse>();
    harness.getSettings.mockImplementationOnce(() => pendingSettings.promise);
    harness.getStatus.mockImplementationOnce(() => pendingStatus.promise);
    harness.listCommands.mockImplementationOnce(() => pendingCommands.promise);
    harness.sendPrompt.mockImplementationOnce(() => pendingSend.promise);
    const controller = renderController(harness);

    let send!: Promise<void>;
    act(() => {
      send = controller.result.current.sendPrompt("unmount prompt");
    });
    const traceLoadsBeforeUnmount = harness.listAgentRuns.mock.calls.length;
    controller.unmount();

    pendingSettings.resolve(settings(true, "late-model"));
    pendingStatus.resolve(status(true, true, "late-version"));
    pendingCommands.resolve([{ name: "late-command", source: "skill" }]);
    pendingSend.resolve({ text: "late response" });
    await send;
    await flushMicrotasks();

    expect(harness.listAgentRuns).toHaveBeenCalledTimes(traceLoadsBeforeUnmount);
  });
});
