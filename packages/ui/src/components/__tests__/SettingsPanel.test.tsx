// ---------------------------------------------------------------------------
// @ide/ui – SettingsPanel Component Tests
// ---------------------------------------------------------------------------

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_PI_AGENT_SETTINGS, XCOM2_STEAM_PRODUCTS } from "@ide/contracts";
import type {
  PiAgentSettings,
  PiAgentStatus,
  LanguageServiceStatus,
  WorkspaceInfo,
  WorkspaceRegistry,
  Xcom2ModuleConfigurationDiagnosticPresentation,
  Xcom2SetupMonitorSnapshot,
  Xcom2SetupPlan,
} from "@ide/contracts";
import { SettingsPanel } from "../SettingsPanel/SettingsPanel";
import {
  BROWSER_LANGUAGE_KERNEL_CAPABILITIES,
  BROWSER_LANGUAGE_KERNEL_REASON,
  PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES,
} from "./refactorkitLanguageKernel.fixture";

const settings: PiAgentSettings = {
  ...DEFAULT_PI_AGENT_SETTINGS,
  enabled: true,
  preferredIntegration: "sdk",
  fallbackIntegrations: ["cli", "sdk"],
  model: "gpt-5.5",
  cliPath: "/usr/local/bin/pi",
};

const status: PiAgentStatus = {
  provider: "pi",
  enabled: true,
  available: true,
  availability: "available",
  preferredIntegration: "rpc",
  activeIntegration: "rpc",
  fallbackIntegrations: [],
  version: "1.2.3",
  checkedAt: "2026-07-10T10:00:00.000Z",
  lastError: "RPC handshake failed",
};

const javaLanguageServiceStatus: LanguageServiceStatus = {
  state: "ready",
  provider: "jdt-ls",
  providerVersion: "1.2.0",
  serverPath: "/tools/jdtls",
  serverVersion: "1.42.0",
  javaExecutable: "/jdk/bin/java",
  javaVersion: "21.0.4",
  workspaceId: "global-tooling",
  generation: 2,
  checkedAt: "2026-07-11T16:30:00.000Z",
  capabilities: {
    documentSync: true,
    diagnostics: true,
    completion: true,
    hover: true,
    signature: true,
    definition: true,
    references: true,
    symbols: true,
    codeActions: true,
    formatting: true,
    rename: true,
    hierarchy: true,
  },
};

const workspaceInfo: WorkspaceInfo = {
  id: "workspace-alpha",
  name: "Project Alpha",
  rootPath: "/work/project-alpha",
  createdAt: "2026-07-01T08:00:00.000Z",
  lastOpenedAt: "2026-07-10T09:30:00.000Z",
};

const xcom2Snapshot: Xcom2SetupMonitorSnapshot = {
  workspaceId: "machine-setup",
  generation: 2,
  steamRoot: {
    source: "unknown",
    displayRoot: "Steam unavailable",
    pathRedacted: true,
  },
  products: [
    {
      product: XCOM2_STEAM_PRODUCTS.game,
      lifecycle: "downloading",
      bytesDownloaded: 50,
      bytesToDownload: 100,
      bytesStaged: 25,
      bytesToStage: 100,
      downloadPercentage: 50,
      stagingPercentage: 25,
      installDirectoryPresent: false,
      downloadDirectoryPresent: true,
      complete: false,
      completionReasons: ["Download is active"],
      stable: false,
      stabilityReasons: ["Steam is writing download data"],
      mutationBlocked: true,
      mutationBlockedReasons: ["Wait for Steam"],
      checkedAt: "2026-07-11T18:30:00.000Z",
    },
  ],
  overallState: "downloading",
  canPlanSetup: false,
  canApplySetup: false,
  blockers: ["Required Steam downloads are incomplete"],
  warnings: [],
  checkedAt: "2026-07-11T18:30:00.000Z",
};

const xcom2Plan: Xcom2SetupPlan = {
  version: 1,
  planId: "machine-setup:2:snapshot",
  workspaceId: "machine-setup",
  workspaceGeneration: 2,
  sourceCheckedAt: xcom2Snapshot.checkedAt,
  state: "waiting-for-download",
  dryRun: true,
  canApply: false,
  steps: [],
  blockers: ["Required Steam downloads are incomplete"],
  warnings: [],
  generatedAt: xcom2Snapshot.checkedAt,
};

