import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  JavaEffectiveProjectContext,
  MavenModuleRenameApplyRequest,
  MavenModuleRenameApplyResult,
  MavenModuleRenamePreview as MavenModuleRenamePreviewResult,
  MavenModuleRenamePreviewRequest,
  MavenModuleRenameRollbackRequest,
  MavenModuleRenameRollbackResult,
  RefactorKitCapabilities,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { MavenModuleRenamePreview, type MavenModuleRenameTransaction } from "./MavenModuleRenamePreview";

const capabilities: RefactorKitCapabilities = {
  api: "refactorkit",
  apiVersion: "0.2",
  provider: "refactorkit-daemon",
  providerVersion: "0.8.0-SNAPSHOT",
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
      name: "java.renameMavenModule",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
      features: { preview: true, renderedDiff: true, apply: true, rollback: true },
    },
  ],
};

const context: JavaEffectiveProjectContext = {
  schemaVersion: "java-project-context-v1",
  status: "available",
  snapshotHash: "a".repeat(64),
  contextHash: "b".repeat(64),
  sdk: [],
  providers: [
    {
      providerId: "maven-effective-v1",
      status: "available",
      strategy: "embedded-effective-model",
      buildCodeExecution: "denied",
      credentialsAccess: "denied",
      networkAccess: "denied",
      diagnostics: [],
    },
  ],
  modules: [
    {
      providerId: "maven-effective-v1",
      id: "catalog-model",
      name: "catalog-model",
      root: "catalog-model",
      sourceSets: [],
    },
  ],
  buildEvidence: [],
  selectedSource: null,
  analysis: null,
  refusal: null,
};

function setup({
  current = true,
  projectContext = context,
}: { current?: boolean; projectContext?: JavaEffectiveProjectContext } = {}) {
  let workspace = {
    workspaceId: current ? "workspace-one" : "workspace-two",
    generation: current ? 3 : 4,
    isSwitching: false,
    isMetadataLoading: false,
  };
  const result: MavenModuleRenamePreviewResult = {
    planId: "plan-module-1",
    operation: "java.renameMavenModule",
    status: "preview",
    summary: "Rename catalog-model to catalog-domain",
    snapshotHash: "a".repeat(64),
    affectedFiles: ["pom.xml", "catalog-model/pom.xml"],
    renderedDiff: "--- a/pom.xml\n+++ b/pom.xml\n",
    diffTruncated: false,
    diffTruncationReasons: [],
    provider: "refactorkit-java",
    providerVersion: "0.8.0-SNAPSHOT",
    workspaceId: "workspace-one",
    workspaceGeneration: 3,
    selectionGeneration: 1,
    requestId: "maven-module-rename-1-1",
  };
  const port = {
    previewMavenModuleRename: vi.fn(async (request: MavenModuleRenamePreviewRequest) => ({
      ...result,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    })),
    discardMavenModuleRenamePreview: vi.fn(async () => true),
    applyMavenModuleRename: vi.fn(
      async (request: MavenModuleRenameApplyRequest) =>
        ({
          planId: request.planId,
          transactionId: "transaction-module-1",
          snapshotHash: "c".repeat(64),
          changedFiles: [
            {
              change: "move" as const,
              path: "catalog-domain/pom.xml",
              previousPath: "catalog-model/pom.xml",
              primary: true,
            },
          ],
          provider: "refactorkit-java",
          providerVersion: "0.8.0-SNAPSHOT",
        }) satisfies MavenModuleRenameApplyResult,
    ),
    rollbackMavenModuleRename: vi.fn(
      async (request: MavenModuleRenameRollbackRequest) =>
        ({
          transactionId: request.transactionId,
          rolledBack: true,
          changedFiles: [
            {
              change: "move" as const,
              path: "catalog-model/pom.xml",
              previousPath: "catalog-domain/pom.xml",
              primary: true,
            },
          ],
        }) satisfies MavenModuleRenameRollbackResult,
    ),
  } as unknown as RefactorKitPort;
  const getWorkspaceContext = vi.fn(() => workspace);
  const beginWorkspaceWrite = vi.fn(() => vi.fn());
  const reconcileChanges = vi.fn(async () => undefined);
  const onSourceChanged = vi.fn();
  function Panel({ visible = true }: { visible?: boolean }) {
    const [transaction, setTransaction] = useState<MavenModuleRenameTransaction | null>(null);
    return visible ? (
      <MavenModuleRenamePreview
        context={projectContext}
        workspaceId={current ? "workspace-one" : "workspace-two"}
        generation={current ? 3 : 4}
        isWriting={false}
        capabilities={capabilities}
        port={port}
        getWorkspaceContext={getWorkspaceContext}
        beginWorkspaceWrite={beginWorkspaceWrite}
        reconcileChanges={reconcileChanges}
        onSourceChanged={onSourceChanged}
        transactionState={{ transaction, setTransaction }}
      />
    ) : null;
  }
  const view = render(<Panel />);
  return {
    port,
    result,
    view,
    getWorkspaceContext,
    beginWorkspaceWrite,
    reconcileChanges,
    onSourceChanged,
    setPanelVisible(visible: boolean) {
      view.rerender(<Panel visible={visible} />);
    },
    setWorkspace(value: typeof workspace) {
      workspace = value;
    },
  };
}

