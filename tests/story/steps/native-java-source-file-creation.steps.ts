import { Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

Given<StoryWorld>(
  "an isolated native Java file-creation workspace contains an existing package source",
  async function () {
    await this.createNativeJavaSourceFileCreationSession().prepare();
  },
);

When<StoryWorld>(
  "the person opens the existing source at the end of the package in File Explorer",
  { timeout: 55_000 },
  async function () {
    await this.nativeJavaSourceFileCreationSession().openLastPackageSource();
  },
);

Given<StoryWorld>(
  "the Java package contains {int} sibling source files before the existing source",
  async function (count: number) {
    await this.nativeJavaSourceFileCreationSession().addPackageSources(count);
  },
);

Then<StoryWorld>(
  "the executable exits and every file in the large package is preserved",
  async function () {
    await this.nativeJavaSourceFileCreationSession().assertLargePackagePreserved();
  },
);

When<StoryWorld>(
  "the real production desktop executable is launched for the workspace",
  { timeout: 35_000 },
  async function () {
    await this.nativeJavaSourceFileCreationSession().launch();
  },
);

When<StoryWorld>(
  "the person tries restricted Java type names and ignorable file-name characters",
  { timeout: 30_000 },
  async function () {
    await this.nativeJavaSourceFileCreationSession().rejectInvalidTypeNames();
  },
);

Then<StoryWorld>(
  "the rejected type submissions leave source files and editor tabs unchanged",
  async function () {
    if (!this.nativeJavaSourceFileCreationSession().evidence().rejectedTypeInputsPreservedFiles)
      throw new Error("Rejected Java type names changed files or editor tabs.");
  },
);

When<StoryWorld>(
  "the person switches workspaces with unsubmitted file, folder and Java-type forms",
  { timeout: 60_000 },
  async function () {
    await this.nativeJavaSourceFileCreationSession().retireCreationForms();
  },
);

Then<StoryWorld>(
  "the creation forms are retired without creating entries in either workspace",
  async function () {
    const proof = this.nativeJavaSourceFileCreationSession().evidence();
    if (proof.retiredCreationForms.length !== 3 || !proof.workspaceTransitionPreservedFiles)
      throw new Error("The workspace transition did not retire every creation form safely.");
  },
);

When<StoryWorld>(
  "the person creates {string} from the package context menu",
  { timeout: 15_000 },
  async function (fileName: string) {
    await this.nativeJavaSourceFileCreationSession().createJavaFile(fileName);
  },
);

When<StoryWorld>(
  "the person creates Java type {string} of kind {string} in package {string}",
  { timeout: 15_000 },
  async function (name: string, kind: string, packageName: string) {
    await this.nativeJavaSourceFileCreationSession().createJavaType(name, kind, packageName);
  },
);

Then<StoryWorld>(
  "the generated Java type opens as a selected unsaved draft and the disk file stays empty",
  { timeout: 15_000 },
  async function () {
    const evidence = this.nativeJavaSourceFileCreationSession().evidence();
    if (!evidence.generatedTypeIsSelectedDraft || !evidence.generatedTypeDiskStartsEmpty)
      throw new Error("the Java type wizard did not preserve draft and disk state");
  },
);

When<StoryWorld>(
  "the person saves the generated Java type",
  { timeout: 15_000 },
  async function () {
    await this.nativeJavaSourceFileCreationSession().saveGeneratedJavaType();
  },
);

Then<StoryWorld>(
  "the saved generated Java type compiles at its supported Java release",
  { timeout: 30_000 },
  async function () {
    await this.nativeJavaSourceFileCreationSession().compileGeneratedJavaType();
  },
);

Then<StoryWorld>(
  "the exact empty Java file exists and opens as the selected editor tab",
  { timeout: 15_000 },
  async function () {
    const evidence = this.nativeJavaSourceFileCreationSession().evidence();
    if (!evidence.exactEmptyFileCreated || !evidence.newEditorTabSelected)
      throw new Error("the new Java file was not created and opened in the native editor");
  },
);

When<StoryWorld>(
  "the person enters and saves a Java main class in the new editor",
  { timeout: 20_000 },
  async function () {
    await this.nativeJavaSourceFileCreationSession().enterAndSaveSource();
  },
);

Then<StoryWorld>(
  "the saved source matches the editor and compiles and runs with the host JDK",
  { timeout: 40_000 },
  async function () {
    await this.nativeJavaSourceFileCreationSession().compileAndRun();
  },
);

When<StoryWorld>(
  "the person closes the Java file-creation IDE",
  { timeout: 10_000 },
  async function () {
    await this.nativeJavaSourceFileCreationSession().close();
  },
);

Then<StoryWorld>(
  "the native executable exits and the workspace changes stay inside the scenario sandbox",
  { timeout: 15_000 },
  async function () {
    await this.nativeJavaSourceFileCreationSession().assertWorkspaceConfined();
  },
);
