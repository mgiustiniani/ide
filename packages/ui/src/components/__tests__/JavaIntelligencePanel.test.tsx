import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  JavaNavigationResult,
  JavaCallHierarchyResponse,
  JavaDefinitionsResponse,
  JavaReferencesResponse,
  LanguageServiceState,
  LanguageServiceStatus,
} from "@ide/contracts";
import { describe, expect, it, vi } from "vitest";
import { JavaIntelligencePanel } from "../JavaIntelligencePanel/JavaIntelligencePanel";
import {
  BROWSER_LANGUAGE_KERNEL_CAPABILITIES,
  BROWSER_LANGUAGE_KERNEL_REASON,
  PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES,
} from "./refactorkitLanguageKernel.fixture";

const callbacks = () => ({
  symbol: "",
  onSymbolChange: vi.fn(),
  onRefresh: vi.fn(),
  onScan: vi.fn(),
  onDiagnostics: vi.fn(),
  onSymbols: vi.fn(),
  onDefinition: vi.fn(),
  onReferences: vi.fn(),
});

const languageStatus = (
  state: LanguageServiceState,
  overrides: Partial<LanguageServiceStatus> = {},
): LanguageServiceStatus => ({
  state,
  provider: "jdt-ls",
  providerVersion: "1.2.0",
  serverPath: "/tools/jdtls",
  serverVersion: "1.42.0",
  javaExecutable: "/jdk/bin/java",
  javaVersion: "21.0.4",
  workspaceId: "workspace-7",
  generation: 3,
  gradleImportEnabled: false,
  gradleSettingsConfigured: false,
  activeMavenProfiles: [],
  inactiveMavenProfiles: [],
  checkedAt: "2026-07-11T16:30:00.000Z",
  capabilities: {
    documentSync: false,
    diagnostics: false,
    completion: false,
    hover: false,
    signature: false,
    definition: false,
    references: false,
    symbols: false,
    documentSymbols: false,
    documentHighlights: false,
    workspaceSymbols: false,
    semanticTokens: false,
    codeActions: false,
    formatting: false,
    rename: false,
    hierarchy: false,
  },
  ...overrides,
});