describe("Maven module rename preview", () => {
  it("keeps provider-scoped rename available when the aggregate context is partial", () => {
    setup({ projectContext: { ...context, status: "partial" } });

    expect(
      (screen.getByRole("button", { name: "Review Maven module rename" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("uses the provider's module model and displays its reviewed diff before Apply", async () => {
    const { port } = setup({ projectContext: { ...context, status: "partial" } });
    fireEvent.click(screen.getByRole("button", { name: "Review Maven module rename" }));
    fireEvent.change(
      screen.getByLabelText("New module directory, relative to the selected Java project"),
      {
        target: { value: "catalog-domain" },
      },
    );
    fireEvent.change(screen.getByLabelText("New Maven artifact ID (optional)"), {
      target: { value: "catalog-domain" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview rename" }));

    await screen.findByText("Rename catalog-model to catalog-domain");
    expect(port.previewMavenModuleRename).toHaveBeenCalledWith(
      expect.objectContaining({
        oldModuleDir: "catalog-model",
        newModuleDir: "catalog-domain",
        newArtifactId: "catalog-domain",
        expectedSnapshotHash: context.snapshotHash,
        expectedContextHash: context.contextHash,
        workspaceId: "workspace-one",
        workspaceGeneration: 3,
      }),
    );
    expect(screen.getByText((_text, element) => element?.tagName === "PRE").textContent).toContain(
      "--- a/pom.xml",
    );
    expect(
      (screen.getByRole("button", { name: "Apply reviewed rename" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("keeps rollback available after reopening the panel until confirmed", async () => {
    const { port, beginWorkspaceWrite, reconcileChanges, onSourceChanged, setPanelVisible } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Review Maven module rename" }));
    fireEvent.change(
      screen.getByLabelText("New module directory, relative to the selected Java project"),
      { target: { value: "catalog-domain" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview rename" }));
    await screen.findByText("Rename catalog-model to catalog-domain");
    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed rename" }));

    await screen.findByRole("button", { name: "Rollback Maven rename" });
    expect(port.applyMavenModuleRename).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-module-1",
        workspaceId: "workspace-one",
        workspaceGeneration: 3,
        approval: expect.objectContaining({ approvedPlanId: "plan-module-1" }),
      }),
    );
    expect(beginWorkspaceWrite).toHaveBeenCalledOnce();
    expect(onSourceChanged).toHaveBeenCalledOnce();
    expect(reconcileChanges).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ path: "catalog-domain/pom.xml" })]),
      expect.any(Function),
    );

    setPanelVisible(false);
    expect(screen.queryByRole("button", { name: "Rollback Maven rename" })).toBeNull();
    setPanelVisible(true);
    fireEvent.click(screen.getByRole("button", { name: "Rollback Maven rename" }));
    await waitFor(() => expect(port.rollbackMavenModuleRename).toHaveBeenCalledOnce());
    expect(
      (
        (await screen.findByRole("button", {
          name: "Review Maven module rename",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Rollback Maven rename" })).toBeNull();
    expect(onSourceChanged).toHaveBeenCalledTimes(2);
    expect(reconcileChanges).toHaveBeenCalledTimes(2);
  });

  it("refuses Apply when the editor cannot grant a clean external-write lock", async () => {
    const { port, beginWorkspaceWrite } = setup();
    beginWorkspaceWrite.mockImplementationOnce(() => {
      throw new Error("Save all editor buffers before applying.");
    });
    fireEvent.click(screen.getByRole("button", { name: "Review Maven module rename" }));
    fireEvent.change(
      screen.getByLabelText("New module directory, relative to the selected Java project"),
      { target: { value: "catalog-domain" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview rename" }));
    await screen.findByText("Rename catalog-model to catalog-domain");
    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed rename" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Save all editor buffers");
    expect(port.applyMavenModuleRename).not.toHaveBeenCalled();
  });

  it("keeps provider recovery details available without presenting them as a successful Apply", async () => {
    const { port, onSourceChanged } = setup();
    const providerFailure =
      "RefactorKit could not roll back because the transaction conflicts with current workspace state.; transaction journals: " +
      JSON.stringify({ state: "RECOVERY_REQUIRED", failure: "staging file ownership changed" });
    vi.mocked(port.applyMavenModuleRename).mockRejectedValueOnce(new Error(providerFailure));
    fireEvent.click(screen.getByRole("button", { name: "Review Maven module rename" }));
    fireEvent.change(
      screen.getByLabelText("New module directory, relative to the selected Java project"),
      { target: { value: "catalog-domain" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview rename" }));
    await screen.findByText("Rename catalog-model to catalog-domain");
    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed rename" }));

    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("p")?.textContent).toContain(
      "Maven module rename Apply failed or could not be confirmed. Inspect the project before retrying.",
    );
    const technicalDetails = alert.querySelector("details");
    expect(technicalDetails?.open).toBe(false);
    expect(technicalDetails?.textContent).toContain("Technical details");
    fireEvent.click(screen.getByText("Technical details"));
    expect(alert.textContent).toContain("RECOVERY_REQUIRED");
    expect(alert.textContent).toContain("staging file ownership changed");
    expect(onSourceChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Maven module rename preview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rollback Maven rename" })).toBeNull();
  });

  it("discards the retained preview when the dialog closes", async () => {
    const { port, result } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Review Maven module rename" }));
    fireEvent.change(
      screen.getByLabelText("New module directory, relative to the selected Java project"),
      {
        target: { value: "catalog-domain" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview rename" }));
    await screen.findByText(result.summary);
    fireEvent.click(screen.getByRole("button", { name: "Close and discard preview" }));

    await waitFor(() =>
      expect(port.discardMavenModuleRenamePreview).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: result.planId,
          workspaceId: "workspace-one",
          workspaceGeneration: 3,
        }),
      ),
    );
    expect(screen.queryByRole("dialog", { name: "Maven module rename preview" })).toBeNull();
  });

  it("keeps the request inputs aligned with the visible provider plan", async () => {
    const { port } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Review Maven module rename" }));
    const directory = screen.getByLabelText(
      "New module directory, relative to the selected Java project",
    );
    const artifactId = screen.getByLabelText("New Maven artifact ID (optional)");
    fireEvent.change(directory, { target: { value: "catalog-domain" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview rename" }));
    await screen.findByText("Rename catalog-model to catalog-domain");

    expect((directory as HTMLInputElement).disabled).toBe(true);
    expect((artifactId as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Close and discard preview" }));
    await waitFor(() => expect(port.discardMavenModuleRenamePreview).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Review Maven module rename" }));
    const reopenedDirectory = screen.getByLabelText(
      "New module directory, relative to the selected Java project",
    );
    const reopenedArtifactId = screen.getByLabelText("New Maven artifact ID (optional)");
    expect((reopenedDirectory as HTMLInputElement).disabled).toBe(false);
    expect((reopenedArtifactId as HTMLInputElement).disabled).toBe(false);
    expect((reopenedDirectory as HTMLInputElement).value).toBe("catalog-domain");
  });

  it("discards a provider result that arrives after the workspace authority changes", async () => {
    let resolvePreview!: (value: MavenModuleRenamePreviewResult) => void;
    const { port, result, setWorkspace } = setup();
    vi.mocked(port.previewMavenModuleRename).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review Maven module rename" }));
    fireEvent.change(
      screen.getByLabelText("New module directory, relative to the selected Java project"),
      {
        target: { value: "catalog-domain" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview rename" }));
    await waitFor(() => expect(port.previewMavenModuleRename).toHaveBeenCalledOnce());
    setWorkspace({
      workspaceId: "workspace-two",
      generation: 4,
      isSwitching: false,
      isMetadataLoading: false,
    });
    resolvePreview(result);

    await waitFor(() => expect(port.discardMavenModuleRenamePreview).toHaveBeenCalledOnce());
    expect(screen.queryByText(result.summary)).toBeNull();
  });
});
