import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PiWorkspaceAgentAccessories, PiWorkspaceAgentAttachment } from "@ide/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./PiNativeTerminal", () => ({
  PiNativeTerminal: ({ onData, onResize, isRunning }: any) => (
    <div data-testid="PiNativeTerminal" data-running={String(isRunning)}>
      <button type="button" onClick={() => onData("\u001b[13;2u")}>
        Send raw Shift Enter
      </button>
      <button type="button" onClick={() => onResize(90, 40)}>
        Resize raw PTY
      </button>
    </div>
  ),
}));

import { PiWorkspaceAgentScreen } from "./PiWorkspaceAgentScreen";

function attachment(state: "running" | "stopped" = "running"): PiWorkspaceAgentAttachment {
  const session = {
    workspaceId: "workspace-a",
    workspaceName: "Workspace A",
    rootPath: "/workspace/a",
    sessionId: "ide-workspace-a",
    processState: state,
    processGeneration: 1,
    processId: state === "running" ? 101 : undefined,
    startedAt: "2026-08-09T00:00:00.000Z",
    lastActivityAt: "2026-08-09T00:00:02.000Z",
    attachedViewCount: 1,
  } as const;
  return {
    protocolVersion: 1,
    session,
    transcriptBase64: "",
    transcriptSequence: 0,
    transcriptTruncated: false,
    activities: [
      {
        sequence: 1,
        eventType: "started",
        timestamp: "2026-08-09T00:00:00.000Z",
        detail: "Pi process started with deterministic session ide-workspace-a",
      },
      {
        sequence: 2,
        eventType: "detached",
        timestamp: "2026-08-09T00:00:02.000Z",
        detail: "Renderer detached; no EOF or termination signal was sent",
      },
    ],
    sessions: [
      {
        workspaceId: session.workspaceId,
        workspaceName: session.workspaceName,
        sessionId: session.sessionId,
        processState: session.processState,
        processGeneration: session.processGeneration,
        lastActivityAt: session.lastActivityAt,
        attachedViewCount: session.attachedViewCount,
      },
      {
        workspaceId: "workspace-b",
        workspaceName: "Workspace B",
        sessionId: "ide-workspace-b",
        processState: session.processState,
        processGeneration: session.processGeneration,
        lastActivityAt: session.lastActivityAt,
        attachedViewCount: session.attachedViewCount,
      },
    ],
  };
}

function accessories(): PiWorkspaceAgentAccessories {
  return {
    protocolVersion: 1,
    workspaceId: "workspace-a",
    changes: [{ path: "src/App.tsx", status: "modified" }],
    resources: [
      ...Array.from({ length: 7 }, (_, index) => ({
        kind: "package" as const,
        name: `package-${index + 1}`,
        scope: "user" as const,
        path: `/home/user/.pi/package-${index + 1}`,
      })),
      {
        kind: "command",
        name: "skill:multi-agent",
        scope: "effective",
        source: "skill",
      },
    ],
    warnings: [],
  };
}

function props() {
  return {
    workspaceId: "workspace-a",
    workspaceName: "Workspace A",
    attachment: attachment(),
    accessories: accessories(),
    terminalFeed: { subscribe: vi.fn(() => vi.fn()) },
    isAttaching: false,
    isAccessoryLoading: false,
    onData: vi.fn(),
    onResize: vi.fn(),
    onRefresh: vi.fn(),
    onRefreshAccessories: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onDetach: vi.fn(),
    onOpenChangedFile: vi.fn(),
  };
}

describe("PiWorkspaceAgentScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps native Pi and all four accessory views on one composite screen", () => {
    const input = props();
    render(<PiWorkspaceAgentScreen {...input} />);

    const tabList = screen.getByRole("tablist", { name: "Agent screen sections" });
    expect(
      within(tabList)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Pi", "Changes1", "Activity", "Resources", "Sessions"]);
    expect(screen.getByTestId("PiNativeTerminal").dataset.running).toBe("true");
    expect(screen.getByText(/Native Pi TUI/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Send raw Shift Enter" }));
    fireEvent.click(screen.getByRole("button", { name: "Resize raw PTY" }));
    expect(input.onData).toHaveBeenCalledWith("\u001b[13;2u");
    expect(input.onResize).toHaveBeenCalledWith(90, 40);
  });

  it("shows all installed packages even when only one command exists", () => {
    const input = props();
    render(<PiWorkspaceAgentScreen {...input} />);

    fireEvent.click(screen.getByRole("tab", { name: "Resources" }));

    expect(screen.getByText("7 packages · 1 commands")).toBeDefined();
    expect(screen.getByText("package-7")).toBeDefined();
    expect(screen.getByText("skill:multi-agent")).toBeDefined();
    expect(screen.getByRole("list", { name: "Installed Pi packages and commands" })).toBeDefined();
  });

  it("opens changes through the supplied editor authority and labels sessions without messages", () => {
    const input = props();
    render(<PiWorkspaceAgentScreen {...input} />);

    fireEvent.click(screen.getByRole("tab", { name: /Changes/ }));
    fireEvent.click(screen.getByRole("button", { name: /src\/App\.tsx/ }));
    expect(input.onOpenChangedFile).toHaveBeenCalledWith("src/App.tsx");

    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByText("ide-workspace-a")).toBeDefined();
    expect(screen.getByText("ide-workspace-b")).toBeDefined();
    expect(screen.queryByText(/assistant|user|message history/i)).toBeNull();
  });

  it("requires a separate named confirmation and cancellation never stops Pi", () => {
    const input = props();
    render(<PiWorkspaceAgentScreen {...input} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop Pi" }));
    const dialog = screen.getByRole("dialog", { name: "Stop Pi for Workspace A?" });
    expect(within(dialog).getByText(/terminates the live Pi process/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(input.onStop).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Stop Pi" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Stop Pi for Workspace A?" })).getByRole("button", {
        name: "Stop Pi",
      }),
    );
    expect(input.onStop).toHaveBeenCalledOnce();
  });

  it("detaches through a view-only action and explains that closing does not stop Pi", () => {
    const input = props();
    render(<PiWorkspaceAgentScreen {...input} />);

    fireEvent.click(screen.getByRole("button", { name: "Detach Pi Agent for Workspace A" }));

    expect(input.onDetach).toHaveBeenCalledOnce();
    expect(input.onStop).not.toHaveBeenCalled();
    expect(screen.getByText(/closing this view does not stop Pi/)).toBeDefined();
  });
});