describe("JavaIntelligencePanel", () => {
  it("renders available RefactorKit details and enables intelligence actions", () => {
    render(
      <JavaIntelligencePanel
        presentationMode="project"
        status={{ available: true, version: "1.4.2", path: "/tools/refactorkit" }}
        {...callbacks()}
      />,
    );

    expect(screen.getByRole("region", { name: "Java intelligence" })).toBeDefined();
    expect(
      screen.getByRole("status", { name: "RefactorKit availability status" }).textContent,
    ).toContain("Available");
    expect(screen.getByText("1.4.2")).toBeDefined();
    expect(screen.getByText("/tools/refactorkit")).toBeDefined();
    expect((screen.getByRole("button", { name: "Scan" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByText("Deterministic Java intelligence")).toBeDefined();
    expect(screen.getByText(/Scan the current workspace, inspect diagnostics/u)).toBeDefined();
  });

  it("focuses the Java workspace-symbol query when the host opens the search activity", () => {
    const { rerender } = render(
      <JavaIntelligencePanel presentationMode="project" focusWorkspaceSymbolSearch={0} />,
    );
    const query = screen.getByLabelText("Name or query");
    expect(document.activeElement).not.toBe(query);

    rerender(<JavaIntelligencePanel presentationMode="project" focusWorkspaceSymbolSearch={1} />);

    expect(document.activeElement).toBe(query);
  });

  it("embeds provider-neutral discovery without creating advertised operation controls", () => {
    render(
      <JavaIntelligencePanel
        presentationMode="settings"
        status={{ available: true, version: "0.6.0-SNAPSHOT", path: "/tools/refactorkit" }}
        capabilities={PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES}
      />,
    );

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
    for (const operation of ["renameClass", "unsafeInline", "localRename"]) {
      expect(screen.getByText(operation)).toBeDefined();
      expect(screen.queryByRole("button", { name: new RegExp(operation, "iu") })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Scan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Diagnostics" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Symbols" })).toBeNull();
  });

  it("presents all closed compiler-diagnostics states accessibly without duplicating Problems", () => {
    const onRequestLanguageToolingDiagnostics = vi.fn();
    const commonProps = {
      presentationMode: "settings" as const,
      status: { available: true },
      onRequestLanguageToolingDiagnostics,
    };
    const { rerender } = render(
      <JavaIntelligencePanel {...commonProps} languageToolingDiagnostics={{ state: "checking" }} />,
    );

    expect(
      screen.getByRole("status", { name: "Compiler diagnostics status: Checking" }).textContent,
    ).toContain("Checking compiler diagnostics for the current authorized source snapshot.");
    expect(
      (screen.getByRole("button", { name: "Checking diagnostics…" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    rerender(
      <JavaIntelligencePanel
        {...commonProps}
        languageToolingDiagnostics={{ state: "ready", diagnosticCount: 2 }}
      />,
    );
    expect(
      screen.getByRole("status", { name: "Compiler diagnostics status: Ready" }).textContent,
    ).toContain("2 compiler diagnostics are available in Problems and editor markers.");
    expect(screen.queryByRole("tree", { name: /Problems/u })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Request diagnostics" }));
    expect(onRequestLanguageToolingDiagnostics).toHaveBeenCalledTimes(1);

    const secretPath = "/home/alice/private/project/tsconfig.json";
    const secretHash = "a".repeat(64);
    rerender(
      <JavaIntelligencePanel
        {...commonProps}
        languageToolingDiagnostics={{
          state: "refused",
          message: `Authority refused ${secretPath} ${secretHash} ${"x".repeat(500)}`,
        }}
      />,
    );
    const refused = screen.getByRole("status", {
      name: "Compiler diagnostics status: Refused",
    });
    expect(refused.textContent).toContain("[redacted path]");
    expect(refused.textContent).toContain("[redacted identifier]");
    expect(refused.textContent).not.toContain(secretPath);
    expect(refused.textContent).not.toContain(secretHash);
    expect(refused.querySelector("p")?.textContent?.endsWith("…")).toBe(true);
    expect(refused.querySelector("p")?.textContent?.length).toBeLessThanOrEqual(270);

    const secretUrl = "https://provider.invalid/private?token=secret";
    rerender(
      <JavaIntelligencePanel
        {...commonProps}
        languageToolingDiagnostics={{
          state: "error",
          message: `Provider failed at ${secretUrl}\u0000`,
        }}
      />,
    );
    const error = screen.getByRole("alert", { name: "Compiler diagnostics status: Error" });
    expect(error.textContent).toContain("Diagnostics request failed.");
    expect(error.textContent).toContain("[redacted resource]");
    expect(error.textContent).not.toContain(secretUrl);
    expect(error.textContent).not.toContain("\u0000");
  });

  it("renders the explicit unavailable language-kernel reason", () => {
    render(
      <JavaIntelligencePanel
        capabilities={BROWSER_LANGUAGE_KERNEL_CAPABILITIES}
        {...callbacks()}
      />,
    );

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

  it("renders unavailable and error states and disables intelligence actions", () => {
    const { rerender } = render(
      <JavaIntelligencePanel status={{ available: false }} {...callbacks()} />,
    );

    expect(
      screen.getByRole("status", { name: "RefactorKit availability status" }).textContent,
    ).toContain("Unavailable");
    expect((screen.getByRole("button", { name: "Scan" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Diagnostics" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Symbols" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Refresh RefactorKit availability",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    rerender(
      <JavaIntelligencePanel
        status={{ available: false, lastError: "RefactorKit probe failed." }}
        {...callbacks()}
      />,
    );
    expect(
      screen.getByRole("status", { name: "RefactorKit availability status" }).textContent,
    ).toContain("Availability check failed");
    expect(screen.getByRole("alert").textContent).toBe("RefactorKit probe failed.");
  });

  it("invokes each action callback", () => {
    const actions = callbacks();
    render(<JavaIntelligencePanel status={{ available: true }} {...actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh RefactorKit availability" }));
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    fireEvent.click(screen.getByRole("button", { name: "Symbols" }));

    expect(actions.onRefresh).toHaveBeenCalledTimes(1);
    expect(actions.onScan).toHaveBeenCalledTimes(1);
    expect(actions.onDiagnostics).toHaveBeenCalledTimes(1);
    expect(actions.onSymbols).toHaveBeenCalledTimes(1);
  });

  it("keeps the symbol selector controlled and exposes accessible help", () => {
    const actions = callbacks();
    const { rerender } = render(
      <JavaIntelligencePanel status={{ available: true }} {...actions} />,
    );

    const input = screen.getByRole("textbox", { name: "Symbol selector" }) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-describedby")).toBe("java-symbol-selector-help");
    expect(screen.getByText(/fully qualified class or member/)).toBeDefined();

    fireEvent.change(input, { target: { value: "com.acme.Order" } });
    expect(actions.onSymbolChange).toHaveBeenCalledWith("com.acme.Order");
    expect(input.value).toBe("");

    rerender(
      <JavaIntelligencePanel status={{ available: true }} {...actions} symbol="com.acme.Order" />,
    );
    expect(input.value).toBe("com.acme.Order");
  });

  it("disables lookup actions when unavailable, running, or the trimmed selector is empty", () => {
    const actions = callbacks();
    const { rerender } = render(
      <JavaIntelligencePanel status={{ available: true }} {...actions} symbol="   " />,
    );

    const definition = screen.getByRole("button", { name: "Definition" }) as HTMLButtonElement;
    const references = screen.getByRole("button", { name: "References" }) as HTMLButtonElement;
    expect(definition.disabled).toBe(true);
    expect(references.disabled).toBe(true);

    rerender(
      <JavaIntelligencePanel status={{ available: false }} {...actions} symbol="com.acme.Order" />,
    );
    expect(definition.disabled).toBe(true);
    expect(references.disabled).toBe(true);

    rerender(
      <JavaIntelligencePanel
        status={{ available: true }}
        isRunning
        {...actions}
        symbol="com.acme.Order"
      />,
    );
    expect(definition.disabled).toBe(true);
    expect(references.disabled).toBe(true);
  });

  it("invokes definition and references with the trimmed symbol selector", () => {
    const actions = callbacks();
    render(
      <JavaIntelligencePanel
        status={{ available: true }}
        {...actions}
        symbol="  com.acme.Order#findById(java.lang.String)  "
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Definition" }));
    fireEvent.click(screen.getByRole("button", { name: "References" }));

    expect(actions.onDefinition).toHaveBeenCalledWith("com.acme.Order#findById(java.lang.String)");
    expect(actions.onReferences).toHaveBeenCalledWith("com.acme.Order#findById(java.lang.String)");
  });

  it("shows the running operation and disables every action", () => {
    render(
      <JavaIntelligencePanel
        status={{ available: true }}
        isRunning
        runningOperation="diagnostics"
        {...callbacks()}
      />,
    );

    expect(
      screen.getByRole("status", { name: "RefactorKit availability status" }).textContent,
    ).toContain("Diagnostics running");
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("renders complete result metadata and scrollable stdout and stderr", () => {
    render(
      <JavaIntelligencePanel
        status={{ available: true }}
        latestOperation="definition"
        result={{
          success: false,
          code: 2,
          timedOut: true,
          stdoutTruncated: true,
          stderrTruncated: false,
          stdout: "Scanning workspace…\n3 Java files",
          stderr: "Parser stopped after timeout",
          locations: [],
          command: ["refactorkit", "scan"],
        }}
        {...callbacks()}
      />,
    );

    expect(screen.getByText("Latest result · Definition")).toBeDefined();
    expect(screen.getByText("Failed")).toBeDefined();
    const details = screen.getByLabelText("Operation result details");
    expect(details.textContent).toContain("Success:No");
    expect(details.textContent).toContain("Exit code:2");
    expect(details.textContent).toContain("Timeout:Yes");
    expect(details.textContent).toContain("Truncated:Yes");
    const output = screen.getByLabelText("RefactorKit operation output");
    expect(output.className).toContain("overflow-auto");
    expect(output.getAttribute("tabindex")).toBe("0");
    expect(screen.getByText(/3 Java files/)).toBeDefined();
    expect(screen.getByText("Parser stopped after timeout")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("Parser stopped after timeout");
  });

  it("renders structured locations before raw output and navigates from accessible buttons", () => {
    const onNavigateLocation = vi.fn();
    const locations = [
      { path: "src/main/java/com/acme/Order.java", line: 12, column: 7 },
      { path: "src/test/java/com/acme/OrderTest.java", line: 4 },
    ];

    render(
      <JavaIntelligencePanel
        status={{ available: true }}
        result={{
          success: true,
          code: 0,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdout: "Raw RefactorKit output",
          stderr: "",
          locations,
          command: ["refactorkit", "references"],
        }}
        onNavigateLocation={onNavigateLocation}
        {...callbacks()}
      />,
    );

    const locationsHeading = screen.getByRole("heading", { name: "Locations" });
    const outputText = screen.getByText("Raw RefactorKit output");
    expect(
      locationsHeading.compareDocumentPosition(outputText) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    const withColumn = screen.getByRole("button", {
      name: "src/main/java/com/acme/Order.java:12:7",
    });
    expect(
      screen.getByRole("button", {
        name: "src/test/java/com/acme/OrderTest.java:4",
      }),
    ).toBeDefined();

    fireEvent.click(withColumn);
    expect(onNavigateLocation).toHaveBeenCalledWith(locations[0]);
  });

  it("renders locations as non-action text when navigation is unavailable", () => {
    render(
      <JavaIntelligencePanel
        status={{ available: true }}
        result={{
          success: true,
          code: 0,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdout: "",
          stderr: "",
          locations: [{ path: "Main.java", line: 1 }],
          command: ["refactorkit", "definition"],
        }}
        {...callbacks()}
      />,
    );

    expect(screen.getByText("Main.java:1").tagName).toBe("SPAN");
    expect(screen.queryByRole("button", { name: "Main.java:1" })).toBeNull();
  });

  it("honestly presents unavailable external JDT LS setup only when the host supplies it", () => {
    const onSetup = vi.fn();
    const { rerender } = render(
      <JavaIntelligencePanel {...callbacks()} onSetupLanguageService={onSetup} />,
    );

    expect(
      screen.getByRole("heading", { name: "Java Language Service · Eclipse JDT LS" }),
    ).toBeDefined();
    expect(screen.getByText("Java-specific managed lifecycle and setup")).toBeDefined();
    expect(
      screen.queryByText(/Managed interactive semantics|Interactive semantics foundation/u),
    ).toBeNull();
    expect(screen.getByText(/external download-on-demand tooling/u)).toBeDefined();
    expect(screen.getByText(/not bundled with the IDE/u)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Install / Setup Eclipse JDT LS" }));
    expect(onSetup).toHaveBeenCalledTimes(1);

    rerender(<JavaIntelligencePanel {...callbacks()} />);
    expect(screen.queryByRole("button", { name: "Install / Setup Eclipse JDT LS" })).toBeNull();
  });

  it.each([
    ["unavailable", false, false, false, true],
    ["stopped", true, false, false, true],
    ["starting", false, true, false, false],
    ["ready", false, true, true, true],
    ["degraded", false, true, true, true],
    ["failed", true, false, true, true],
  ] as const)(
    "renders %s lifecycle state with correct action availability",
    (state, start, stop, restart, refresh) => {
      const actions = {
        onStartLanguageService: vi.fn(),
        onStopLanguageService: vi.fn(),
        onRestartLanguageService: vi.fn(),
        onRefreshLanguageService: vi.fn(),
      };
      render(
        <JavaIntelligencePanel
          {...callbacks()}
          languageServiceStatus={languageStatus(state)}
          {...actions}
        />,
      );

      expect(
        screen.getByRole("status", { name: "Eclipse JDT LS lifecycle status" }).textContent,
      ).toContain(state);
      const group = within(screen.getByRole("group", { name: "Eclipse JDT LS lifecycle actions" }));
      expect((group.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(
        !start,
      );
      expect((group.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(
        !stop,
      );
      expect((group.getByRole("button", { name: "Restart" }) as HTMLButtonElement).disabled).toBe(
        !restart,
      );
      expect((group.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(
        !refresh,
      );
    },
  );

  it("reports provider details, progress, errors, checked time, and only true capabilities", () => {
    render(
      <JavaIntelligencePanel
        {...callbacks()}
        languageServiceStatus={languageStatus("degraded", {
          progress: { indexing: true, percentage: 64, message: "Resolving workspace symbols" },
          lastError: "Classpath is incomplete",
          capabilities: {
            ...languageStatus("ready").capabilities,
            documentSync: true,
            diagnostics: true,
            hover: true,
          },
        })}
      />,
    );

    expect(screen.getByText("jdt-ls 1.2.0")).toBeDefined();
    expect(screen.getByText("/tools/jdtls")).toBeDefined();
    expect(screen.getByText("/jdk/bin/java")).toBeDefined();
    expect(screen.getByText("workspace-7")).toBeDefined();
    expect(screen.getByText("2026-07-11T16:30:00.000Z")).toBeDefined();
    expect(screen.getByText(/Indexing · 64%/).textContent).toContain("Resolving workspace symbols");
    expect(screen.getByRole("alert").textContent).toContain("Classpath is incomplete");
    expect(
      screen.getByText("Backend-reported capability flags; IDE integration is not implied."),
    ).toBeDefined();
    const capabilities = screen.getByLabelText(
      "Backend-reported language service capability flags",
    );
    expect(capabilities.textContent).toBe("Document syncDiagnosticsHover");
    expect(capabilities.textContent).not.toContain("Completion");
    expect(screen.queryByText(/Interactive semantics inactive/)).toBeNull();
  });

  it("explicitly reports unavailable document sync and invokes lifecycle callbacks", () => {
    const actions = {
      onStartLanguageService: vi.fn(),
      onStopLanguageService: vi.fn(),
      onRestartLanguageService: vi.fn(),
      onRefreshLanguageService: vi.fn(),
    };
    const { rerender } = render(
      <JavaIntelligencePanel
        {...callbacks()}
        languageServiceStatus={languageStatus("stopped")}
        {...actions}
      />,
    );
    const limitation = screen.getByText(
      (_, element) =>
        element?.getAttribute("role") === "note" &&
        element.textContent?.includes(
          "Interactive semantics inactive: document sync is unavailable.",
        ) === true,
    );
    expect(limitation.textContent).toContain(
      "Interactive semantics inactive: document sync is unavailable.",
    );
    expect(limitation.textContent).toContain(
      "Editor document sync and semantic request integration are required before these features activate.",
    );
    expect(
      screen.getByLabelText("Backend-reported language service capability flags").textContent,
    ).toBe("No backend capability flags reported");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(actions.onStartLanguageService).toHaveBeenCalledTimes(1);

    rerender(
      <JavaIntelligencePanel
        {...callbacks()}
        languageServiceStatus={languageStatus("ready")}
        {...actions}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    const lifecycle = within(
      screen.getByRole("group", { name: "Eclipse JDT LS lifecycle actions" }),
    );
    fireEvent.click(lifecycle.getByRole("button", { name: "Refresh" }));
    expect(actions.onStopLanguageService).toHaveBeenCalledTimes(1);
    expect(actions.onRestartLanguageService).toHaveBeenCalledTimes(1);
    expect(actions.onRefreshLanguageService).toHaveBeenCalledTimes(1);
  });

  it("shows only global tooling status and lifecycle actions in settings mode", () => {
    const onRefresh = vi.fn();
    render(
      <JavaIntelligencePanel
        presentationMode="settings"
        languageServiceStatus={languageStatus("ready")}
        status={{ available: true, version: "2.1.0", path: "/tools/refactorkit" }}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByRole("region", { name: "Language tooling" })).toBeDefined();
    expect(screen.getByText(/provider-neutral RefactorKit language discovery/u)).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Java Language Service · Eclipse JDT LS" }),
    ).toBeDefined();
    expect(screen.getByText("2.1.0")).toBeDefined();
    expect(screen.getByText("/tools/refactorkit")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Scan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Diagnostics" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Symbols" })).toBeNull();
    expect(screen.queryByLabelText("Symbol selector")).toBeNull();
    expect(screen.queryByText("Latest result")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh RefactorKit availability" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("saves a global JDT LS runtime JDK only in settings mode", () => {
    const onSaveServerJdkHomePreference = vi.fn(() => true);
    const { rerender } = render(
      <JavaIntelligencePanel
        {...callbacks()}
        presentationMode="settings"
        serverJdkHomePreference="/jdk-21"
        onSaveServerJdkHomePreference={onSaveServerJdkHomePreference}
      />,
    );

    const input = screen.getByRole("textbox", { name: "JDK home directory" });
    fireEvent.change(input, { target: { value: "/jdk-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save runtime JDK" }));
    expect(onSaveServerJdkHomePreference).toHaveBeenCalledWith("/jdk-25");
    expect(screen.getByText("Runtime JDK preference saved.")).toBeDefined();

    rerender(
      <JavaIntelligencePanel
        {...callbacks()}
        serverJdkHomePreference="/jdk-25"
        onSaveServerJdkHomePreference={onSaveServerJdkHomePreference}
      />,
    );
    expect(screen.queryByRole("textbox", { name: "JDK home directory" })).toBeNull();
  });

  it("searches workspace symbols through the host and opens a selected Java declaration", async () => {
    const onSearchWorkspaceSymbols = vi.fn(async (query: string) => ({
      ok: true as const,
      requestId: "workspace-symbol-request",
      result: {
        workspaceId: "workspace-7",
        generation: 3,
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        symbols: [
          {
            name: "OrderService",
            kind: "class" as const,
            path: "src/main/java/example/OrderService.java",
            range: {
              start: { line: 4, character: 13 },
              end: { line: 4, character: 25 },
            },
            containerName: "example",
          },
        ],
        isTruncated: query === "Order",
      },
    }));
    const onNavigateWorkspaceSymbol = vi.fn();
    const onCancelWorkspaceSymbolSearch = vi.fn();
    render(
      <JavaIntelligencePanel
        presentationMode="project"
        languageServiceStatus={languageStatus("ready", {
          capabilities: { ...languageStatus("ready").capabilities, workspaceSymbols: true },
        })}
        onSearchWorkspaceSymbols={onSearchWorkspaceSymbols}
        onNavigateWorkspaceSymbol={onNavigateWorkspaceSymbol}
        onCancelWorkspaceSymbolSearch={onCancelWorkspaceSymbolSearch}
        {...callbacks()}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Name or query" }), {
      target: { value: "  OrderService  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const result = await screen.findByRole("button", {
      name: /Open class OrderService in src\/main\/java\/example\/OrderService.java at line 5/u,
    });
    expect(onSearchWorkspaceSymbols).toHaveBeenCalledWith("OrderService");
    fireEvent.click(result);
    expect(onNavigateWorkspaceSymbol).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "OrderService",
        path: "src/main/java/example/OrderService.java",
      }),
    );
    expect(onCancelWorkspaceSymbolSearch).not.toHaveBeenCalled();
  });

  it("keeps workspace-symbol search unavailable until JDT LS confirms the capability", () => {
    render(
      <JavaIntelligencePanel
        presentationMode="project"
        languageServiceStatus={languageStatus("ready")}
        onSearchWorkspaceSymbols={vi.fn()}
        {...callbacks()}
      />,
    );
    expect((screen.getByRole("button", { name: "Search" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Type definition" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("runs advertised call hierarchy queries and opens a selected call site", async () => {
    const callSite = {
      path: "src/main/java/example/Main.java",
      range: { start: { line: 8, character: 17 }, end: { line: 8, character: 20 } },
    };
    const result: Extract<JavaNavigationResult, { status: "ready" }> = {
      workspaceId: "workspace-7",
      generation: 3,
      requestId: "call-hierarchy-1",
      kind: "callHierarchy",
      documentPath: "src/main/java/example/Main.java",
      documentVersion: 12,
      status: "ready",
      locations: [
        {
          path: "src/main/java/example/OrderService.java",
          range: { start: { line: 14, character: 18 }, end: { line: 14, character: 25 } },
        },
        callSite,
      ],
      items: [
        {
          label: "example.OrderService#load()",
          location: {
            path: "src/main/java/example/OrderService.java",
            range: { start: { line: 14, character: 18 }, end: { line: 14, character: 25 } },
          },
          callSites: [callSite],
        },
      ],
      returned: 1,
      total: 1,
      truncated: false,
      complete: false,
      warningCount: 1,
      direction: "incoming",
      rootName: "example.OrderService#find()",
      scope: "workspace-direct-invocations",
      sourceFiles: [
        { path: "src/main/java/example/OrderService.java", text: "class OrderService {}" },
        { path: "src/main/java/example/Main.java", text: "class Main {}" },
      ],
      snapshotHash: "a".repeat(64),
      sourceHash: "b".repeat(64),
      indexGeneration: 3,
      provider: {
        name: "RefactorKit",
        version: "0.8.0",
        backend: "eclipse-jdt-3.44-bindings-v1",
        evidence: "compiler",
      },
    };
    const onQueryJavaPosition = vi.fn(async () => result);
    const onNavigateJavaPosition = vi.fn();
    render(
      <JavaIntelligencePanel
        presentationMode="project"
        status={{ available: false }}
        javaPositionCapabilities={{
          typeDefinition: true,
          typeHierarchy: true,
          callHierarchy: true,
          implementations: true,
        }}
        isJavaPositionAvailable
        onQueryJavaPosition={onQueryJavaPosition}
        onNavigateJavaPosition={onNavigateJavaPosition}
        {...callbacks()}
      />,
    );

    expect((screen.getByRole("button", { name: "Scan" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Callers" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Callers" }));
    expect(onQueryJavaPosition).toHaveBeenCalledWith("callHierarchy", "incoming");
    expect(await screen.findByText(/Type results cover workspace source/u)).toBeDefined();
    expect(
      await screen.findByText(/Call hierarchy covers direct invocations and remains partial/u),
    ).toBeDefined();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Open call site for example.OrderService#load\(\) in src\/main\/java\/example\/Main.java at line 9/u,
      }),
    );
    expect(onNavigateJavaPosition).toHaveBeenCalledWith("call-hierarchy-1", callSite);
  });

  it("renders a classpath method identity without offering fake source navigation", async () => {
    const callSite = {
      path: "src/main/java/app/Caller.java",
      range: { start: { line: 6, character: 11 }, end: { line: 6, character: 15 } },
    };
    const methodIdentity = {
      schemaVersion: "java-method-binding-identity-v1" as const,
      name: "pick",
      qualifiedName: "dependency.Overloads#pick(int)",
      bindingKey: "<sanitized-binding-key>",
      jvmIdentity: {
        kind: "callable" as const,
        ownerBinaryName: "dependency.Overloads",
        memberName: "pick",
        descriptor: "(I)Ljava/lang/String;",
      },
    };
    const result: Extract<JavaNavigationResult, { status: "ready" }> = {
      workspaceId: "workspace-7",
      generation: 3,
      requestId: "binary-call-hierarchy-1",
      kind: "callHierarchy",
      documentPath: "src/main/java/app/Caller.java",
      documentVersion: 12,
      status: "ready",
      locations: [callSite],
      items: [
        {
          label: methodIdentity.qualifiedName,
          methodIdentity,
          sourceNavigation: {
            status: "unavailable",
            reason: "classpathSourceUnavailable",
            location: null,
          },
          callSites: [callSite],
        },
      ],
      returned: 1,
      total: 1,
      truncated: false,
      complete: false,
      warningCount: 2,
      direction: "outgoing",
      rootName: "app.Caller#invoke(java.lang.String)",
      scope: "workspace-direct-invocations",
      targetScope: "workspace-source+resolved-classpath",
      sourceFiles: [{ path: callSite.path, text: "class Caller {}" }],
      snapshotHash: "a".repeat(64),
      sourceHash: "b".repeat(64),
      indexGeneration: 3,
      provider: {
        name: "RefactorKit",
        version: "0.7.0",
        backend: "eclipse-jdt-3.44-bindings-v1",
        evidence: "compiler",
      },
    };
    const onQueryJavaPosition = vi.fn(async () => result);
    const onNavigateJavaPosition = vi.fn();
    render(
      <JavaIntelligencePanel
        presentationMode="project"
        status={{ available: false }}
        javaPositionCapabilities={{
          typeDefinition: true,
          typeHierarchy: true,
          callHierarchy: true,
          implementations: true,
        }}
        isJavaPositionAvailable
        onQueryJavaPosition={onQueryJavaPosition}
        onNavigateJavaPosition={onNavigateJavaPosition}
        {...callbacks()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Calls made" }));
    const binaryTarget = await screen.findByText(/dependency\.Overloads#pick\(int\)/u);
    expect(binaryTarget.closest("button")).toBeNull();
    expect(screen.getByText(/source unavailable/u)).toBeDefined();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Open call site for dependency\.Overloads#pick\(int\) in src\/main\/java\/app\/Caller.java at line 7/u,
      }),
    );
    expect(onNavigateJavaPosition).toHaveBeenCalledWith("binary-call-hierarchy-1", callSite);
  });

  it("keeps RefactorKit implementations separate and navigable from JDT LS actions", async () => {
    const location = {
      path: "src/main/java/example/FileHandler.java",
      range: { start: { line: 4, character: 13 }, end: { line: 4, character: 24 } },
    };
    const result: Extract<JavaNavigationResult, { status: "ready" }> = {
      workspaceId: "workspace-7",
      generation: 3,
      requestId: "implementations-1",
      kind: "implementations",
      documentPath: "src/main/java/example/Handler.java",
      documentVersion: 12,
      status: "ready",
      locations: [location],
      items: [{ label: "example.FileHandler", relation: "concreteType", location }],
      returned: 1,
      total: 1,
      truncated: false,
      complete: true,
      warningCount: 0,
      rootName: "example.Handler",
      targetKind: "type",
      scope: "workspace-source",
      sourceFiles: [{ path: location.path, text: "class FileHandler {}" }],
      snapshotHash: "a".repeat(64),
      sourceHash: "b".repeat(64),
      indexGeneration: 3,
      provider: {
        name: "RefactorKit",
        version: "0.8.0",
        backend: "eclipse-jdt-3.44-bindings-v1",
        evidence: "compiler",
      },
    };
    const onQueryJavaPosition = vi.fn(async () => result);
    const onNavigateJavaPosition = vi.fn();
    render(
      <JavaIntelligencePanel
        presentationMode="project"
        status={{ available: false }}
        javaPositionCapabilities={{
          typeDefinition: true,
          typeHierarchy: true,
          callHierarchy: true,
          implementations: true,
        }}
        isJavaPositionAvailable
        onQueryJavaPosition={onQueryJavaPosition}
        onNavigateJavaPosition={onNavigateJavaPosition}
        {...callbacks()}
      />,
    );

    expect(screen.getByText(/JDT LS Go to Implementation remains available/u)).toBeDefined();
    const button = screen.getByRole("button", { name: "Implementations (RefactorKit)" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onQueryJavaPosition).toHaveBeenCalledWith("implementations", undefined);
    const target = await screen.findByRole("button", {
      name: /Concrete type: example.FileHandler/u,
    });
    fireEvent.click(target);
    expect(onNavigateJavaPosition).toHaveBeenCalledWith("implementations-1", location);
  });

  it("uses the advertised JDT LS call hierarchy for the synchronized Java buffer", async () => {
    const method = {
      path: "src/main/java/example/Consumer.java",
      range: { start: { line: 12, character: 4 }, end: { line: 12, character: 8 } },
    };
    const callSite = {
      path: "src/main/java/example/Consumer.java",
      range: { start: { line: 12, character: 17 }, end: { line: 12, character: 29 } },
    };
    const response: JavaCallHierarchyResponse = {
      ok: true,
      requestId: "jdtls-call-hierarchy-1",
      result: {
        provider: "jdt-ls",
        providerVersion: "1.62.0",
        workspaceId: "workspace-7",
        generation: 3,
        document: {
          path: "src/main/java/example/Service.java",
          uri: "file:///workspace/src/main/java/example/Service.java",
          version: 12,
        },
        direction: "incoming",
        entries: [
          {
            name: "Consumer.run",
            kind: "method",
            detail: "void run()",
            location: method,
            callSites: [callSite],
          },
        ],
        isTruncated: false,
      },
    };
    const onQueryJavaCallHierarchy = vi.fn(async () => response);
    const onNavigateJavaCallHierarchy = vi.fn();
    render(
      <JavaIntelligencePanel
        presentationMode="project"
        status={{ available: false }}
        languageServiceStatus={languageStatus("ready", {
          capabilities: { ...languageStatus("ready").capabilities, callHierarchy: true },
        })}
        isJavaPositionAvailable
        onQueryJavaCallHierarchy={onQueryJavaCallHierarchy}
        onNavigateJavaCallHierarchy={onNavigateJavaCallHierarchy}
        {...callbacks()}
      />,
    );

    const callers = screen.getByRole("button", { name: "JDT LS callers" });
    expect((callers as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(callers);
    expect(onQueryJavaCallHierarchy).toHaveBeenCalledWith("incoming");
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Open JDT LS call site in src\/main\/java\/example\/Consumer.java at line 13/u,
      }),
    );
    expect(onNavigateJavaCallHierarchy).toHaveBeenCalledWith(callSite);
  });

  it("queries advertised JDT LS definitions and opens a selected workspace declaration", async () => {
    const location = {
      path: "src/main/java/example/Service.java",
      range: { start: { line: 8, character: 13 }, end: { line: 8, character: 25 } },
    };
    const response: JavaDefinitionsResponse = {
      ok: true,
      requestId: "jdtls-definitions-1",
      result: {
        provider: "jdt-ls",
        providerVersion: "1.62.0",
        workspaceId: "workspace-7",
        generation: 3,
        document: {
          path: "src/main/java/example/Consumer.java",
          uri: "file:///workspace/src/main/java/example/Consumer.java",
          version: 12,
        },
        locations: [location],
        isTruncated: false,
      },
    };
    const onQueryJavaDefinitions = vi.fn(async () => response);
    const onNavigateJavaDefinition = vi.fn();
    const { rerender } = render(
      <JavaIntelligencePanel
        presentationMode="project"
        status={{ available: false }}
        languageServiceStatus={languageStatus("ready")}
        isJavaPositionAvailable
        onQueryJavaDefinitions={onQueryJavaDefinitions}
        onNavigateJavaDefinition={onNavigateJavaDefinition}
        {...callbacks()}
      />,
    );
    const definitions = screen.getByRole("button", { name: "JDT LS definition" });
    expect((definitions as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "JDT LS type definition" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <JavaIntelligencePanel
        presentationMode="project"
        status={{ available: false }}
        languageServiceStatus={languageStatus("ready", {
          capabilities: { ...languageStatus("ready").capabilities, definition: true, typeDefinition: true },
        })}
        isJavaPositionAvailable
        onQueryJavaDefinitions={onQueryJavaDefinitions}
        onNavigateJavaDefinition={onNavigateJavaDefinition}
        {...callbacks()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "JDT LS definition" }));
    expect(onQueryJavaDefinitions).toHaveBeenCalledOnce();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Open JDT LS definition in src\/main\/java\/example\/Service\.java at line 9/u,
      }),
    );
    expect(onNavigateJavaDefinition).toHaveBeenCalledWith(location);
    fireEvent.click(screen.getByRole("button", { name: "JDT LS type definition" }));
    expect(onQueryJavaDefinitions).toHaveBeenLastCalledWith("typeDefinition");
    const typeLocation = await screen.findByRole("button", {
      name: /Open JDT LS type definition in src\/main\/java\/example\/Service\.java at line 9/u,
    });
    expect(typeLocation).toBeTruthy();
    rerender(
      <JavaIntelligencePanel
        presentationMode="project"
        status={{ available: false }}
        languageServiceStatus={languageStatus("ready", {
          capabilities: { ...languageStatus("ready").capabilities, typeDefinition: true },
        })}
        isJavaPositionAvailable
        javaDefinitionScope="cursor moved"
        onQueryJavaDefinitions={onQueryJavaDefinitions}
        onNavigateJavaDefinition={onNavigateJavaDefinition}
        {...callbacks()}
      />,
    );
    expect(typeLocation.isConnected).toBe(false);
  });

  it("shows bounded JDT LS reference results and opens a selected workspace location", async () => {
    const location = {
      path: "src/main/java/example/Consumer.java",
      range: { start: { line: 12, character: 17 }, end: { line: 12, character: 29 } },
    };
    const response: JavaReferencesResponse = {
      ok: true,
      requestId: "references-1",
      result: {
        provider: "jdt-ls",
        providerVersion: "1.62.0",
        workspaceId: "workspace-7",
        generation: 3,
        document: {
          path: "src/main/java/example/Service.java",
          uri: "file:///workspace/src/main/java/example/Service.java",
          version: 5,
        },
        locations: [location],
        isTruncated: true,
      },
    };
    const onQueryJavaReferences = vi.fn(async () => response);
    const onNavigateJavaReference = vi.fn();
    render(
      <JavaIntelligencePanel
        presentationMode="project"
        status={{ available: false }}
        languageServiceStatus={languageStatus("ready", {
          capabilities: {
            documentSync: true,
            diagnostics: true,
            completion: true,
            hover: true,
            signature: true,
            definition: true,
            references: true,
            symbols: true,
            documentSymbols: true,
            documentHighlights: true,
            workspaceSymbols: true,
            semanticTokens: true,
            codeActions: true,
            formatting: true,
            rename: true,
            hierarchy: false,
          },
        })}
        isJavaPositionAvailable={false}
        isJavaLanguageServicePositionAvailable
        onQueryJavaReferences={onQueryJavaReferences}
        onNavigateJavaReference={onNavigateJavaReference}
        {...callbacks()}
      />,
    );

    const findButton = screen.getByRole("button", { name: "Find references with JDT LS" });
    expect((findButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(findButton);
    expect(onQueryJavaReferences).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("1 reference from JDT LS · more results omitted")).toBeDefined();
    expect(await screen.findByText(/This result is partial/u)).toBeDefined();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open Java reference in src/main/java/example/Consumer.java at line 13",
      }),
    );
    expect(onNavigateJavaReference).toHaveBeenCalledWith(location);
  });

  it("runs JDT LS references automatically when requested by the editor", async () => {
    const response: JavaReferencesResponse = {
      ok: true,
      requestId: "references-from-editor",
      result: {
        provider: "jdt-ls",
        providerVersion: "1.62.0",
        workspaceId: "workspace-7",
        generation: 3,
        document: {
          path: "src/main/java/example/Service.java",
          uri: "file:///workspace/src/main/java/example/Service.java",
          version: 5,
        },
        locations: [],
        isTruncated: false,
      },
    };
    const onQueryJavaReferences = vi.fn(async () => response);
    render(
      <JavaIntelligencePanel
        presentationMode="project"
        focusJavaReferencesQuery={1}
        status={{ available: false }}
        languageServiceStatus={languageStatus("ready", {
          capabilities: {
            documentSync: true,
            diagnostics: true,
            completion: true,
            hover: true,
            signature: true,
            definition: true,
            references: true,
            symbols: true,
            documentSymbols: true,
            documentHighlights: true,
            workspaceSymbols: true,
            semanticTokens: true,
            codeActions: true,
            formatting: true,
            rename: true,
            hierarchy: false,
          },
        })}
        isJavaPositionAvailable
        onQueryJavaReferences={onQueryJavaReferences}
        {...callbacks()}
      />,
    );

    expect(await screen.findByText("No workspace references were found.")).toBeDefined();
    expect(onQueryJavaReferences).toHaveBeenCalledTimes(1);
  });
});

const retainedHierarchy: Extract<JavaNavigationResult, { status: "ready" }> = {
  workspaceId: "workspace-7",
  generation: 3,
  requestId: "retained-hierarchy",
  kind: "callHierarchy",
  documentPath: "Main.java",
  documentVersion: 1,
  status: "ready",
  locations: [],
  items: [{ label: "external.Library#sum(int)", callSites: [] }],
  returned: 1,
  total: 1,
  truncated: false,
  complete: false,
  warningCount: 1,
  direction: "outgoing",
  rootName: "run",
  scope: "workspace-direct-invocations",
  sourceFiles: [],
  snapshotHash: "a".repeat(64),
  sourceHash: "b".repeat(64),
  indexGeneration: 1,
  provider: {
    name: "RefactorKit",
    version: "0.7.0",
    backend: "eclipse-jdt-3.44-bindings-v1",
    evidence: "compiler",
  },
};

function pendingHierarchy() {
  let resolve!: (result: JavaNavigationResult) => void;
  const promise = new Promise<JavaNavigationResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("retains an independent RefactorKit query when JDT LS cancellation callbacks change", async () => {
  const pending = pendingHierarchy();
  const props = {
    ...callbacks(),
    presentationMode: "project" as const,
    isJavaPositionAvailable: true,
    positionNavigationScope: "workspace-7:3:Main.java",
    javaPositionCapabilities: {
      typeDefinition: true,
      typeHierarchy: true,
      callHierarchy: true,
      implementations: true,
    },
    onQueryJavaPosition: vi.fn(() => pending.promise),
  };
  const cancel = vi.fn();
  const { rerender } = render(
    <JavaIntelligencePanel {...props} onCancelJavaDefinitions={cancel} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Calls made" }));
  rerender(<JavaIntelligencePanel {...props} onCancelJavaDefinitions={vi.fn()} />);
  expect(cancel).toHaveBeenCalledOnce();
  await act(async () => {
    pending.resolve(retainedHierarchy);
  });
  expect(screen.getByRole("list", { name: "Java hierarchy results" }).textContent).toContain(
    "external.Library#sum(int)",
  );
  expect(screen.queryByText("Resolving Java navigation…")).toBeNull();
  expect((screen.getByRole("button", { name: "Calls made" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it("retires a pending RefactorKit query on source scope change and admits the next query", async () => {
  const pending = pendingHierarchy();
  const query = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(retainedHierarchy);
  const props = {
    ...callbacks(),
    presentationMode: "project" as const,
    isJavaPositionAvailable: true,
    onQueryJavaPosition: query,
    javaPositionCapabilities: {
      typeDefinition: true,
      typeHierarchy: true,
      callHierarchy: true,
      implementations: true,
    },
  };
  const { rerender } = render(
    <JavaIntelligencePanel {...props} positionNavigationScope="workspace-7:3:Main.java" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Calls made" }));
  rerender(<JavaIntelligencePanel {...props} positionNavigationScope="workspace-7:4:Main.java" />);
  expect(screen.queryByText("Resolving Java navigation…")).toBeNull();
  await act(async () => {
    pending.resolve(retainedHierarchy);
  });
  expect(screen.queryByRole("list", { name: "Java hierarchy results" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Calls made" }));
  expect(await screen.findByRole("list", { name: "Java hierarchy results" })).toBeDefined();
  expect(query).toHaveBeenCalledTimes(2);
});
