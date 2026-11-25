import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserLanguageSessionAdapter,
  BrowserLanguageSessionUnavailableError,
  createBrowserAdapters,
} from "../index";

const ALL_FALSE_CAPABILITIES = {
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
  implementation: false,
  callHierarchy: false,
  workspaceSymbols: false,
  semanticTokens: false,
  codeActions: false,
  formatting: false,
  rangeFormatting: false,
  rename: false,
  hierarchy: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrowserLanguageSessionAdapter", () => {
  it("reports a truthful provider-neutral unavailable status", async () => {
    const status = await new BrowserLanguageSessionAdapter().getStatus({
      workspaceId: "workspace-1",
    });

    expect(status).toMatchObject({
      state: "unavailable",
      provider: "external",
      workspaceId: "workspace-1",
      generation: 0,
      capabilities: ALL_FALSE_CAPABILITIES,
    });
    expect(status.lastError).toMatch(/desktop-only/i);
    expect(status.lastError).toMatch(/external language service/i);
    expect(status).not.toHaveProperty("javaExecutable");
    expect(status).not.toHaveProperty("serverPath");
    expect(Date.parse(status.checkedAt)).not.toBeNaN();
  });

  it("rejects start and restart instead of simulating lifecycle success", async () => {
    const adapter = new BrowserLanguageSessionAdapter();

    await expect(
      adapter.start({ workspaceId: "workspace-1", gradleImportEnabled: false }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "BrowserLanguageSessionUnavailableError",
        code: "BROWSER_LANGUAGE_SESSION_UNAVAILABLE",
        message: expect.stringMatching(/cannot start.*browser.*desktop-only/is),
      }),
    );
    await expect(
      adapter.restart({ workspaceId: "workspace-1", generation: 4, gradleImportEnabled: false }),
    ).rejects.toBeInstanceOf(BrowserLanguageSessionUnavailableError);
  });

  it("makes stop idempotently report that no managed browser session exists", async () => {
    const adapter = new BrowserLanguageSessionAdapter();
    const request = { workspaceId: "workspace-1", generation: 99 };

    await expect(adapter.stop(request)).resolves.toMatchObject({
      state: "unavailable",
      workspaceId: "workspace-1",
      generation: 0,
      capabilities: ALL_FALSE_CAPABILITIES,
    });
    await expect(adapter.stop(request)).resolves.toMatchObject({
      state: "unavailable",
      generation: 0,
    });
  });

  it("delivers current status immediately with no polling or network activity", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const listener = vi.fn();

    const unsubscribe = new BrowserLanguageSessionAdapter().subscribe("workspace-1", listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      type: "status",
      status: expect.objectContaining({
        state: "unavailable",
        workspaceId: "workspace-1",
        capabilities: ALL_FALSE_CAPABILITIES,
      }),
    });
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });

  it("includes the unavailable adapter in the browser factory", () => {
    expect(createBrowserAdapters().languageSessionAdapter).toBeInstanceOf(
      BrowserLanguageSessionAdapter,
    );
  });
});