const workspaceRegistry: WorkspaceRegistry = {
  version: 1,
  currentWorkspaceId: "workspace-alpha",
  workspaces: [
    workspaceInfo,
    {
      id: "workspace-beta",
      name: "Project Beta",
      rootPath: "/work/project-beta",
      createdAt: "2026-07-02T08:00:00.000Z",
    },
  ],
};

const diagnosticPresentation = {
  title: "XCOM 2 project configuration needs attention",
  projectFileLabel: ".ide/xcom2.json",
  summary: "The XCOM 2 project configuration is not valid JSON.",
  remediation:
    "Correct the JSON syntax so the file contains one complete JSON object, then refresh the workspace.",
  supportIdentifier: "configuration-invalid-json",
} as const satisfies Xcom2ModuleConfigurationDiagnosticPresentation;

describe("SettingsPanel", () => {
  it("presents native Pi TUI authority separately from legacy RPC compatibility", () => {
    render(
      React.createElement(SettingsPanel, { aiAgentSettings: settings, aiAgentStatus: status }),
    );

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
    expect(screen.getByRole("tab", { name: /AI Agents/i }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect((screen.getByRole("tab", { name: /Workspace/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole("tab", { name: /Editor/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Pi Agent runtime")).toBeDefined();
    expect(screen.getByText("Native Agent authority")).toBeDefined();
    expect(screen.getByText("Native Pi TUI / PTY")).toBeDefined();
    expect(screen.getByText(/Chat, history, tools, models, commands, extensions/)).toBeDefined();
    expect(screen.getByText("1.2.3")).toBeDefined();
    expect(screen.getByText("RPC handshake failed")).toBeDefined();
    expect(screen.getByText("Legacy RPC")).toBeDefined();
    expect(screen.queryByLabelText("Preferred integration")).toBeNull();
    expect(screen.queryByLabelText("Pi Agent model")).toBeNull();
    expect(screen.queryByLabelText("Pi Agent CLI path")).toBeNull();
    expect(screen.queryByText("Fallback integrations")).toBeNull();
    expect(screen.queryByRole("button", { name: /Use recommended RPC/i })).toBeNull();
    expect(
      (screen.getByRole("button", { name: /Pi Agent detected/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("presents Languages / Language tooling while keeping Eclipse JDT controls explicit", () => {
    const callbacks = {
      onStartJavaLanguageService: vi.fn(),
      onStopJavaLanguageService: vi.fn(),
      onRestartJavaLanguageService: vi.fn(),
      onRefreshJavaLanguageService: vi.fn(),
      onRefreshJavaRefactorKit: vi.fn(),
      onRequestLanguageToolingDiagnostics: vi.fn(),
    };
    render(
      React.createElement(SettingsPanel, {
        javaLanguageServiceStatus,
        javaRefactorKitStatus: { available: true, version: "2.1.0", path: "/tools/refactorkit" },
        javaRefactorKitCapabilities: PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES,
        languageToolingDiagnostics: { state: "ready", diagnosticCount: 3 },
        ...callbacks,
      }),
    );

    const languagesTab = screen.getByRole("tab", {
      name: "LanguagesLanguage tooling",
    }) as HTMLButtonElement;
    expect(languagesTab.disabled).toBe(false);
    expect(languagesTab.textContent).toBe("LanguagesLanguage tooling");
    fireEvent.click(languagesTab);

    expect(languagesTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Languages" })).toBeDefined();
    expect(
      screen.getByText(/Inspect language capability discovery and manage provider-specific/u),
    ).toBeDefined();
    expect(screen.getByRole("region", { name: "Language tooling" })).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Java Language Service · Eclipse JDT LS" }),
    ).toBeDefined();
    expect(
      screen.getByRole("status", { name: "Eclipse JDT LS lifecycle status" }).textContent,
    ).toBe("ready");
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "SPAN" && element.textContent?.includes("1.42.0") === true,
      ),
    ).toBeDefined();
    expect(screen.getByText("2.1.0")).toBeDefined();
    expect(screen.getByText("/tools/refactorkit")).toBeDefined();
    expect(
      screen.getByRole("status", {
        name: "RefactorKit language capability discovery status",
      }).textContent,
    ).toBe("Schema v1");
    expect(
      screen.getByRole("list", {
        name: "Daemon-advertised language adapters in canonical order",
      }).children,
    ).toHaveLength(3);
    expect(
      screen.getByRole("status", { name: "Compiler diagnostics status: Ready" }).textContent,
    ).toContain("3 compiler diagnostics are available in Problems and editor markers.");

    for (const operation of [
      "Scan",
      "Diagnostics",
      "Symbols",
      "Definition",
      "References",
      "renameClass",
      "unsafeInline",
      "localRename",
    ]) {
      expect(screen.queryByRole("button", { name: new RegExp(`^${operation}$`, "iu") })).toBeNull();
    }
    expect(screen.queryByLabelText("Symbol selector")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    const lifecycle = screen.getByRole("group", {
      name: "Eclipse JDT LS lifecycle actions",
    });
    fireEvent.click(within(lifecycle).getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh RefactorKit availability" }));
    fireEvent.click(screen.getByRole("button", { name: "Request diagnostics" }));
    expect(callbacks.onStopJavaLanguageService).toHaveBeenCalledTimes(1);
    expect(callbacks.onRestartJavaLanguageService).toHaveBeenCalledTimes(1);
    expect(callbacks.onRefreshJavaLanguageService).toHaveBeenCalledTimes(1);
    expect(callbacks.onRefreshJavaRefactorKit).toHaveBeenCalledTimes(1);
    expect(callbacks.onRequestLanguageToolingDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("forwards and renders an unavailable browser RefactorKit discovery reason", () => {
    render(
      React.createElement(SettingsPanel, {
        javaRefactorKitCapabilities: BROWSER_LANGUAGE_KERNEL_CAPABILITIES,
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "LanguagesLanguage tooling" }));

    expect(
      screen.getByRole("status", {
        name: "RefactorKit language capability discovery status",
      }).textContent,
    ).toBe("Unavailable");
    expect(screen.getByText(BROWSER_LANGUAGE_KERNEL_REASON).textContent).toBe(
      BROWSER_LANGUAGE_KERNEL_REASON,
    );
    expect(
      screen.queryByRole("list", {
        name: "Daemon-advertised language adapters in canonical order",
      }),
    ).toBeNull();
  });

  it("navigates to enabled machine-level XCOM 2 settings with active download feedback", () => {
    render(
      React.createElement(SettingsPanel, {
        aiAgentSettings: settings,
        aiAgentStatus: status,
        xcom2SetupSnapshot: xcom2Snapshot,
      }),
    );

    const xcomTab = screen.getByRole("tab", { name: /XCOM 2/i }) as HTMLButtonElement;
    expect(xcomTab.disabled).toBe(false);
    expect(xcomTab.textContent).toContain("Global machine setup");
    fireEvent.click(xcomTab);

    expect(xcomTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/Manage global machine setup/)).toBeDefined();
    expect(
      screen.getByText(
        /Project tools will activate only for detected or configured XCOM modules \(future capability\)/,
      ),
    ).toBeDefined();
    expect(screen.getByRole("heading", { name: "XCOM 2 WOTC Setup" })).toBeDefined();
    expect(screen.getByRole("status", { name: "XCOM 2 lifecycle: Downloading" })).toBeDefined();
    expect(
      screen
        .getByRole("progressbar", { name: "XCOM 2 download progress" })
        .getAttribute("aria-valuenow"),
    ).toBe("50");
    expect(screen.getByText("Required Steam downloads are incomplete")).toBeDefined();
    expect(screen.getByLabelText("XCOM 2 setup monitor details").className).toContain(
      "overflow-auto",
    );
  });

  it("forwards XCOM 2 refresh and dry-run plan presentation callbacks", () => {
    const onRefreshXcom2Setup = vi.fn();
    const onPlanXcom2Setup = vi.fn();
    render(
      React.createElement(SettingsPanel, {
        xcom2SetupSnapshot: xcom2Snapshot,
        xcom2SetupPlan: xcom2Plan,
        onRefreshXcom2Setup,
        onPlanXcom2Setup,
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: /XCOM 2/i }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    fireEvent.click(screen.getByRole("button", { name: "Plan Setup" }));

    expect(onRefreshXcom2Setup).toHaveBeenCalledTimes(1);
    expect(onPlanXcom2Setup).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Operational setup plan" })).toBeDefined();
  });

  it("shows the honest unavailable state for browser-style XCOM 2 settings", () => {
    render(
      React.createElement(SettingsPanel, {
        isXcom2SetupLoading: false,
        xcom2SetupError: "XCOM 2 setup monitoring is available only in the desktop app.",
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: /XCOM 2/i }));

    expect(screen.getByRole("alert").textContent).toContain("available only in the desktop app");
    expect(screen.getByText("Setup state unavailable until Steam data is loaded.")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Refresh now" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Plan Setup" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("renders workspace metadata and refresh callback from supplied props", async () => {
    const onRefreshWorkspace = vi.fn().mockResolvedValue(undefined);

    render(
      React.createElement(SettingsPanel, {
        aiAgentSettings: settings,
        aiAgentStatus: status,
        workspaceInfo,
        workspaceRegistry,
        workspaceError: "Workspace registry unavailable.",
        onRefreshWorkspace,
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Workspace/i }));

    expect(screen.getByRole("tab", { name: /Workspace/i }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("Current workspace")).toBeDefined();
    expect(screen.getAllByText("Project Alpha").length).toBeGreaterThan(0);
    expect(screen.getByText("workspace-alpha")).toBeDefined();
    expect(screen.getAllByText("/work/project-alpha").length).toBeGreaterThan(0);
    expect(screen.getByText("2 known")).toBeDefined();
    expect(screen.getByText("Project Beta")).toBeDefined();
    expect(screen.getByText("/work/project-beta")).toBeDefined();
    expect(screen.getByText("Current")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("Workspace registry unavailable.");

    fireEvent.click(screen.getByRole("button", { name: /Refresh workspace/i }));

    await waitFor(() => expect(onRefreshWorkspace).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Workspace refreshed.")).toBeDefined();
  });

  it("places the complete configuration diagnostic directly below current workspace controls without mutating it", () => {
    const presentation = structuredClone(diagnosticPresentation);
    const before = structuredClone(presentation);

    render(
      React.createElement(SettingsPanel, {
        workspaceInfo,
        xcom2ModuleConfigurationDiagnosticPresentation: presentation,
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Workspace/i }));

    const heading = screen.getByRole("heading", { name: "Current workspace" });
    const controls = heading.closest("div.mb-5");
    const diagnosticContainer = controls?.nextElementSibling;
    expect(diagnosticContainer?.querySelector('[role="alert"]')).toBe(screen.getByRole("alert"));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: diagnosticPresentation.title })).toBeDefined();
    expect(
      Array.from(screen.getByRole("alert").querySelectorAll("dt"), (term) => term.textContent),
    ).toEqual(["Project file", "Summary", "Remediation", "Support identifier"]);
    expect(presentation).toEqual(before);
  });

  it("shows the exact neutral checking status in place of a supplied diagnostic", () => {
    const { rerender } = render(
      React.createElement(SettingsPanel, {
        workspaceInfo,
        xcom2ModuleConfigurationDiagnosticPresentation: diagnosticPresentation,
        isXcom2ModuleConfigurationChecking: true,
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Workspace/i }));

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Checking XCOM 2 project configuration…");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(diagnosticPresentation.title)).toBeNull();
    const controls = screen.getByRole("heading", { name: "Current workspace" }).closest("div.mb-5");
    expect(controls?.nextElementSibling).toBe(status);

    rerender(React.createElement(SettingsPanel, { workspaceInfo }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("switches a known workspace through the supplied callback", async () => {
    const onSwitchWorkspace = vi.fn().mockResolvedValue(undefined);

    render(
      React.createElement(SettingsPanel, {
        aiAgentSettings: settings,
        aiAgentStatus: status,
        workspaceInfo,
        workspaceRegistry,
        onSwitchWorkspace,
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Workspace/i }));

    expect(screen.getByText("Current")).toBeDefined();
    const switchButton = screen.getByRole("button", { name: /Switch/i });
    fireEvent.click(switchButton);

    await waitFor(() => expect(onSwitchWorkspace).toHaveBeenCalledWith("workspace-beta"));
    expect(await screen.findByText("Switched to Project Beta.")).toBeDefined();
  });

  it("disables workspace switch buttons while another settings action is pending", async () => {
    let resolveRefresh: (() => void) | undefined;
    const onRefreshWorkspace = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const onSwitchWorkspace = vi.fn().mockResolvedValue(undefined);

    render(
      React.createElement(SettingsPanel, {
        aiAgentSettings: settings,
        aiAgentStatus: status,
        workspaceInfo,
        workspaceRegistry,
        onRefreshWorkspace,
        onSwitchWorkspace,
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Workspace/i }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh workspace/i }));

    await waitFor(() => expect(onRefreshWorkspace).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: /Switch/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    resolveRefresh?.();
    await waitFor(() => expect(screen.getByText("Workspace refreshed.")).toBeDefined());
  });

  it("sends only the legacy RPC compatibility payload through the save callback", async () => {
    const onSaveAiAgentSettings = vi.fn().mockResolvedValue({
      ...settings,
      enabled: false,
      preferredIntegration: "rpc",
      fallbackIntegrations: [],
    });

    render(
      React.createElement(SettingsPanel, {
        aiAgentSettings: settings,
        aiAgentStatus: status,
        onSaveAiAgentSettings,
      }),
    );

    fireEvent.click(screen.getByLabelText("Enable legacy Pi Agent RPC compatibility"));
    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));

    await waitFor(() => {
      expect(onSaveAiAgentSettings).toHaveBeenCalledWith({
        enabled: false,
        provider: "pi",
        preferredIntegration: "rpc",
        fallbackIntegrations: [],
      });
    });

    const submittedSettings = onSaveAiAgentSettings.mock.calls[0][0];
    expect(submittedSettings.model).toBeUndefined();
    expect(submittedSettings.cliPath).toBeUndefined();
    expect(await screen.findByText("Pi Agent settings saved.")).toBeDefined();
  });

  it("updates status and enables installation only when status is not-installed", async () => {
    const onRefreshStatus = vi.fn().mockResolvedValue({
      ...status,
      available: false,
      availability: "not-installed",
      activeIntegration: undefined,
      version: undefined,
      lastError: undefined,
    });
    const onInstallPiAgent = vi.fn().mockResolvedValue({
      provider: "pi",
      success: true,
      outcome: "installed",
      integration: "rpc",
      version: "2.0.0",
      message: "Optional Pi Agent package installed.",
    });

    render(
      React.createElement(SettingsPanel, {
        aiAgentSettings: settings,
        aiAgentStatus: status,
        onRefreshStatus,
        onInstallPiAgent,
      }),
    );

    expect(
      (screen.getByRole("button", { name: /Pi Agent detected/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Refresh status/i }));
    await waitFor(() => expect(onRefreshStatus).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText("not-installed")).length).toBeGreaterThan(0);

    const installButton = screen.getByRole("button", {
      name: /Install Pi Agent/i,
    }) as HTMLButtonElement;
    expect(installButton.disabled).toBe(false);
    fireEvent.click(installButton);
    await waitFor(() => expect(onInstallPiAgent).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Optional Pi Agent package installed.")).toBeDefined();
  });

  it("disables installation when metadata reports a detected Pi integration", () => {
    render(
      React.createElement(SettingsPanel, {
        aiAgentSettings: settings,
        aiAgentStatus: {
          ...status,
          available: false,
          availability: "disabled",
          activeIntegration: undefined,
          version: undefined,
          metadata: {
            rpc: { available: true, version: "1.2.3" },
          },
        },
        onInstallPiAgent: vi.fn(),
      }),
    );

    expect(
      (screen.getByRole("button", { name: /Pi Agent detected/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
