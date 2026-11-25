import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeJavaCodeActionsSession } from "../support/native-java-code-actions.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeJavaCodeActionsSession>();

function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native Java code-action scenario was not prepared");
  return value;
}

Given<StoryWorld>(
  "the native Java code-action GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java code-action qualification requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaCodeActionsSession();
    sessions.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native Java Javadoc GUI has an isolated {string} declaration and installed JDT LS",
  { timeout: 20_000 },
  async function (kind: string) {
    if (kind !== "method" && kind !== "constructor") throw new Error("Unknown Javadoc declaration kind");
    if (this.targetProfile.driver !== "tauri-webdriver" || this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true || this.targetEvidence.packagedApplication !== false)
      throw new Error("Javadoc qualification requires real release/no-bundle native GUI evidence");
    const value = new NativeJavaCodeActionsSession({ javadocKind: kind });
    sessions.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native Java Extract Method GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java Extract Method qualification requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaCodeActionsSession({ extractMethodFixture: true });
    sessions.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native Java try-catch code-action GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java try-catch code-action qualification requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaCodeActionsSession({ tryCatchFixture: true });
    sessions.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native Java organize-imports GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java import-organization qualification requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaCodeActionsSession({ organizeImportsFixture: true });
    sessions.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native Java local-rename GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java local-rename qualification requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaCodeActionsSession({ localRenameFixture: true });
    sessions.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native Java parameter-rename GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java parameter-rename qualification requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaCodeActionsSession({ parameterRenameFixture: true });
    sessions.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native Java cross-file-rename GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java cross-file rename qualification requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaCodeActionsSession({ crossFileRenameFixture: true });
    sessions.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native Java nested-type rename GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java nested-type rename qualification requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaCodeActionsSession({
      specialSemanticRenameFixture: "nested-type",
    });
    sessions.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native Java record-component rename GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java record-component rename qualification requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaCodeActionsSession({
      specialSemanticRenameFixture: "record-component",
    });
    sessions.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native Java multi-document-code-action GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java multi-document code-action qualification requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaCodeActionsSession({ crossFileCodeActionFixture: true });
    sessions.set(this, value);
    await value.prepare();
  },
);

When<StoryWorld>(
  "the person starts the language service and opens the Java source",
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

Then<StoryWorld>(
  "JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.codeActionsCapability ||
      !evidence.formattingCapability ||
      !evidence.rangeFormattingCapability ||
      !evidence.unresolvedListDiagnostic
    )
      throw new Error(
        "JDT LS code actions, document/range formatting or the unresolved List diagnostic are unavailable",
      );
  },
);

When<StoryWorld>("the person requests the JDT LS Extract Method refactoring", async function () {
  const value = session(this);
  try {
    await value.requestExtractMethod();
  } catch (error) {
    value.setFailure(error);
    await value.captureFailure();
    throw error;
  }
});

Then<StoryWorld>("Monaco presents the JDT LS Extract Method refactoring", async function () {
  const value = session(this);
  try {
    await value.assertExtractMethodPresented();
  } catch (error) {
    value.setFailure(error);
    await value.captureFailure();
    throw error;
  }
});

When<StoryWorld>("the person applies the JDT LS Extract Method refactoring", async function () {
  await session(this).applyExtractMethod();
});

Then<StoryWorld>(
  "the editor buffer includes the extracted method and the saved source remains unchanged",
  async function () {
    const value = session(this);
    try {
      await value.assertDraftExtractMethodApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco renders the JDT LS parameter-name hint beside a literal argument",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      const evidence = value.evidence();
      if (!evidence.inlayHintsCapability)
        throw new Error("the initialized JDT LS session did not report inlay-hint support");
      await value.assertInlayHintRendered();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco renders the JDT LS parameter-name hint without saving the Java draft",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      const evidence = value.evidence();
      if (!evidence.inlayHintsCapability)
        throw new Error("the restarted JDT LS session did not report inlay-hint support");
      await value.assertInlayHintRendered({ expectedDirty: true });
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person formats only the selected Java method through JDT LS",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.formatSelectedMethodRange();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco formats only the selected Java range and keeps the saved source unchanged",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.rangeFormattingApplied || !evidence.formattingRangeStayedScoped)
      throw new Error("JDT LS range formatting changed content outside the selected Java range");
  },
);

