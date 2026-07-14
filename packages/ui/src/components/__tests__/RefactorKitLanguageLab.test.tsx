import React from "react";
import { render, screen, within } from "@testing-library/react";
import type { RefactorKitCapabilities } from "@ide/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefactorKitLanguageLab as PublicRefactorKitLanguageLab } from "../../index";
import { RefactorKitLanguageLab } from "../RefactorKitLanguageLab/RefactorKitLanguageLab";
import {
  BROWSER_LANGUAGE_KERNEL_CAPABILITIES,
  BROWSER_LANGUAGE_KERNEL_REASON,
  PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES,
} from "./refactorkitLanguageKernel.fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

function exactField(container: HTMLElement, label: string): string | null | undefined {
  return within(container).getByText(`${label}:`).parentElement?.textContent;
}

function advertisedAdapterArticles(): HTMLElement[] {
  const list = screen.getByRole("list", {
    name: "Daemon-advertised language adapters in canonical order",
  });
  return Array.from(list.children).map((item) =>
    within(item as HTMLElement).getByRole("article", {
      name: /Advertised language adapter/u,
    }),
  );
}

describe("RefactorKitLanguageLab", () => {
  it("is publicly exported and renders arbitrary adapters in transport-canonical order", () => {
    expect(PublicRefactorKitLanguageLab).toBe(RefactorKitLanguageLab);

    render(
      <PublicRefactorKitLanguageLab capabilities={PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES} />,
    );

    expect(
      screen.getByRole("status", { name: "RefactorKit language capability discovery status" })
        .textContent,
    ).toBe("Schema v1");

    const adapters = advertisedAdapterArticles();
    expect(adapters).toHaveLength(3);
    expect(adapters.map((adapter) => adapter.getAttribute("aria-label"))).toEqual([
      "Advertised language adapter 1: java",
      "Advertised language adapter 2: lua-embedded",
      "Advertised language adapter 3: typescript",
    ]);
    expect(adapters.map((adapter) => adapter.textContent)).toEqual([
      expect.stringContaining("1. java"),
      expect.stringContaining("2. lua-embedded"),
      expect.stringContaining("3. typescript"),
    ]);
    expect(adapters[1].textContent).toContain("extensions:[]");
    expect(adapters[1].textContent).toContain("No operations advertised.");

    const packaged = screen.getByRole("heading", {
      name: "Packaged / discovered capability",
    }).parentElement as HTMLElement;
    expect(packaged.textContent).toContain(
      "Exact validated daemon metadata in deterministic canonical order.",
    );
    expect(packaged.textContent).not.toMatch(/supplied order|provider order|original order/iu);
  });

  it("renders each operation's exact backend, runtime, and extensions accessibly", () => {
    render(<RefactorKitLanguageLab capabilities={PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES} />);

    const [java, , typescript] = advertisedAdapterArticles();
    const javaOperations = within(java).getByRole("region", {
      name: "java advertised operations",
    });
    const rename = within(javaOperations).getByRole("article", {
      name: "Operation 1: renameClass",
    });
    const refusal = within(javaOperations).getByRole("article", {
      name: "Operation 2: unsafeInline",
    });
    expect(exactField(rename, "operation")).toBe("operation:renameClass");
    expect(exactField(rename, "stability")).toBe("stability:stable");
    expect(exactField(rename, "evidence")).toBe("evidence:compiler");
    expect(exactField(rename, "mutationAuthority")).toBe("mutationAuthority:managed-stable");
    expect(exactField(rename, "backend")).toBe("backend:semantic-java-rename-v2");
    expect(exactField(rename, "extensions")).toBe("extensions:[java]");

    const renameRuntime = within(rename).getByRole("region", {
      name: "renameClass operation runtime metadata",
    });
    expect(exactField(renameRuntime, "executionMode")).toBe("executionMode:external-process");
    expect(exactField(renameRuntime, "supportsTimeout")).toBe("supportsTimeout:true");
    expect(exactField(renameRuntime, "supportsCancellation")).toBe("supportsCancellation:true");
    expect(exactField(renameRuntime, "usesWorkspaceOverlay")).toBe("usesWorkspaceOverlay:true");
    expect(exactField(renameRuntime, "recordsProcessProvenance")).toBe(
      "recordsProcessProvenance:true",
    );
    expect(exactField(renameRuntime, "requestTimeoutMillis")).toBe("requestTimeoutMillis:10000");
    expect(exactField(renameRuntime, "maxInputBytes")).toBe("maxInputBytes:2097152");
    expect(exactField(renameRuntime, "maxOutputBytes")).toBe("maxOutputBytes:4194304");
    expect(exactField(renameRuntime, "maxProcesses")).toBe("maxProcesses:1");

    expect(exactField(refusal, "operation")).toBe("operation:unsafeInline");
    expect(exactField(refusal, "stability")).toBe("stability:refused");
    expect(exactField(refusal, "evidence")).toBe("evidence:none");
    expect(exactField(refusal, "mutationAuthority")).toBe("mutationAuthority:none");
    expect(exactField(refusal, "backend")).toBe("backend:policy-refusal-v1");
    expect(exactField(refusal, "extensions")).toBe("extensions:[java]");
    const refusalRuntime = within(refusal).getByRole("region", {
      name: "unsafeInline operation runtime metadata",
    });
    expect(exactField(refusalRuntime, "executionMode")).toBe("executionMode:in-process");
    expect(exactField(refusalRuntime, "requestTimeoutMillis")).toBe("requestTimeoutMillis:null");

    const typeScriptOperations = within(typescript).getByRole("region", {
      name: "typescript advertised operations",
    });
    const proposal = within(typeScriptOperations).getByRole("article", {
      name: "Operation 1: localRename",
    });
    expect(exactField(proposal, "operation")).toBe("operation:localRename");
    expect(exactField(proposal, "stability")).toBe("stability:structural");
    expect(exactField(proposal, "evidence")).toBe("evidence:lexical");
    expect(exactField(proposal, "mutationAuthority")).toBe("mutationAuthority:proposal-only");
    expect(exactField(proposal, "backend")).toBe("backend:syntax-local-rename-v3");
    expect(exactField(proposal, "extensions")).toBe("extensions:[ts, tsx]");
    const proposalRuntime = within(proposal).getByRole("region", {
      name: "localRename operation runtime metadata",
    });
    expect(exactField(proposalRuntime, "executionMode")).toBe("executionMode:in-process");
    expect(exactField(proposalRuntime, "requestTimeoutMillis")).toBe("requestTimeoutMillis:1200");
  });

  it("renders every runtime field, nullable limit, and supplied daemon safety flag exactly", () => {
    render(<RefactorKitLanguageLab capabilities={PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES} />);

    const [java, empty, typescript] = advertisedAdapterArticles();
    const javaRuntime = within(java).getByRole("region", {
      name: "java adapter runtime metadata",
    });
    expect(exactField(javaRuntime, "executionMode")).toBe("executionMode:external-process");
    expect(exactField(javaRuntime, "supportsTimeout")).toBe("supportsTimeout:false");
    expect(exactField(javaRuntime, "supportsCancellation")).toBe("supportsCancellation:true");
    expect(exactField(javaRuntime, "usesWorkspaceOverlay")).toBe("usesWorkspaceOverlay:true");
    expect(exactField(javaRuntime, "recordsProcessProvenance")).toBe(
      "recordsProcessProvenance:true",
    );
    expect(exactField(javaRuntime, "requestTimeoutMillis")).toBe("requestTimeoutMillis:null");
    expect(exactField(javaRuntime, "maxInputBytes")).toBe("maxInputBytes:4194304");
    expect(exactField(javaRuntime, "maxOutputBytes")).toBe("maxOutputBytes:8388608");
    expect(exactField(javaRuntime, "maxProcesses")).toBe("maxProcesses:2");

    const typeScriptRuntime = within(typescript).getByRole("region", {
      name: "typescript adapter runtime metadata",
    });
    expect(exactField(typeScriptRuntime, "executionMode")).toBe("executionMode:in-process");
    expect(exactField(typeScriptRuntime, "supportsTimeout")).toBe("supportsTimeout:true");
    expect(exactField(typeScriptRuntime, "supportsCancellation")).toBe(
      "supportsCancellation:false",
    );
    expect(exactField(typeScriptRuntime, "usesWorkspaceOverlay")).toBe(
      "usesWorkspaceOverlay:false",
    );
    expect(exactField(typeScriptRuntime, "recordsProcessProvenance")).toBe(
      "recordsProcessProvenance:false",
    );
    expect(exactField(typeScriptRuntime, "requestTimeoutMillis")).toBe("requestTimeoutMillis:2500");
    expect(exactField(typeScriptRuntime, "maxInputBytes")).toBe("maxInputBytes:null");
    expect(exactField(typeScriptRuntime, "maxOutputBytes")).toBe("maxOutputBytes:null");
    expect(exactField(typeScriptRuntime, "maxProcesses")).toBe("maxProcesses:null");

    const emptyRuntime = within(empty).getByRole("region", {
      name: "lua-embedded adapter runtime metadata",
    });
    for (const limit of [
      "requestTimeoutMillis",
      "maxInputBytes",
      "maxOutputBytes",
      "maxProcesses",
    ]) {
      expect(exactField(emptyRuntime, limit)).toBe(`${limit}:null`);
    }

    const safety = screen.getByRole("region", {
      name: "Daemon-advertised RefactorKit safety flags",
    });
    expect(exactField(safety, "previewBeforeApply")).toBe("previewBeforeApply:false");
    expect(exactField(safety, "snapshotValidation")).toBe("snapshotValidation:true");
    expect(exactField(safety, "transactionRollback")).toBe("transactionRollback:false");
    expect(exactField(safety, "workspaceScopedWrites")).toBe("workspaceScopedWrites:true");
  });

  it("does not infer safety when global flags are absent", () => {
    render(
      <RefactorKitLanguageLab
        capabilities={{
          ...PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES,
          safety: undefined,
        }}
      />,
    );

    expect(
      screen.queryByRole("region", { name: "Daemon-advertised RefactorKit safety flags" }),
    ).toBeNull();
    expect(
      screen.getByText("Daemon safety flags were not supplied; no safety behavior is inferred."),
    ).toBeDefined();
  });

  it("separates discovery from schema-v1 readiness even when daemon and discovery succeed", () => {
    render(
      <RefactorKitLanguageLab
        capabilities={PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES}
        daemonStatus={{ available: true, version: "9.9.9", path: "/daemon/refactorkit" }}
      />,
    );

    const packaged = screen.getByRole("heading", {
      name: "Packaged / discovered capability",
    }).parentElement as HTMLElement;
    const readiness = screen.getByRole("heading", {
      name: "Current workspace / toolchain / session readiness",
    }).parentElement as HTMLElement;
    expect(packaged.textContent).toContain("not readiness in the current workspace");
    expect(readiness.textContent).toContain("Local daemon availability:Available");
    expect(readiness.textContent).toContain("Capability discovery:Successful");
    expect(readiness.textContent).toContain(
      "Operation backend, runtime configuration, extensions, versions, and successful discovery are metadata, not readiness signals.",
    );

    const readinessItems = Array.from(
      screen.getByRole("list", { name: "Per-adapter readiness reported by schema v1" }).children,
    ) as HTMLElement[];
    expect(readinessItems).toHaveLength(3);
    for (const [index, languageId] of ["java", "lua-embedded", "typescript"].entries()) {
      expect(readinessItems[index].textContent).toContain(`${index + 1}. ${languageId}`);
      expect(readinessItems[index].textContent?.match(/Unknown \/ not reported/gu)).toHaveLength(3);
      expect(readinessItems[index].textContent).not.toContain("Available");
      expect(readinessItems[index].textContent).not.toContain("Ready");
    }
  });

  it("renders the browser discovery refusal reason without inventing adapters or safety", () => {
    render(
      <RefactorKitLanguageLab
        capabilities={BROWSER_LANGUAGE_KERNEL_CAPABILITIES}
        daemonStatus={{ available: false }}
      />,
    );

    expect(
      screen.getByRole("status", { name: "RefactorKit language capability discovery status" })
        .textContent,
    ).toBe("Unavailable");
    expect(screen.getByText(BROWSER_LANGUAGE_KERNEL_REASON).textContent).toBe(
      BROWSER_LANGUAGE_KERNEL_REASON,
    );
    expect(
      screen.queryByRole("list", {
        name: "Daemon-advertised language adapters in canonical order",
      }),
    ).toBeNull();
    const readiness = screen.getByRole("heading", {
      name: "Current workspace / toolchain / session readiness",
    }).parentElement as HTMLElement;
    expect(exactField(readiness, "Local daemon availability")).toBe(
      "Local daemon availability:Unavailable",
    );
    expect(exactField(readiness, "Capability discovery")).toBe("Capability discovery:Unavailable");
    expect(screen.getByText(/no safety behavior is inferred/u)).toBeDefined();
  });

  it("provides generic refusal, empty-adapter, and proposal-only feedback without private content", () => {
    const sourceSentinel = "SOURCE_SENTINEL_DO_NOT_RENDER_OR_LOG";
    const diagnosticSentinel = "DIAGNOSTIC_SENTINEL_DO_NOT_RENDER_OR_LOG";
    const baseKernel = PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES.languageKernel;
    if (!baseKernel?.available) throw new Error("Expected an available test schema");

    const capabilitiesWithPrivateExtras = {
      ...PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES,
      source: sourceSentinel,
      diagnostics: [diagnosticSentinel],
      languageKernel: {
        ...baseKernel,
        schema: {
          ...baseKernel.schema,
          adapters: baseKernel.schema.adapters.map((adapter) => ({
            ...adapter,
            source: sourceSentinel,
            capabilities: adapter.capabilities.map((capability) => ({
              ...capability,
              diagnostic: diagnosticSentinel,
            })),
          })),
        },
      },
    } as RefactorKitCapabilities;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    render(<RefactorKitLanguageLab capabilities={capabilitiesWithPrivateExtras} />);

    expect(
      screen.getByText("Explicitly refused capabilities:").parentElement?.textContent,
    ).toContain("java:unsafeInline");
    expect(
      screen.getByText("Adapters with no advertised capabilities:").parentElement?.textContent,
    ).toContain("lua-embedded");
    const proposalFeedback = screen.getByText("Proposal-only mutation warning:")
      .parentElement as HTMLElement;
    expect(proposalFeedback.textContent).toContain("typescript:localRename");
    expect(proposalFeedback.textContent).toContain(
      "Proposal-only capability is not managed write authority.",
    );
    expect(document.body.textContent).not.toContain(sourceSentinel);
    expect(document.body.textContent).not.toContain(diagnosticSentinel);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("never turns advertised operation names into controls", () => {
    render(<RefactorKitLanguageLab capabilities={PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES} />);

    for (const operation of ["renameClass", "unsafeInline", "localRename"]) {
      expect(screen.getByText(operation)).toBeDefined();
      expect(screen.queryByRole("button", { name: new RegExp(operation, "iu") })).toBeNull();
    }
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/No language operation is exposed from this lab/u)).toBeDefined();
  });
});
