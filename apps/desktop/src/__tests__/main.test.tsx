import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const selectSourceRepository = vi.fn();
  const selectDestinationParent = vi.fn();
  const renderPreview = vi.fn();
  const apply = vi.fn();
  const revokeOperation = vi.fn();
  const revokeAll = vi.fn();
  const composition = Object.freeze({
    selectors: Object.freeze({ selectSourceRepository, selectDestinationParent }),
    renderer: Object.freeze({ renderPreview }),
    apply,
    grants: Object.freeze({ revokeOperation, revokeAll }),
  });
  const render = vi.fn();
  return {
    composition,
    selectSourceRepository,
    selectDestinationParent,
    renderPreview,
    apply,
    revokeOperation,
    revokeAll,
    render,
    createRoot: vi.fn(() => ({ render })),
    createRendererComposition: vi.fn(() => composition),
  };
});

vi.mock("react-dom/client", () => ({
  default: { createRoot: harness.createRoot },
  createRoot: harness.createRoot,
}));

vi.mock("@ide/tauri-adapters", () => ({
  createTauriXcom2ProjectFoundryRendererComposition: harness.createRendererComposition,
}));

vi.mock("../App", () => ({
  App: vi.fn(() => null),
}));

describe("desktop main", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("injects callable Apply with every corrected native renderer facet without entering native operations", async () => {
    await import("../main");

    expect(harness.createRendererComposition).toHaveBeenCalledOnce();
    expect(harness.createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    expect(harness.render).toHaveBeenCalledOnce();
    const strictModeElement = harness.render.mock.calls[0]?.[0] as {
      readonly props?: {
        readonly children?: { readonly props?: { readonly projectFoundry?: unknown } };
      };
    };
    const projectFoundry = strictModeElement.props?.children?.props?.projectFoundry;
    expect(projectFoundry).toBe(harness.composition);
    expect(projectFoundry).toEqual({
      selectors: {
        selectSourceRepository: harness.selectSourceRepository,
        selectDestinationParent: harness.selectDestinationParent,
      },
      renderer: { renderPreview: harness.renderPreview },
      apply: harness.apply,
      grants: {
        revokeOperation: harness.revokeOperation,
        revokeAll: harness.revokeAll,
      },
    });
    expect(typeof harness.composition.apply).toBe("function");
    for (const nativeOperation of [
      harness.selectSourceRepository,
      harness.selectDestinationParent,
      harness.renderPreview,
      harness.apply,
      harness.revokeOperation,
      harness.revokeAll,
    ]) {
      expect(nativeOperation).not.toHaveBeenCalled();
    }

    const workspaceRoot = /\/(?:apps|packages)\/[^/]+$/u.test(process.cwd())
      ? resolve(process.cwd(), "../..")
      : process.cwd();
    const desktopSource = readFileSync(resolve(workspaceRoot, "apps/desktop/src/main.tsx"), "utf8");
    expect(desktopSource).toContain("createTauriXcom2ProjectFoundryRendererComposition");
    expect(desktopSource).not.toContain("createTauriXcom2ProjectFoundryComposition");

    const webSource = readFileSync(resolve(workspaceRoot, "apps/web/src/main.tsx"), "utf8");
    expect(webSource).not.toContain("@ide/tauri-adapters");
    expect(webSource).not.toContain("createTauriXcom2ProjectFoundryRendererComposition");
  });
});