When<StoryWorld>(
  "the person formats the active Java document through JDT LS",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.formatActiveDocument();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>("Monaco applies formatting only to the unsaved Java buffer", async function () {
  const evidence = session(this).evidence();
  if (!evidence.documentFormattingApplied || !evidence.formattedDraftStayedUnsaved)
    throw new Error("JDT LS formatting did not update only the current Java buffer");
});

When<StoryWorld>("the person enables Java formatting while typing, types a trigger, then disables it",
  { timeout: 35000 }, async function () {
    const value = session(this);
    try { await value.checkTypingFormatting(); }
    catch (error) { value.setFailure(error); await value.captureFailure(); throw error; }
  });
Then<StoryWorld>("Java typing formatting respects the workspace preference and preserves saved source", async function () {
  const proof = session(this).evidence();
  if (!proof.onTypeFormattingApplied || !proof.onTypeFormattingDisabled || !proof.savedSourceUnchanged)
    throw new Error("Java typing formatting did not preserve the preference and saved source");
});

When<StoryWorld>(
  "the person applies the Eclipse formatter profile through Settings",
  { timeout: 70_000 },
  async function () {
    const value = session(this);
    try {
      await value.applyFormatterProfile();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the unsaved Java draft survives the formatter profile restart",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.formatterProfileApplied || !evidence.formatterProfilePreservesUnsavedDraft)
      throw new Error("Applying the formatter profile did not preserve the unsaved Java draft");
  },
);

When<StoryWorld>(
  "the person formats the active Java document with the selected formatter profile",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.formatWithSelectedProfile();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco applies the selected formatter profile to the unsaved Java buffer",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.formatterProfileOutputApplied || !evidence.formatterProfileOutputStayedUnsaved)
      throw new Error("The selected formatter profile did not change only the unsaved Java buffer");
  },
);

When<StoryWorld>(
  "the person opens the selected Eclipse formatter XML from Settings in the editor",
  { timeout: 25_000 },
  async function () {
    const value = session(this);
    try {
      await value.openFormatterProfileInEditor();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the editor shows the configured formatter XML and preserves the Java draft",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.formatterProfileOpenedInEditor || !evidence.formatterProfileOpenPreservedDraft)
      throw new Error(
        "Opening the formatter XML did not show its buffer or preserve the Java draft",
      );
  },
);

When<StoryWorld>(
  "the person changes the formatter brace style and saves the XML from the editor",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.editAndSaveFormatterProfile();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the saved formatter XML contains the updated style and the Java draft is unchanged",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.formatterProfileEditSaved)
      throw new Error("The formatter edit was not saved without changing Java source");
  },
);

When<StoryWorld>(
  "the person restarts JDT LS after editing the formatter XML",
  { timeout: 110_000 },
  async function () {
    const value = session(this);
    try {
      await value.restartJdtlsWithEditedFormatterProfile();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>("JDT LS is ready with the edited formatter profile", async function () {
  const evidence = session(this).evidence();
  if (!evidence.formatterProfileRestarted)
    throw new Error("JDT LS did not restart successfully after the formatter edit");
});

When<StoryWorld>(
  "the person formats the Java draft with the edited formatter profile",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.formatWithEditedProfile();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco applies the edited brace style without saving the Java source",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.formatterProfileEditedStyleApplied || !evidence.savedSourceUnchanged)
      throw new Error("JDT LS did not apply the edited formatter style only to the Java draft");
  },
);

When<StoryWorld>(
  "the person requests generation of accessors for the Java field",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestAccessorGeneration();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the edit-only JDT LS getter and setter action",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertAccessorGenerationPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person applies that accessor generation action",
  { timeout: 20_000 },
  async function () {
    await session(this).applyAccessorGeneration();
  },
);

Then<StoryWorld>(
  "the editor buffer includes the generated accessors and the saved source remains unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftAccessorsApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests a semantic rename of the Java field in the current document",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestSemanticRename();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS rename input for the field",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertSemanticRenamePresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person renames the field to displayLabel",
  { timeout: 20_000 },
  async function () {
    await session(this).applySemanticRename("displayLabel");
  },
);

Then<StoryWorld>(
  "the field rename changes only the editor buffer",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftRenameApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests a semantic rename of a Java local variable that shadows a field",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestLocalSemanticRename();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person opens both Java sources for a cross-file rename",
  { timeout: 20_000 },
  async function () {
    await session(this).openCrossFileRenameSources();
  },
);

When<StoryWorld>(
  "the person opens the Java companion source for a multi-document code action",
  { timeout: 20_000 },
  async function () {
    await session(this).openCrossFileCodeActionSources();
  },
);

When<StoryWorld>(
  "the person requests a quick fix that creates a method in the other open Java file",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestCrossFileMethodCreationQuickFix();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS method-creation quick fix for the other open file",
  async function () {
    const value = session(this);
    try {
      value.assertCrossFileMethodCreationQuickFixPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person applies that multi-document method-creation quick fix",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.applyCrossFileMethodCreationQuickFix();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the workspace edit updates the open Java file and leaves both saved files unchanged",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertCrossFileMethodCreationApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests a semantic rename of one Java overload with an open cross-file reference",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestCrossFileSemanticRename();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests a semantic rename of the nested Java type",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestSpecialSemanticRename("Nested");
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests a semantic rename of the Java record component",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestSpecialSemanticRename("label");
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS rename input for the cross-file method",
  { timeout: 10_000 },
  async function () {
    await session(this).assertCrossFileSemanticRenamePresented();
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS rename input for the nested Java type",
  { timeout: 10_000 },
  async function () {
    await session(this).assertCrossFileSemanticRenamePresented();
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS rename input for the Java record component",
  { timeout: 10_000 },
  async function () {
    await session(this).assertCrossFileSemanticRenamePresented();
  },
);

When<StoryWorld>("the person renames the selected overload to caption", async function () {
  await session(this).applySemanticRename("caption");
});

When<StoryWorld>(
  "the person requests a semantic rename of the String overload parameter",
  async function () {
    await session(this).requestParameterSemanticRename();
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS rename input for the method parameter",
  { timeout: 10_000 },
  async function () {
    await session(this).assertParameterSemanticRenamePresented();
  },
);

When<StoryWorld>("the person renames the selected parameter to input", async function () {
  await session(this).applySemanticRename("input");
});

Then<StoryWorld>(
  "only that parameter binding changes in the unsaved editor buffer",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertParameterSemanticRenameApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>("the person renames the nested type to Inner", async function () {
  await session(this).applySemanticRename("Inner");
});

When<StoryWorld>("the person renames the record component to displayLabel", async function () {
  await session(this).applySemanticRename("displayLabel");
});

Then<StoryWorld>(
  "the selected overload rename updates only its bindings in both drafts and leaves saved files unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertCrossFileRenameApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the nested-type rename updates its declaration and open references in both unsaved Java buffers",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertSpecialSemanticRenameApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the record-component rename updates its declaration and accessor references in both unsaved Java buffers",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertSpecialSemanticRenameApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS rename input for the local variable",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertLocalSemanticRenamePresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>("the person renames the local variable to computedValue", async function () {
  await session(this).applySemanticRename("computedValue");
});

Then<StoryWorld>(
  "the semantic local rename changes only its binding in the editor buffer",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftLocalRenameApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests override or implementation generation for inherited methods",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestOverrideMethodsGeneration();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS override and implementation generator",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertOverrideMethodsGenerationPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person selects the inherited method to generate",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.applyOverrideMethodsGeneration();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the editor buffer includes the selected override and the saved source remains unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftOverrideMethodsGenerated();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests implementation of the inherited Java method",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestAbstractMethodGeneration();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the edit-only JDT LS abstract-method action",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertAbstractMethodGenerationPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person applies that abstract-method action",
  { timeout: 20_000 },
  async function () {
    await session(this).applyAbstractMethodGeneration();
  },
);

Then<StoryWorld>(
  "the editor buffer includes the generated implementation and the saved source remains unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftAbstractMethodGenerated();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests generation of toString for the Java class",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestToStringGeneration();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the edit-only JDT LS toString action",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertToStringGenerationPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>("the person applies that toString action", { timeout: 20_000 }, async function () {
  await session(this).applyToStringGeneration();
});

Then<StoryWorld>(
  "the editor buffer includes the generated toString and the saved source remains unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftToStringGenerated();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests constructor generation for the Java class",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestConstructorGeneration();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS constructor generation action",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertConstructorGenerationPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person applies that constructor generation action",
  { timeout: 20_000 },
  async function () {
    await session(this).applyConstructorGeneration();
  },
);

Then<StoryWorld>(
  "the editor buffer includes a constructor for the selected field and the saved source remains unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftConstructorGenerated();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests hashCode and equals generation for the Java class",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestHashCodeEqualsGeneration();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS hashCode and equals generation action",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertHashCodeEqualsGenerationPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person applies that hashCode and equals generation action",
  { timeout: 20_000 },
  async function () {
    await session(this).applyHashCodeEqualsGeneration();
  },
);

Then<StoryWorld>(
  "the editor buffer includes hashCode and equals methods and the saved source remains unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftHashCodeEqualsGenerated();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests delegate method generation for a Java field",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestDelegateMethodsGeneration();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS delegate method generator",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDelegateMethodsGenerationPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person selects a method from the delegate target",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.applyDelegateMethodsGeneration();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the editor buffer includes the selected delegate method and the saved source remains unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftDelegateMethodsGenerated();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests sorting of the Java class members",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestMemberSorting();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS Sort Members action",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertMemberSortingPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person applies that member-sorting action",
  { timeout: 20_000 },
  async function () {
    await session(this).applyMemberSorting();
  },
);

Then<StoryWorld>(
  "the editor buffer has sorted members and the saved source remains unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftMembersSorted();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests a quick fix for the unresolved List type",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestImportQuickFix();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests the JDT LS Surround with try and catch quick assist",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestTryCatchQuickAssist();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS Surround with try and catch quick assist",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertTryCatchQuickAssistPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person applies the JDT LS Surround with try and catch quick assist",
  { timeout: 20_000 },
  async function () {
    await session(this).applyTryCatchQuickAssist();
  },
);

Then<StoryWorld>(
  "the Java buffer contains a catch block and the saved source remains unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftTryCatchApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS import action for java.util.List",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertImportQuickFixPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person applies that import quick fix",
  { timeout: 20_000 },
  async function () {
    await session(this).applyImportQuickFix();
  },
);

Then<StoryWorld>(
  "the editor buffer includes the import and the saved source remains unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftImportApplied();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests organization of the Java imports",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestImportOrganization();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco presents the JDT LS Organize Imports source action",
  { timeout: 10_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertImportOrganizationPresented();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person applies the JDT LS Organize Imports action",
  { timeout: 20_000 },
  async function () {
    await session(this).applyImportOrganization();
  },
);

Then<StoryWorld>(
  "the editor buffer has sorted used imports, removes the unused import, and keeps saved source unchanged",
  { timeout: 15_000 },
  async function () {
    const value = session(this);
    try {
      await value.assertDraftImportsOrganized();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person restores the disk version, stops JDT LS, and closes the IDE",
  { timeout: 35_000 },
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
  "the Java project inputs remain unchanged and the native application exits cleanly",
  async function () {
    const evidence = session(this).evidence();
    if (!evidence.cleanExit || !evidence.savedSourceUnchanged || !evidence.draftRestored)
      throw new Error("native Java code-action evidence is incomplete");
  },
);

Then<StoryWorld>(
  "the Java project and formatter profile are restored and the native application exits cleanly",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.cleanExit ||
      !evidence.savedSourceUnchanged ||
      !evidence.draftRestored ||
      !evidence.formatterProfileFixtureRestored
    )
      throw new Error(
        "The edited formatter scenario did not restore its project and profile fixture",
      );
  },
);

After<StoryWorld>(
  { tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", timeout: 20_000 },
  async function () {
    const value = sessions.get(this);
    if (!value) return;
    sessions.delete(this);
    try {
      await value.dispose();
    } finally {
      await this.attach(JSON.stringify(value.evidence()), "application/json");
    }
  },
);

Given<StoryWorld>(
  "the native Java GUI delays only a real JDT LS formatting response",
  { timeout: 20_000 },
  async function () {
    const value = new NativeJavaCodeActionsSession();
    sessions.set(this, value);
    await value.prepare();
    await value.delayRealFormattingResponse();
  },
);
When<StoryWorld>(
  "the person opens another file while the real formatting response is held",
  { timeout: 40_000 },
  async function () {
    const value = session(this);
    try {
      await value.openFileWhileFormattingIsPending();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person requests a semantic rename with the Java reference file still closed",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestClosedFileSemanticRename();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person closes the clean Java target before requesting its quick fix",
  { timeout: 20_000 },
  async function () {
    await session(this).closeCodeActionTarget();
  },
);
When<StoryWorld>(
  "the person requests a method-creation quick fix for the closed Java target",
  { timeout: 30_000 },
  async function () {
    const value = session(this);
    try {
      await value.requestClosedFileMethodCreationQuickFix();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "the method-creation quick fix is selectable without opening its target",
  async function () {
    await session(this).assertClosedFileMethodCreationQuickFixPresented();
  },
);

When<StoryWorld>("the person requests Javadoc for the selected Java declaration", { timeout: 90_000 }, async function () {
  const value = session(this);
  try {
    await value.requestJavadoc();
  } catch (error) {
    value.setFailure(error);
    await value.captureFailure();
    throw error;
  }
});

Then<StoryWorld>("Monaco presents the JDT LS Add Javadoc comment action", { timeout: 90_000 }, async function () {
  const value = session(this);
  try {
    await value.assertJavadocPresented();
  } catch (error) {
    value.setFailure(error);
    await value.captureFailure();
    throw error;
  }
});

When<StoryWorld>("the person applies the JDT LS Add Javadoc comment action", { timeout: 90_000 }, async function () {
  const value = session(this);
  try {
    await value.applyJavadoc();
  } catch (error) {
    value.setFailure(error);
    await value.captureFailure();
    throw error;
  }
});

Then<StoryWorld>("the unsaved Javadoc matches the declaration and passes javac and doclint", { timeout: 90_000 }, async function () {
  const value = session(this);
  try {
    await value.assertJavadocApplied();
  } catch (error) {
    value.setFailure(error);
    await value.captureFailure();
    throw error;
  }
});

When<StoryWorld>("the person undoes and redoes the Javadoc action", { timeout: 90_000 }, async function () {
  const value = session(this);
  try {
    await value.undoRedoJavadoc();
  } catch (error) {
    value.setFailure(error);
    await value.captureFailure();
    throw error;
  }
});

Then<StoryWorld>("Javadoc history preserves the prior import draft and saved source", async function () {
  const evidence = session(this).evidence();
  if (!evidence.javadocUndoPreservesPriorDraft || !evidence.javadocRedoRestoresComment)
    throw new Error("Javadoc Undo/Redo did not preserve the prior unsaved import");
});
