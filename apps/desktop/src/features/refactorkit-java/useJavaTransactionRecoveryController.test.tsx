import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RefactorKitCapabilities, JavaProjectContextSettings } from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core";
import { javaProjectContextResponse } from "../../../../../tests/story/fixtures/java-project-context-response";
import { recoveryHarness } from "../../../../../tests/unit/fixtures/java-editor-recovery";
import { useJavaTransactionRecoveryController } from "./useJavaTransactionRecoveryController";

async function setup(capabilitiesLoading = false) {
  const h = await recoveryHarness();
  let settings: JavaProjectContextSettings = {
    projectPath: "",
    sdkHome: "/jdk",
    mavenRepository: "",
    activeMavenProfiles: [],
    inactiveMavenProfiles: [],
  };
  let workspace = { workspaceId: "workspace", generation: 1, isSwitching: false };
  const context = javaProjectContextResponse({
    ...settings,
    ...workspace,
    requestId: "synchronized",
  }).context;
  const capabilities: RefactorKitCapabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "daemon",
    providerVersion: "test-double",
    javaImportExternalClass: {
      supported: false,
      targetDirectory: false,
      preview: false,
      apply: false,
      rollback: false,
      stability: "experimental",
    },
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: [],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: false,
      dirtyEditorMutationAuthority: true,
      durableEditorRecovery: true,
      editorTransactionSchemaVersion: "java-editor-transaction-v1",
    },
    methods: ["transactions", "recover", "undo.confirm"].map((phase) => ({
      name: `refactor.editor.${phase}`,
      requiresProject: true,
      writesWorkspace: false,
      stability: "stable",
      features: { [phase === "transactions" ? "durableDiscovery" : "durableRecovery"]: true },
    })),
  };
  let advertised: RefactorKitCapabilities | null = capabilitiesLoading ? null : capabilities;
  const getCapabilities = vi.fn(async () => capabilities);
  const sourceInvoke = h.invoke.getMockImplementation()!;
  h.invoke.mockImplementation(async (q) =>
    q.phase === "transactions" ? { kind: "discovery", transactions: [h.entry] } : sourceInvoke(q),
  );
  const reconcile = vi.fn(async () => undefined),
    retire = vi.fn();
  const hook = renderHook(() =>
    useJavaTransactionRecoveryController({
      ...workspace,
      port: { editorTransaction: h.invoke, getCapabilities } as unknown as RefactorKitPort,
      editor: h.editor,
      capabilities: advertised,
      getWorkspaceContext: () => workspace,
      getProjectContext: () => ({ settings, context }),
      isOtherWriting: false,
      onSourceChanged: retire,
      reconcile,
    }),
  );
  const open = () => act(() => hook.result.current.refresh());
  const review = () => act(() => hook.result.current.review(hook.result.current.state!.entries[0]));
  return {
    ...h,
    hook,
    capabilities,
    getCapabilities,
    withdrawRecovery: () => {
      advertised = {
        ...capabilities,
        javaContextRefactoring: {
          ...capabilities.javaContextRefactoring!,
          durableEditorRecovery: false,
        },
      };
      hook.rerender();
    },
    reconcile,
    retire,
    open,
    review,
    changeSdk: () => {
      settings = { ...settings, sdkHome: "/other-sdk" };
    },
    changeWorkspace: () => {
      workspace = { ...workspace, generation: workspace.generation + 1 };
      hook.rerender();
    },
  };
}

describe("Java transaction recovery controller", () => {
  it("acquires actual capabilities for an explicit refresh while startup discovery is still loading", async () => {
    const h = await setup(true);
    await h.open();
    await h.review();
    expect(h.getCapabilities).toHaveBeenCalledOnce();
    expect(h.hook.result.current.state?.phase).toBe("review");
    act(() => h.withdrawRecovery());
    await act(() => h.hook.result.current.restore());
    expect(h.hook.result.current.state?.phase).toBe("error");
    expect(h.invoke.mock.calls.map(([q]) => q.phase)).toEqual(["transactions", "recover"]);
  });
  it("lists, reviews and explicitly restores the original draft through production editor code", async () => {
    const h = await setup();
    await h.open();
    expect(h.hook.result.current.state?.phase).toBe("ready");
    await h.review();
    expect(h.hook.result.current.state?.phase).toBe("review");
    expect(h.store.getState().contents["B.java"]).toBe(h.saved);
    await act(() => h.hook.result.current.restore());
    expect(h.hook.result.current.state?.phase).toBe("restored");
    expect(h.hook.result.current.state?.entries[0].status).toBe("undone");
    expect(h.store.getState().contents["A.java"]).toBe(h.original);
    expect(h.retire).toHaveBeenCalledOnce();
    expect(h.reconcile).toHaveBeenCalledOnce();
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
  });
  it("refuses changed SDK settings after review before any restoration call", async () => {
    const h = await setup();
    await h.open();
    await h.review();
    h.changeSdk();
    await act(() => h.hook.result.current.restore());
    expect(h.hook.result.current.state?.phase).toBe("error");
    expect(h.invoke.mock.calls.map(([q]) => q.phase)).toEqual(["transactions", "recover"]);
    expect(h.store.getState().contents["B.java"]).toBe(h.saved);
  });
  it("retires the dialog on workspace generation change without applying the old inverse", async () => {
    const h = await setup();
    await h.open();
    await h.review();
    act(() => h.changeWorkspace());
    expect(h.hook.result.current.state).toBeNull();
    await act(() => h.hook.result.current.restore());
    expect(h.files.has("B.java")).toBe(true);
    expect(h.invoke).toHaveBeenCalledTimes(2);
  });
  it("keeps confirmed buffer changes when acknowledgement is lost and does not report restored", async () => {
    const h = await setup();
    await h.open();
    await h.review();
    const original = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (q) => {
      if (q.phase === "undo.confirm") throw Error("lost confirmation");
      return original(q);
    });
    await act(() => h.hook.result.current.restore());
    expect(h.hook.result.current.state?.phase).toBe("error");
    expect(h.hook.result.current.state?.message).toContain("lost confirmation");
    expect(h.store.getState().contents["A.java"]).toBe(h.original);
    expect(h.reconcile).toHaveBeenCalledOnce();
    expect(h.hook.result.current.isWriting).toBe(false);
  });
  it("cancels review without moving a saved file or changing the current draft", async () => {
    const h = await setup();
    await h.open();
    await h.review();
    act(() => h.hook.result.current.close());
    expect(h.hook.result.current.state).toBeNull();
    expect(h.files.has("B.java")).toBe(true);
    expect(h.store.getState().contents["B.java"]).toBe(h.saved);
    expect(h.invoke.mock.calls.map(([q]) => q.phase)).toEqual(["transactions", "recover"]);
  });
});
