import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeJavaLanguageIntelligenceSession } from "../support/native-java-language-intelligence.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeJavaLanguageIntelligenceSession>();

function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native Java language-intelligence scenario was not prepared");
  return value;
}

Given<StoryWorld>(
  "the native Java language-intelligence GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    const evidence = this.targetEvidence;
    const releaseNoBundle =
      evidence?.packagedApplication === false && evidence?.artifactKind === "release-no-bundle";
    const appImage =
      evidence?.packagedApplication === true && evidence?.artifactKind === "appimage";
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      evidence?.kind !== "tauri-webdriver" ||
      evidence?.nativeGui !== true ||
      evidence?.e2e !== true ||
      (!releaseNoBundle && !appImage)
    )
      throw new Error(
        "Java language-intelligence qualification requires release/no-bundle or AppImage native GUI evidence",
      );
    const value = new NativeJavaLanguageIntelligenceSession();
    sessions.set(this, value);
    await value.prepare({
      discoverInstalledTools: appImage && process.env.IDE_STORY_NATIVE_GUI_STANDARD_JAVA_TOOLS === "1",
    });
  },
);

When<StoryWorld>(
  "the person starts JDT LS and opens the Java language-intelligence source",
  { timeout: 80_000 },
  async function () {
    const value = session(this);
    try {
      await value.launchAndStartLanguageService();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person tries an incompatible JDT LS runtime then saves a compatible runtime JDK preference",
  { timeout: 90_000 },
  async function () {
    const value = session(this);
    try {
      await value.saveAndVerifyJdtlsRuntimeJdkPreference();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the native service uses the saved runtime JDK independently of the project JDK after restart",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.runtimeJdkPreferenceSaved ||
      !evidence.runtimeJdkPreferenceApplied ||
      !evidence.runtimeJdkPreferenceSurvivedRestart ||
      !evidence.incompatibleRuntimeRefusedBeforeLaunch ||
      !evidence.savedSourceUnchanged ||
      !evidence.runtimePreferenceDraftPreserved
    )
      throw new Error("The native JDT LS runtime JDK preference was not applied independently");
  },
);

When<StoryWorld>(
  "the person searches for Completion in Search Everywhere",
  { timeout: 35_000 },
  async function () {
    const value = session(this);
    try {
      await value.searchEverywhereForCompletion();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Search Everywhere presents the matching file, Java symbol, and project text",
  async function () {
    if (!session(this).evidence().searchEverywhereCategoriesPresented)
      throw new Error("Search Everywhere did not present all three Java project result types");
  },
);

When<StoryWorld>("the person selects the Java symbol result using the keyboard", async function () {
  const value = session(this);
  try {
    await value.selectSearchEverywhereJavaSymbol();
  } catch (error) {
    value.setFailure(error);
    await value.captureFailure();
    throw error;
  }
});

Then<StoryWorld>(
  "the native editor opens its Java declaration without changing the saved file",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.searchEverywhereKeyboardSymbolSelection ||
      !evidence.searchEverywhereJavaSymbolOpened
    )
      throw new Error("Search Everywhere did not open the selected JDT LS Java declaration");
  },
);

When<StoryWorld>(
  "the person opens a Java source with an unresolved type",
  { timeout: 45_000 },
  async function () {
    const value = session(this);
    try {
      await value.verifyDiagnosticsInProblems();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the Problems view presents the JDT LS diagnostic without changing saved source",
  async function () {
    if (!session(this).evidence().diagnosticsPresented)
      throw new Error("JDT LS diagnostic was not presented in Problems");
  },
);

When<StoryWorld>(
  "the person restarts JDT LS with an unsaved Java draft",
  { timeout: 90_000 },
  async function () {
    const value = session(this);
    try {
      await value.restartWithUnsavedDraft();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "JDT LS returns to ready and both Java drafts remain unchanged",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.jdtlsRestarted ||
      !evidence.draftPreservedAfterRestart ||
      !evidence.completionImportDraftPreservedAfterRestart
    )
      throw new Error("JDT LS restart did not preserve both unsaved Java drafts");
  },
);

When<StoryWorld>(
  "the person expands the Java standard-output template",
  { timeout: 25_000 },
  async function () {
    const value = session(this);
    try {
      await value.expandStandardOutputTemplate();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco expands the Java template at its placeholder and keeps the source unsaved",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.javaTemplateExpanded || !evidence.templateSavedSourceUnchanged)
      throw new Error("The Java template was not expanded as an unsaved editor change");
  },
);

When<StoryWorld>(
  "the person expands the Java main-method template",
  { timeout: 25_000 },
  async function () {
    const value = session(this);
    try {
      await value.expandMainMethodTemplate();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco expands the Java main-method template and keeps the source unsaved",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.mainMethodTemplateExpanded || !evidence.mainMethodTemplateSavedSourceUnchanged)
      throw new Error("The Java main-method template was not expanded as an unsaved editor change");
  },
);

When<StoryWorld>(
  "the person expands the remaining Java typing templates",
  { timeout: 90_000 },
  async function () {
    const value = session(this);
    try {
      await value.expandAdditionalJavaTemplates();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco expands the remaining Java typing templates without saving their source",
  async function () {
    const evidence = session(this).evidence();
    const expected = ["standard-error", "counted-loop", "enhanced-loop", "null-check", "try-catch"];
    if (
      JSON.stringify(evidence.additionalJavaTemplatesExpanded) !== JSON.stringify(expected) ||
      JSON.stringify(evidence.additionalJavaTemplateSavedSourcesUnchanged) !==
        JSON.stringify(expected)
    )
      throw new Error("One or more Java typing templates failed native GUI acceptance");
  },
);

Then<StoryWorld>(
  "Monaco advances through the counted-loop snippet placeholders with Tab after dismissing Java completions, keeping the source unsaved",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.countedLoopTemplateTabStopsNavigated ||
      !evidence.additionalJavaTemplateSavedSourcesUnchanged.includes("counted-loop")
    )
      throw new Error("The counted-loop Tab stops did not update the unsaved Java buffer");
  },
);

When<StoryWorld>(
  "the person requests Java member completion after a String receiver",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestCompletion();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS completion item without changing saved source",
  async function () {
    if (
      !session(this).evidence().completionPresented ||
      !session(this).evidence().savedSourceUnchanged
    )
      throw new Error("Java completion was not presented or changed saved source");
  },
);

When<StoryWorld>(
  "the person accepts a type completion that requests a Java import",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.acceptTypeCompletionWithImport();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco applies the completed type and import to the unsaved Java source",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.completionImportApplied || !evidence.savedSourceUnchanged)
      throw new Error("Java type completion did not apply its import as an unsaved buffer edit");
  },
);

When<StoryWorld>(
  "the person reloads the WebView and verifies Java hover after an edited revision",
  { timeout: 120_000 },
  async function () {
    const value = session(this);
    try {
      await value.reloadWebviewWithJavaDocument();
      if (!value.evidence().webviewReloadRestoredJavaSemantics)
        throw new Error("Java hover did not recover after reload");
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests hover for the Java field",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestHover();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS field hover without changing saved source",
  async function () {
    if (!session(this).evidence().hoverPresented || !session(this).evidence().savedSourceUnchanged)
      throw new Error("Java hover was not presented or changed saved source");
  },
);

When<StoryWorld>(
  "the person requests signature help at a Java method call",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestSignatureHelp();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS method signature without changing saved source",
  async function () {
    if (
      !session(this).evidence().signatureHelpPresented ||
      !session(this).evidence().savedSourceUnchanged
    )
      throw new Error("Java signature help was not presented or changed saved source");
  },
);

When<StoryWorld>(
  "the person uses the editor shortcut to search for Java references at the repeat method",
  { timeout: 25_000 },
  async function () {
    const value = session(this);
    try {
      await value.searchReferences();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the panel lists the JDT LS declaration and call, opens the call site, and leaves the source unsaved",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.referencesPresented ||
      !evidence.referenceNavigationOpened ||
      !evidence.referenceSavedSourceUnchanged
    )
      throw new Error("JDT LS references were not presented and navigated without changing source");
  },
);

When<StoryWorld>(
  "the person inspects JDT LS callers and calls made for Java methods",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.queryCallHierarchy();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the panel shows JDT LS callers and callees, opens a call site, and preserves saved source",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.callHierarchyCallersPresented ||
      !evidence.callHierarchyCalleesPresented ||
      !evidence.callHierarchyCallSiteOpened ||
      !evidence.callHierarchySavedSourceUnchanged
    )
      throw new Error("JDT LS call hierarchy did not show or navigate workspace calls safely");
  },
);

When<StoryWorld>(
  "the person opens Java Structure from Commands and selects a filtered method",
  { timeout: 40_000 },
  async function () {
    const value = session(this);
    try {
      await value.inspectJavaStructure();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "Java Structure preserves the hierarchy, exact declaration cursor, and unsaved source",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.javaStructureFromCommands ||
      !evidence.javaStructureHierarchyFiltered ||
      !evidence.javaStructureCursorOpened ||
      !evidence.javaStructureDraftPreserved
    )
      throw new Error("Java Structure did not preserve the current provider outline and draft.");
  },
);

When<StoryWorld>(
  "the person uses the JDT LS editor shortcut at a Java call site",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.queryDefinition();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the panel opens the JDT LS declaration and preserves saved source",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.definitionsPresented ||
      !evidence.definitionNavigationOpened ||
      !evidence.definitionSavedSourceUnchanged
    )
      throw new Error(
        "JDT LS definition did not resolve and navigate to the workspace declaration",
      );
  },
);

When<StoryWorld>(
  "the person restores the Java source, stops JDT LS, and closes the IDE",
  { timeout: 40_000 },
  async function () {
    const value = session(this);
    try {
      await value.restoreAndClose();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the Java language-intelligence project is restored and the native application exits cleanly",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.draftRestored || !evidence.cleanExit)
      throw new Error(
        "Java language-intelligence cleanup did not restore the draft and close the native application",
      );
  },
);

After<StoryWorld>(
  {
    tags: "@native-java-language-intelligence or @native-java-templates or @native-java-jdtls-runtime-preference",
    timeout: 20_000,
  },
  async function () {
    const value = sessions.get(this);
    sessions.delete(this);
    if (!value) return;
    try {
      await value.dispose();
    } catch (error) {
      await this.attach(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        "text/plain",
      );
      throw error;
    }
    await this.attach(JSON.stringify(value.evidence(), null, 2), "application/json");
  },
);
