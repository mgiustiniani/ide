import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { LanguageServiceState, LanguageServiceStatus } from "@ide/contracts";
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
});
