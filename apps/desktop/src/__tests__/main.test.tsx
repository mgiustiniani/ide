import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const composition = Object.freeze({ kind: "renderer-composition" });
  const render = vi.fn();
  return {
    composition,
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

  it("wires only the corrected native renderer composition into App", async () => {
    await import("../main");

    expect(harness.createRendererComposition).toHaveBeenCalledOnce();
    expect(harness.createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    expect(harness.render).toHaveBeenCalledOnce();
    const strictModeElement = harness.render.mock.calls[0]?.[0] as {
      readonly props?: {
        readonly children?: { readonly props?: { readonly projectFoundry?: unknown } };
      };
    };
    expect(strictModeElement.props?.children?.props?.projectFoundry).toBe(harness.composition);

    const workspaceRoot = /\/(?:apps|packages)\/[^/]+$/u.test(process.cwd())
      ? resolve(process.cwd(), "../..")
      : process.cwd();
    const desktopRoot = resolve(workspaceRoot, "apps/desktop");
    const source = readFileSync(resolve(desktopRoot, "src/main.tsx"), "utf8");
    expect(source).toContain("createTauriXcom2ProjectFoundryRendererComposition");
    expect(source).not.toContain("createTauriXcom2ProjectFoundryComposition");
  });
});
