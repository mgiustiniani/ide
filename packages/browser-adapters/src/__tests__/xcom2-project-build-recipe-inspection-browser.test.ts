import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Xcom2ProjectBuildRecipeInspectionRequest } from "@ide/web-core/ports";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserXcom2ProjectBuildRecipeInspectionAdapter,
  BrowserXcom2ProjectBuildRecipeInspectionUnavailableError,
  createBrowserAdapters,
} from "../index";

const WORKSPACE_ID = "workspace-secret-build-recipe-71f3";
const MODULE_ROOT = "projects/module-secret-build-recipe-a92c";
const GENERATION = 873_421;
const UNAVAILABLE_MESSAGE =
  "XCOM 2 project build recipe inspection requires desktop-only native filesystem services and is unavailable in a browser.";

const request = {
  workspaceId: WORKSPACE_ID,
  generation: GENERATION,
  moduleRoot: MODULE_ROOT,
} satisfies Xcom2ProjectBuildRecipeInspectionRequest;

const FORBIDDEN_RESULT_FIELDS = ["candidate", "recipe", "approval", "digest", "success"] as const;

function rejectionText(error: BrowserXcom2ProjectBuildRecipeInspectionUnavailableError): string {
  return [error.name, error.code, error.message, error.stack ?? "", JSON.stringify(error)].join(
    "\n",
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrowserXcom2ProjectBuildRecipeInspectionAdapter", () => {
  it("rejects a structured request with one typed static native-unavailable error and no result data", async () => {
    let caught: unknown;

    try {
      await new BrowserXcom2ProjectBuildRecipeInspectionAdapter().inspect(request);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BrowserXcom2ProjectBuildRecipeInspectionUnavailableError);
    const error = caught as BrowserXcom2ProjectBuildRecipeInspectionUnavailableError;
    expect(error).toMatchObject({
      name: "BrowserXcom2ProjectBuildRecipeInspectionUnavailableError",
      code: "BROWSER_XCOM2_PROJECT_BUILD_RECIPE_INSPECTION_UNAVAILABLE",
      message: UNAVAILABLE_MESSAGE,
    });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

    const rendered = rejectionText(error);
    for (const value of [WORKSPACE_ID, MODULE_ROOT, String(GENERATION)]) {
      expect(rendered).not.toContain(value);
    }
    for (const field of FORBIDDEN_RESULT_FIELDS) {
      expect(field in error).toBe(false);
    }
  });

  it("performs zero filesystem, process, network, storage, timer, or polling calls", async () => {
    const capabilitySpies = [
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.spyOn(XMLHttpRequest.prototype, "open"),
      vi.spyOn(Storage.prototype, "getItem"),
      vi.spyOn(Storage.prototype, "setItem"),
      vi.spyOn(Storage.prototype, "removeItem"),
      vi.spyOn(globalThis, "setTimeout"),
      vi.spyOn(globalThis, "setInterval"),
      vi.spyOn(globalThis, "requestAnimationFrame"),
    ];
    const [fetchSpy, webSocketSpy, workerSpy, openFileSpy, saveFileSpy, directorySpy] =
      capabilitySpies;

    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("WebSocket", webSocketSpy);
    vi.stubGlobal("Worker", workerSpy);
    vi.stubGlobal("showOpenFilePicker", openFileSpy);
    vi.stubGlobal("showSaveFilePicker", saveFileSpy);
    vi.stubGlobal("showDirectoryPicker", directorySpy);

    await expect(
      new BrowserXcom2ProjectBuildRecipeInspectionAdapter().inspect(request),
    ).rejects.toBeInstanceOf(BrowserXcom2ProjectBuildRecipeInspectionUnavailableError);

    expect(capabilitySpies.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(0);
  });

  it("imports only browser-safe contracts and contains no forbidden capability access", () => {
    const source = readFileSync(
      resolve(__dirname, "../xcom2-project-build-recipe-inspection-browser.ts"),
      "utf8",
    );
    const imports = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g), ([, path]) => path);

    expect(imports).toEqual(["@ide/contracts", "@ide/web-core/ports"]);
    expect(source).not.toMatch(
      /@tauri-apps\/api|node:(?:fs|child_process|net|http|https)|\b(?:fetch|WebSocket|Worker|localStorage|sessionStorage|indexedDB|setTimeout|setInterval|requestAnimationFrame|showOpenFilePicker|showSaveFilePicker|showDirectoryPicker)\b/,
    );
  });

  it("is exposed by the browser factory", () => {
    expect(createBrowserAdapters().xcom2ProjectBuildRecipeInspectionAdapter).toBeInstanceOf(
      BrowserXcom2ProjectBuildRecipeInspectionAdapter,
    );
  });
});
