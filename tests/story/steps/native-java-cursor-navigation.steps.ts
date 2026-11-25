import { After, Given, Then, When } from "@cucumber/cucumber";
import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { NativeJavaCursorNavigationSession } from "../support/native-java-cursor-navigation.js";
import type { StoryWorld } from "../support/world.js";
const sessions = new WeakMap<StoryWorld, NativeJavaCursorNavigationSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native Java cursor scenario not prepared");
  return value;
}
Given<StoryWorld>(
  "the native Java cursor GUI has an isolated two-module Maven reactor and installed RefactorKit and JDT LS tools",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Java cursor qualification requires matching native GUI runner and artifact evidence",
      );
    const value = new NativeJavaCursorNavigationSession();
    sessions.set(this, value);
    await value.prepare();
  },
);
const actions: readonly [
  string,
  (value: NativeJavaCursorNavigationSession) => Promise<void>,
  number?,
][] = [
  [
    "the production editor opens the Java call after an astral Unicode character",
    (s) => s.launch(),
    180_000,
  ],
  [
    "the person requests an implementation for the Java interface method",
    (s) => s.implementation(),
  ],
  ["the person requests F12 at the overloaded method call", (s) => s.definition()],
  ["the person opens Go to Type Definition on the Java constructor type", (s) => s.typeDefinition()],
  [
    "the person requests RefactorKit implementations for the Java interface method",
    (s) => s.refactorKitImplementations(),
  ],
  [
    "the person opens Java workspace-symbol search with Ctrl+T",
    (s) => s.openWorkspaceSymbolSearch(),
  ],
  [
    "the person searches for Helper and opens its class result",
    (s) => s.openHelperWorkspaceSymbol(),
  ],
  ["the person Ctrl-clicks the overloaded Java method call", (s) => s.ctrlClickDefinition()],
  ["the person requests Shift F12 at the saved Java call", (s) => s.references()],
  ["the person opens the call site from the native reference preview", (s) => s.openReference()],
  ["the person requests Java supertypes for the selected source type", (s) => s.typeHierarchy()],
  ["the person requests callers for the selected Java method", (s) => s.callHierarchy()],
  [
    "the person changes the Java call to a string overload without saving and requests F12",
    (s) => s.dirtyDefinition(),
  ],
  ["the person discards the fixture edit and closes the clean navigation IDE", (s) => s.close()],
  ["the person requests native window close with the unsaved Java edit", (s) => s.requestDirtyClose()],
];
const assertions: readonly [string, (value: NativeJavaCursorNavigationSession) => Promise<void>][] =
  [
    [
      "the native editor opens its workspace method implementation",
      (s) => s.assertImplementation(),
    ],
    [
      "the native editor opens the integer overload at its exact declaration position",
      (s) => s.assertDefinition(),
    ],
    ["the editor opens the bound type in the other Maven module", (s) => s.assertTypeDefinition()],
    [
      "RefactorKit shows and opens its concrete workspace method implementation",
      (s) => s.assertRefactorKitImplementations(),
    ],
    [
      "the Java workspace-symbol query receives focus in the native UI",
      (s) => s.assertWorkspaceSymbolSearchFocused(),
    ],
    [
      "the editor opens Helper at its exact workspace declaration",
      (s) => s.assertHelperWorkspaceSymbol(),
    ],
    [
      "Ctrl-click opens the exact integer overload declaration",
      (s) => s.assertCtrlClickDefinition(),
    ],
    [
      "the native reference preview shows the saved declaration and call site",
      (s) => s.assertReferences(),
    ],
    [
      "the editor reveals the exact UTF-16 call position without replacing saved source",
      (s) => s.assertReference(),
    ],
    ["the type hierarchy shows and opens its workspace superclass", (s) => s.assertTypeHierarchy()],
    ["the call hierarchy shows the caller and opens its call site", (s) => s.assertCallHierarchy()],
    [
      "Java navigation follows the dirty string-overload overlay without changing workspace sources",
      (s) => s.assertDirtyOverlayNavigation(),
    ],
    ["the window stays open with the Java edit still unsaved", (s) => s.assertNativeCloseRefused()],
    [
      "the navigation IDE exits with unchanged Java sources and project descriptor",
      (s) => s.assertFinal(),
    ],
  ];
for (const [text, run, timeout = 40_000] of actions)
  When<StoryWorld>(text, { timeout }, async function () {
    const value = session(this);
    try {
      await run(value);
    } catch (error) {
      await value.captureFailure();
      throw error;
    }
  });
for (const [text, run] of assertions)
  Then<StoryWorld>(text, { timeout: 30_000 }, async function () {
    const value = session(this);
    try {
      await run(value);
    } catch (error) {
      await value.captureFailure();
      throw error;
    }
  });
After<StoryWorld>(
  { tags: "@REQ-IDE-JAVA-CURSOR-NAVIGATION-NATIVE-001", timeout: 20_000 },
  async function () {
    const value = sessions.get(this);
    if (!value) return;
    sessions.delete(this);
    try {
      await value.dispose();
    } finally {
      await this.attach(JSON.stringify(value.evidence()), "application/json");
      const diagnostic = value.diagnostics();
      if (diagnostic) await this.attach(diagnostic, "text/plain");
    }
  },
);
