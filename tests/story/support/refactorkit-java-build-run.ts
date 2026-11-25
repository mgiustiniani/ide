import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createElement } from "react";
import { act, render, renderHook, type RenderHookResult } from "@testing-library/react";
import { TauriJavaExecutionAdapter } from "../../../packages/tauri-adapters/src/java-execution-tauri.js";
import { BrowserJavaExecutionAdapter } from "../../../packages/browser-adapters/src/java-execution-browser.js";
import {
  useJavaExecutionController,
  type JavaExecutionController,
} from "../../../apps/desktop/src/features/java-execution/useJavaExecutionController.js";
import { JavaExecutionPanel } from "../../../apps/desktop/src/features/java-execution/JavaExecutionPanel.js";
import type {
  JavaExecutionOperation,
  JavaExecutionSnapshot,
} from "../../../packages/contracts/src/java-execution.js";
import type { StoryWorld } from "./world.js";

export const REQUIREMENT = "REQ-IDE-JAVA-BUILD-RUN-DEBUG-001";
const ROOT = resolve(import.meta.dirname, "../../..");
const OUTPUT = "Output returned by the deterministic Java tool boundary";
type Props = { workspaceId: string; generation: number; enabled: boolean };
const CONTEXT: Props = { workspaceId: "java-story-workspace", generation: 1, enabled: true };
function sources(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", "__tests__"].includes(entry.name)) return [];
    const file = join(path, entry.name);
    return entry.isDirectory()
      ? sources(file)
      : /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [file]
        : [];
  });
}
/** Exercises the production controller, panel and adapter. Only native tool execution is doubled. */
class JavaBuildRunStorySession {
  private hook?: RenderHookResult<JavaExecutionController, Props>;
  private dom?: { window: Window & typeof globalThis & { close(): void } };
  private globals = new Map<string, PropertyDescriptor | undefined>();
  private result?: JavaExecutionSnapshot;
  private unavailable = false;
  readonly calls: Array<{ command: string; request: Record<string, unknown> }> = [];
  async start() {
    if (this.hook) return;
    const { JSDOM } = createRequire(import.meta.url)("jsdom");
    this.dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://java.story.invalid",
    });
    const window = this.dom!.window;
    for (const [name, value] of Object.entries({
      window,
      document: window.document,
      navigator: window.navigator,
      HTMLElement: window.HTMLElement,
      Node: window.Node,
      localStorage: window.localStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      this.globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string, args: { request: Record<string, unknown> }) => {
          const request = args.request;
          this.calls.push({ command, request });
          if (this.unavailable) throw new Error("The Java toolchain is unavailable.");
          if (command === "get_java_execution_capabilities")
            return {
              ...CONTEXT,
              available: true,
              projectKind: "jdk",
              jdk: true,
              maven: true,
              gradle: true,
              debugger: true,
              reason: null,
            };
          if (command === "start_java_execution") {
            this.result = {
              workspaceId: CONTEXT.workspaceId,
              generation: CONTEXT.generation,
              sessionId: "java-story-session",
              operation: request.operation as JavaExecutionOperation,
              state: request.operation === "debug" ? "running" : "succeeded",
              output: OUTPUT,
              outputTruncated: false,
              exitCode: request.operation === "debug" ? null : 0,
            };
          }
          if (command === "stop_java_execution" && this.result)
            this.result = { ...this.result, state: "stopped", exitCode: null };
          if (command === "send_java_debug_command") return null;
          if (!this.result) throw new Error("No Java session exists.");
          return this.result;
        },
      },
    });
    const port = new TauriJavaExecutionAdapter();
    await act(async () => {
      this.hook = renderHook(
        (props) => useJavaExecutionController({ ...props, port, prepare: async () => undefined }),
        { initialProps: CONTEXT },
      );
    });
  }
  async trust() {
    await this.start();
    await act(async () => {
      this.hook!.result.current.updateConfiguration({
        buildTool: "jdk",
        mainClass: "Main",
        classPath: [],
      });
      this.hook!.result.current.setTrusted(true);
    });
  }
  async execute(operation: JavaExecutionOperation) {
    await act(async () => {
      await this.hook!.result.current.start(operation);
    });
  }
  assertPresentation(operation: string) {
    const controller = this.hook!.result.current;
    assert.equal(controller.snapshot?.operation, operation);
    assert.equal(controller.snapshot?.output, OUTPUT);
    const panel = render(createElement(JavaExecutionPanel, { controller }));
    try {
      assert.ok(panel.getByLabelText("Java console output").textContent?.includes(OUTPUT));
    } finally {
      panel.unmount();
    }
    assert.ok(
      this.calls.some(
        (call) =>
          call.command === "start_java_execution" &&
          call.request.operation === operation &&
          call.request.trusted === true,
      ),
    );
  }
  async debugAndStop() {
    await act(async () => {
      await this.hook!.result.current.debugCommand("stop at Main:4");
    });
    assert.ok(
      this.calls.some(
        (call) =>
          call.command === "send_java_debug_command" && call.request.command === "stop at Main:4",
      ),
    );
    await act(async () => {
      await this.hook!.result.current.stop();
    });
    assert.equal(this.hook!.result.current.snapshot?.state, "stopped");
  }
  makeUnavailable() {
    this.unavailable = true;
  }
  assertUnavailable() {
    assert.match(this.hook!.result.current.error ?? "", /unavailable/);
    assert.equal(this.hook!.result.current.snapshot, null);
  }
  assertUntrusted() {
    assert.match(this.hook!.result.current.error ?? "", /trust/);
    assert.ok(!this.calls.some((call) => call.command === "start_java_execution"));
  }
  async assertBrowserUnavailable() {
    const adapter = new BrowserJavaExecutionAdapter();
    assert.equal((await adapter.getCapabilities(CONTEXT)).available, false);
    await assert.rejects(
      adapter.start({
        ...CONTEXT,
        operation: "build",
        trusted: true,
        configuration: { buildTool: "jdk", mainClass: "Main", classPath: [] },
      }),
    );
  }
  scanWebFirstLayers() {
    return this.webFirstLayerScan();
  }
  webFirstLayerScan() {
    return ["packages/ui", "packages/web-core", "apps/web"].map((layer) => ({
      layer,
      platformApiImportCount: sources(join(ROOT, layer, "src")).filter((file) =>
        /@tauri-apps\/api/.test(readFileSync(file, "utf8")),
      ).length,
    }));
  }
  portCapabilityEvidence() {
    const port = "packages/web-core/src/ports/java-execution-port.ts";
    return [
      {
        port,
        tauriImports: /@tauri-apps\/api/.test(readFileSync(join(ROOT, port), "utf8")) ? 1 : 0,
      },
    ];
  }
  reconcileFeatureStatus() {
    return this.featureReconciliation();
  }
  featureReconciliation() {
    const text = readFileSync(join(ROOT, "features/refactorkit/java-build-run.feature"), "utf8");
    const header = text.split("Feature:")[0];
    const scenarios = text.split("Scenario:").slice(1);
    return {
      featureStatusTags: [
        ...header.matchAll(
          /@(not-implemented|partial|implemented-not-e2e-validated|implemented-and-validated)/g,
        ),
      ].map((match) => match[0]),
      scenarioStatusTags: scenarios.flatMap((body) =>
        [
          ...body.matchAll(
            /@(not-implemented|partial|implemented-not-e2e-validated|implemented-and-validated)/g,
          ),
        ].map((match) => match[0]),
      ),
    };
  }
  evidence() {
    return {
      runtime: "desktop/tauri-harness",
      nativeToolExecution: false,
      nativeGui: false,
      commands: this.calls.map((call) => call.command),
    };
  }
  dispose() {
    this.hook?.unmount();
    for (const [key, descriptor] of this.globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    this.dom?.window.close();
    this.hook = undefined;
  }
}
const sessions = new WeakMap<StoryWorld, JavaBuildRunStorySession>();
export function getRefactorKitJavaBuildRunSession(world: StoryWorld) {
  let session = sessions.get(world);
  if (!session) {
    session = new JavaBuildRunStorySession();
    sessions.set(world, session);
  }
  return session;
}
export function disposeRefactorKitJavaBuildRunSession(world: StoryWorld) {
  sessions.get(world)?.dispose();
  sessions.delete(world);
}
