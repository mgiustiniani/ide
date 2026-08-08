import { After, setWorldConstructor, World, type IWorldOptions } from "@cucumber/cucumber";

import {
  ApplicationContentLayoutSession,
  type ApplicationContentLayoutStorySession,
} from "./application-content-layout.js";
import { NativeApplicationContentLayoutSession } from "./native-application-content-layout.js";
import { NativeDesktopFileOpenSession } from "./native-desktop-file-open.js";
import { NativeRefactorKitJavaImportSession } from "./native-refactorkit-java-import.js";
import { NativeXcom2MachineSettingsMissingSteamSession } from "./native-xcom2-machine-settings-missing-steam.js";
import { NativeXcom2ModuleActivationSession } from "./native-xcom2-module-activation.js";
import { NativeXcom2ModuleConfigurationActivationSession } from "./native-xcom2-module-configuration-activation.js";
import { NativeXcom2ModuleConfigurationDiagnosticsSession } from "./native-xcom2-module-configuration-diagnostics.js";
import { RefactorKit062ProtocolFixture } from "./refactorkit-062-protocol-fixture.js";
import { RefactorKit070SnapshotDiagnosticsFixture } from "./refactorkit-070-snapshot-diagnostics-fixture.js";
import { RefactorKit070SnapshotProtocolFixture } from "./refactorkit-070-snapshot-protocol-fixture.js";
import { RefactorKitJavaImportStorySession } from "./refactorkit-java-import.js";
import { SharedPanelLayoutHarness } from "./shared-panel-layout-harness.js";
import { StandaloneWebApp } from "./standalone-web-app.js";
import { Xcom2MachineSettingsHarness } from "./xcom2-machine-settings.js";
import { Xcom2ProjectFoundryHarness } from "./xcom2-project-foundry.js";
import {
  createTargetProfileSeam,
  resolveTargetProfile,
  type StoryTargetEvidence,
  type StoryWorldParameters,
  type TargetProfile,
  type TargetProfileSeam,
} from "./target-profile.js";

export class StoryWorld extends World<StoryWorldParameters> {
  readonly targetProfile: TargetProfile;
  readonly targetProfileSeam: TargetProfileSeam;
  readonly targetEvidence?: StoryTargetEvidence;
  #applicationContentLayoutSession?: ApplicationContentLayoutStorySession;
  #applicationContentLayoutEvidenceAttached = false;
  #desktopPanelLayoutHarness?: SharedPanelLayoutHarness;
  #nativeApplicationContentLayoutSession?: NativeApplicationContentLayoutSession;
  #nativeDesktopFileOpenSession?: NativeDesktopFileOpenSession;
  #nativeDesktopEvidenceAttached = false;
  #nativeRefactorKitJavaImportSession?: NativeRefactorKitJavaImportSession;
  #nativeRefactorKitJavaImportEvidenceAttached = false;
  #nativeXcom2MachineSettingsMissingSteamSession?: NativeXcom2MachineSettingsMissingSteamSession;
  #nativeXcom2MachineSettingsMissingSteamEvidenceAttached = false;
  #nativeXcom2ModuleActivationSession?: NativeXcom2ModuleActivationSession;
  #nativeXcom2ModuleActivationEvidenceAttached = false;
  #nativeXcom2ModuleConfigurationActivationSession?: NativeXcom2ModuleConfigurationActivationSession;
  #nativeXcom2ModuleConfigurationActivationEvidenceAttached = false;
  #nativeXcom2ModuleConfigurationDiagnosticsSession?: NativeXcom2ModuleConfigurationDiagnosticsSession;
  #nativeXcom2ModuleConfigurationDiagnosticsEvidenceAttached = false;
  #refactorKit062ProtocolFixture?: RefactorKit062ProtocolFixture;
  #refactorKit070SnapshotDiagnosticsFixture?: RefactorKit070SnapshotDiagnosticsFixture;
  #refactorKit070SnapshotProtocolFixture?: RefactorKit070SnapshotProtocolFixture;
  #refactorKitJavaImportSession?: RefactorKitJavaImportStorySession;
  #standaloneWebApp?: StandaloneWebApp;
  #xcom2MachineSettingsSession?: Xcom2MachineSettingsHarness;
  #xcom2MachineSettingsEvidenceAttached = false;
  #xcom2ProjectFoundrySession?: Xcom2ProjectFoundryHarness;

  constructor(options: IWorldOptions<StoryWorldParameters>) {
    super(options);

    this.targetProfile = resolveTargetProfile(options.parameters);
    this.targetProfileSeam = createTargetProfileSeam(this.targetProfile);
    this.targetEvidence = options.parameters.evidence;
  }

  async startStandaloneWebApp(): Promise<void> {
    if (this.targetProfile.name !== "web" || this.targetProfile.driver !== "playwright") {
      throw new TypeError(
        `The standalone web Story requires the explicit web/playwright target, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (this.#standaloneWebApp) {
      throw new Error("The standalone web Story application has already been created");
    }

    const app = new StandaloneWebApp();
    this.#standaloneWebApp = app;
    await app.start();
  }

  standaloneWebApp(): StandaloneWebApp {
    if (!this.#standaloneWebApp) {
      throw new Error("The standalone web Story application has not been created");
    }
    return this.#standaloneWebApp;
  }

  async openWebApplicationContentLayout(): Promise<void> {
    await this.startStandaloneWebApp();
    const app = this.standaloneWebApp();
    await app.waitUntilReady();
    this.#applicationContentLayoutSession = new ApplicationContentLayoutSession(app.page(), {
      target: "web/playwright",
      nativeGui: false,
      e2e: true,
      rendering: "standalone web application through its real Vite entrypoint",
    });
  }

  async openDesktopApplicationContentLayout(): Promise<void> {
    if (this.targetProfile.name !== "desktop") {
      throw new TypeError(
        `The desktop layout Story requires an explicit desktop target, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (this.targetProfile.driver === "tauri") {
      await this.openDesktopApplicationContentLayoutHarness();
      return;
    }
    if (this.targetProfile.driver === "tauri-webdriver") {
      if (this.#nativeApplicationContentLayoutSession) {
        throw new Error("The native desktop layout Story session has already been created");
      }
      const session = new NativeApplicationContentLayoutSession();
      this.#nativeApplicationContentLayoutSession = session;
      await session.launch();
      this.#applicationContentLayoutSession = session;
      return;
    }
    throw new TypeError("The desktop layout Story received an unsupported desktop driver");
  }

  async openDesktopApplicationContentLayoutHarness(): Promise<void> {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri") {
      throw new TypeError(
        `The desktop layout harness requires the explicit desktop/tauri target, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (this.#desktopPanelLayoutHarness) {
      throw new Error("The desktop PanelLayout Story harness has already been created");
    }

    const harness = new SharedPanelLayoutHarness();
    this.#desktopPanelLayoutHarness = harness;
    await harness.start();
    this.#applicationContentLayoutSession = harness.layoutSession();
  }

  applicationContentLayoutSession(): ApplicationContentLayoutStorySession {
    if (!this.#applicationContentLayoutSession) {
      throw new Error("The application-content layout Story session has not been created");
    }
    return this.#applicationContentLayoutSession;
  }

  async attachApplicationContentLayoutEvidence(): Promise<void> {
    if (this.#applicationContentLayoutEvidenceAttached) return;
    const session = this.applicationContentLayoutSession();
    await this.attach(JSON.stringify(session.evidence()), "application/json");
    if (this.#nativeApplicationContentLayoutSession) {
      const diagnostics = this.#nativeApplicationContentLayoutSession.redactedDiagnostics();
      if (diagnostics) await this.attach(diagnostics, "text/plain");
    }
    this.#applicationContentLayoutEvidenceAttached = true;
  }

  startRefactorKit062ProtocolFixture(): void {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri") {
      throw new TypeError(
        `The RefactorKit desktop Story requires the explicit desktop/tauri target, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (this.#refactorKit062ProtocolFixture) {
      throw new Error("The RefactorKit 0.6.2 Story fixture has already been created");
    }
    this.#refactorKit062ProtocolFixture = new RefactorKit062ProtocolFixture();
  }

  refactorKit062ProtocolFixture(): RefactorKit062ProtocolFixture {
    if (!this.#refactorKit062ProtocolFixture) {
      throw new Error("The RefactorKit 0.6.2 Story fixture has not been created");
    }
    return this.#refactorKit062ProtocolFixture;
  }

  startRefactorKit070SnapshotDiagnosticsFixture(): void {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri") {
      throw new TypeError(
        `The RefactorKit diagnostics Story requires the explicit desktop/tauri target, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (
      this.targetEvidence?.kind !== "tauri-harness" ||
      this.targetEvidence.nativeGui !== false ||
      this.targetEvidence.e2e !== false ||
      this.targetEvidence.packagedApplication !== false
    ) {
      throw new TypeError(
        "The RefactorKit diagnostics Story requires explicit deterministic tauri-harness evidence",
      );
    }
    if (this.#refactorKit070SnapshotDiagnosticsFixture) {
      throw new Error(
        "The RefactorKit 0.7.0-SNAPSHOT diagnostics Story fixture has already been created",
      );
    }
    this.#refactorKit070SnapshotDiagnosticsFixture = new RefactorKit070SnapshotDiagnosticsFixture();
  }

  refactorKit070SnapshotDiagnosticsFixture(): RefactorKit070SnapshotDiagnosticsFixture {
    if (!this.#refactorKit070SnapshotDiagnosticsFixture) {
      throw new Error(
        "The RefactorKit 0.7.0-SNAPSHOT diagnostics Story fixture has not been created",
      );
    }
    return this.#refactorKit070SnapshotDiagnosticsFixture;
  }

  startRefactorKit070SnapshotProtocolFixture(): void {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri") {
      throw new TypeError(
        `The RefactorKit desktop Story requires the explicit desktop/tauri target, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (this.#refactorKit070SnapshotProtocolFixture) {
      throw new Error("The RefactorKit 0.7.0-SNAPSHOT Story fixture has already been created");
    }
    this.#refactorKit070SnapshotProtocolFixture = new RefactorKit070SnapshotProtocolFixture();
  }

  refactorKit070SnapshotProtocolFixture(): RefactorKit070SnapshotProtocolFixture {
    if (!this.#refactorKit070SnapshotProtocolFixture) {
      throw new Error("The RefactorKit 0.7.0-SNAPSHOT Story fixture has not been created");
    }
    return this.#refactorKit070SnapshotProtocolFixture;
  }

  async createRefactorKitJavaImportSession(workspaceName: string): Promise<void> {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri") {
      throw new TypeError(
        `The RefactorKit Java-import Story requires desktop/tauri, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (
      this.targetEvidence?.kind !== "tauri-harness" ||
      this.targetEvidence.nativeGui !== false ||
      this.targetEvidence.e2e !== false ||
      this.targetEvidence.packagedApplication !== false
    ) {
      throw new TypeError(
        "The RefactorKit Java-import Story requires explicit deterministic tauri-harness evidence",
      );
    }
    if (this.#refactorKitJavaImportSession) {
      throw new Error("The RefactorKit Java-import Story session has already been created");
    }
    const session = new RefactorKitJavaImportStorySession();
    this.#refactorKitJavaImportSession = session;
    await session.createPrimary(workspaceName);
  }

  refactorKitJavaImportSession(): RefactorKitJavaImportStorySession {
    if (!this.#refactorKitJavaImportSession) {
      throw new Error("The RefactorKit Java-import Story session has not been created");
    }
    return this.#refactorKitJavaImportSession;
  }

  async createXcom2MachineSettingsSession(workspaceName: string): Promise<void> {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri") {
      throw new TypeError(
        `The XCOM machine Settings Story requires desktop/tauri, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (
      this.targetEvidence?.kind !== "tauri-harness" ||
      this.targetEvidence.nativeGui !== false ||
      this.targetEvidence.e2e !== false ||
      this.targetEvidence.packagedApplication !== false
    ) {
      throw new TypeError(
        "The XCOM machine Settings Story requires explicit non-native, non-E2E tauri-harness evidence",
      );
    }
    if (this.#xcom2MachineSettingsSession) {
      throw new Error("The XCOM machine Settings Story session has already been created");
    }
    const session = new Xcom2MachineSettingsHarness(workspaceName);
    this.#xcom2MachineSettingsSession = session;
    await session.start();
  }

  xcom2MachineSettingsSession(): Xcom2MachineSettingsHarness {
    if (!this.#xcom2MachineSettingsSession) {
      throw new Error("The XCOM machine Settings Story session has not been created");
    }
    return this.#xcom2MachineSettingsSession;
  }

  async createXcom2ProjectFoundrySession(): Promise<void> {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri") {
      throw new TypeError(
        `The Project Foundry Story requires desktop/tauri, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (
      this.targetEvidence?.kind !== "tauri-harness" ||
      this.targetEvidence.nativeGui !== false ||
      this.targetEvidence.e2e !== false ||
      this.targetEvidence.packagedApplication !== false
    ) {
      throw new TypeError(
        "The Project Foundry Story requires explicit non-native, non-E2E tauri-harness evidence",
      );
    }
    if (this.#xcom2ProjectFoundrySession) {
      throw new Error("The Project Foundry Story session has already been created");
    }
    const session = new Xcom2ProjectFoundryHarness();
    this.#xcom2ProjectFoundrySession = session;
    await session.start();
  }

  xcom2ProjectFoundrySession(): Xcom2ProjectFoundryHarness {
    if (!this.#xcom2ProjectFoundrySession) {
      throw new Error("The Project Foundry Story session has not been created");
    }
    return this.#xcom2ProjectFoundrySession;
  }

  createNativeDesktopFileOpenSession(): NativeDesktopFileOpenSession {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri-webdriver") {
      throw new TypeError(
        `The native file-open Story requires desktop/tauri-webdriver, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (this.#nativeDesktopFileOpenSession) {
      throw new Error("The native desktop file-open Story session has already been created");
    }
    const session = new NativeDesktopFileOpenSession();
    this.#nativeDesktopFileOpenSession = session;
    return session;
  }

  nativeDesktopFileOpenSession(): NativeDesktopFileOpenSession {
    if (!this.#nativeDesktopFileOpenSession) {
      throw new Error("The native desktop file-open Story session has not been created");
    }
    return this.#nativeDesktopFileOpenSession;
  }

  async attachNativeDesktopEvidence(): Promise<void> {
    if (this.#nativeDesktopEvidenceAttached) return;
    const session = this.nativeDesktopFileOpenSession();
    await this.attach(JSON.stringify(session.evidence()), "application/json");
    const diagnostics = session.redactedDiagnostics();
    if (diagnostics) await this.attach(diagnostics, "text/plain");
    this.#nativeDesktopEvidenceAttached = true;
  }

  createNativeXcom2MachineSettingsMissingSteamSession(): NativeXcom2MachineSettingsMissingSteamSession {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri-webdriver") {
      throw new TypeError(
        `The native missing-Steam Settings Story requires desktop/tauri-webdriver, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (
      this.targetEvidence?.kind !== "tauri-webdriver" ||
      this.targetEvidence.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    ) {
      throw new TypeError(
        "The native missing-Steam Settings Story requires explicit release/no-bundle tauri-webdriver evidence",
      );
    }
    if (this.#nativeXcom2MachineSettingsMissingSteamSession) {
      throw new Error("The native missing-Steam Settings Story session has already been created");
    }
    const session = new NativeXcom2MachineSettingsMissingSteamSession();
    this.#nativeXcom2MachineSettingsMissingSteamSession = session;
    return session;
  }

  nativeXcom2MachineSettingsMissingSteamSession(): NativeXcom2MachineSettingsMissingSteamSession {
    if (!this.#nativeXcom2MachineSettingsMissingSteamSession) {
      throw new Error("The native missing-Steam Settings Story session has not been created");
    }
    return this.#nativeXcom2MachineSettingsMissingSteamSession;
  }

  hasNativeXcom2MachineSettingsMissingSteamSession(): boolean {
    return this.#nativeXcom2MachineSettingsMissingSteamSession !== undefined;
  }

  async attachNativeXcom2MachineSettingsMissingSteamEvidence(): Promise<void> {
    if (this.#nativeXcom2MachineSettingsMissingSteamEvidenceAttached) return;
    const session = this.nativeXcom2MachineSettingsMissingSteamSession();
    await this.attach(JSON.stringify(session.evidence()), "application/json");
    const diagnostics = session.redactedDiagnostics();
    if (diagnostics) await this.attach(diagnostics, "text/plain");
    this.#nativeXcom2MachineSettingsMissingSteamEvidenceAttached = true;
  }

  async assertNativeExecutableExited(): Promise<void> {
    if (this.#nativeXcom2MachineSettingsMissingSteamSession) {
      await this.#nativeXcom2MachineSettingsMissingSteamSession.assertExecutableExited();
      return;
    }
    await this.nativeDesktopFileOpenSession().assertExecutableExited();
  }

  createNativeXcom2ModuleActivationSession(): NativeXcom2ModuleActivationSession {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri-webdriver") {
      throw new TypeError(
        `The native XCOM module activation Story requires desktop/tauri-webdriver, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (
      this.targetEvidence?.kind !== "tauri-webdriver" ||
      this.targetEvidence.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    ) {
      throw new TypeError(
        "The native XCOM module activation Story requires explicit release/no-bundle tauri-webdriver evidence",
      );
    }
    if (this.#nativeXcom2ModuleActivationSession) {
      throw new Error("The native XCOM module activation Story session has already been created");
    }
    const session = new NativeXcom2ModuleActivationSession();
    this.#nativeXcom2ModuleActivationSession = session;
    return session;
  }

  nativeXcom2ModuleActivationSession(): NativeXcom2ModuleActivationSession {
    if (!this.#nativeXcom2ModuleActivationSession) {
      throw new Error("The native XCOM module activation Story session has not been created");
    }
    return this.#nativeXcom2ModuleActivationSession;
  }

  nativeXcom2ActivationSession():
    | NativeXcom2ModuleActivationSession
    | NativeXcom2ModuleConfigurationActivationSession
    | NativeXcom2ModuleConfigurationDiagnosticsSession {
    const session =
      this.#nativeXcom2ModuleActivationSession ??
      this.#nativeXcom2ModuleConfigurationActivationSession ??
      this.#nativeXcom2ModuleConfigurationDiagnosticsSession;
    if (!session) {
      throw new Error("A native XCOM activation Story session has not been created");
    }
    return session;
  }

  async attachNativeXcom2ModuleActivationEvidence(): Promise<void> {
    if (this.#nativeXcom2ModuleActivationEvidenceAttached) return;
    const session = this.nativeXcom2ModuleActivationSession();
    await this.attach(JSON.stringify(session.evidence()), "application/json");
    this.#nativeXcom2ModuleActivationEvidenceAttached = true;
  }

  createNativeXcom2ModuleConfigurationActivationSession(): NativeXcom2ModuleConfigurationActivationSession {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri-webdriver") {
      throw new TypeError(
        `The native configured XCOM Story requires desktop/tauri-webdriver, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (
      this.targetEvidence?.kind !== "tauri-webdriver" ||
      this.targetEvidence.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    ) {
      throw new TypeError(
        "The native configured XCOM Story requires explicit release/no-bundle tauri-webdriver evidence",
      );
    }
    if (
      this.#nativeXcom2ModuleConfigurationActivationSession ||
      this.#nativeXcom2ModuleConfigurationDiagnosticsSession ||
      this.#nativeXcom2ModuleActivationSession
    ) {
      throw new Error("A native XCOM activation Story session has already been created");
    }
    const session = new NativeXcom2ModuleConfigurationActivationSession();
    this.#nativeXcom2ModuleConfigurationActivationSession = session;
    return session;
  }

  nativeXcom2ModuleConfigurationActivationSession(): NativeXcom2ModuleConfigurationActivationSession {
    if (!this.#nativeXcom2ModuleConfigurationActivationSession) {
      throw new Error("The native configured XCOM Story session has not been created");
    }
    return this.#nativeXcom2ModuleConfigurationActivationSession;
  }

  hasNativeXcom2ModuleConfigurationActivationSession(): boolean {
    return this.#nativeXcom2ModuleConfigurationActivationSession !== undefined;
  }

  async attachNativeXcom2ModuleConfigurationActivationEvidence(): Promise<void> {
    if (this.#nativeXcom2ModuleConfigurationActivationEvidenceAttached) return;
    await this.attach(
      JSON.stringify(this.nativeXcom2ModuleConfigurationActivationSession().evidence()),
      "application/json",
    );
    this.#nativeXcom2ModuleConfigurationActivationEvidenceAttached = true;
  }

  createNativeXcom2ModuleConfigurationDiagnosticsSession(): NativeXcom2ModuleConfigurationDiagnosticsSession {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri-webdriver") {
      throw new TypeError(
        `The native XCOM configuration diagnostics Story requires desktop/tauri-webdriver, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (
      this.targetEvidence?.kind !== "tauri-webdriver" ||
      this.targetEvidence.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    ) {
      throw new TypeError(
        "The native XCOM configuration diagnostics Story requires explicit release/no-bundle tauri-webdriver evidence",
      );
    }
    if (
      this.#nativeXcom2ModuleActivationSession ||
      this.#nativeXcom2ModuleConfigurationActivationSession ||
      this.#nativeXcom2ModuleConfigurationDiagnosticsSession
    ) {
      throw new Error("A native XCOM activation Story session has already been created");
    }
    const session = new NativeXcom2ModuleConfigurationDiagnosticsSession();
    this.#nativeXcom2ModuleConfigurationDiagnosticsSession = session;
    return session;
  }

  nativeXcom2ModuleConfigurationDiagnosticsSession(): NativeXcom2ModuleConfigurationDiagnosticsSession {
    if (!this.#nativeXcom2ModuleConfigurationDiagnosticsSession) {
      throw new Error(
        "The native XCOM configuration diagnostics Story session has not been created",
      );
    }
    return this.#nativeXcom2ModuleConfigurationDiagnosticsSession;
  }

  hasNativeXcom2ModuleConfigurationDiagnosticsSession(): boolean {
    return this.#nativeXcom2ModuleConfigurationDiagnosticsSession !== undefined;
  }

  async attachNativeXcom2ModuleConfigurationDiagnosticsEvidence(): Promise<void> {
    if (this.#nativeXcom2ModuleConfigurationDiagnosticsEvidenceAttached) return;
    await this.attach(
      JSON.stringify(this.nativeXcom2ModuleConfigurationDiagnosticsSession().evidence()),
      "application/json",
    );
    this.#nativeXcom2ModuleConfigurationDiagnosticsEvidenceAttached = true;
  }

  createNativeRefactorKitJavaImportSession(): NativeRefactorKitJavaImportSession {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri-webdriver") {
      throw new TypeError(
        `The native RefactorKit Java-import Story requires desktop/tauri-webdriver, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
      );
    }
    if (this.#nativeRefactorKitJavaImportSession) {
      throw new Error("The native RefactorKit Java-import Story session has already been created");
    }
    const session = new NativeRefactorKitJavaImportSession();
    this.#nativeRefactorKitJavaImportSession = session;
    return session;
  }

  nativeRefactorKitJavaImportSession(): NativeRefactorKitJavaImportSession {
    if (!this.#nativeRefactorKitJavaImportSession) {
      throw new Error("The native RefactorKit Java-import Story session has not been created");
    }
    return this.#nativeRefactorKitJavaImportSession;
  }

  async attachNativeRefactorKitJavaImportEvidence(): Promise<void> {
    if (this.#nativeRefactorKitJavaImportEvidenceAttached) return;
    const session = this.nativeRefactorKitJavaImportSession();
    await this.attach(JSON.stringify(session.evidence()), "application/json");
    const diagnostics = session.redactedDiagnostics();
    if (diagnostics) await this.attach(diagnostics, "text/plain");
    this.#nativeRefactorKitJavaImportEvidenceAttached = true;
  }

  async dispose(): Promise<void> {
    const app = this.#standaloneWebApp;
    const desktopPanelLayoutHarness = this.#desktopPanelLayoutHarness;
    const nativeApplicationContentLayoutSession = this.#nativeApplicationContentLayoutSession;
    const nativeDesktopFileOpenSession = this.#nativeDesktopFileOpenSession;
    const nativeRefactorKitJavaImportSession = this.#nativeRefactorKitJavaImportSession;
    const nativeXcom2MachineSettingsMissingSteamSession =
      this.#nativeXcom2MachineSettingsMissingSteamSession;
    const nativeXcom2ModuleActivationSession = this.#nativeXcom2ModuleActivationSession;
    const nativeXcom2ModuleConfigurationActivationSession =
      this.#nativeXcom2ModuleConfigurationActivationSession;
    const nativeXcom2ModuleConfigurationDiagnosticsSession =
      this.#nativeXcom2ModuleConfigurationDiagnosticsSession;
    const refactorKitFixture = this.#refactorKit062ProtocolFixture;
    const refactorKit070SnapshotDiagnosticsFixture = this.#refactorKit070SnapshotDiagnosticsFixture;
    const refactorKit070SnapshotProtocolFixture = this.#refactorKit070SnapshotProtocolFixture;
    const refactorKitJavaImportSession = this.#refactorKitJavaImportSession;
    const xcom2MachineSettingsSession = this.#xcom2MachineSettingsSession;
    const xcom2ProjectFoundrySession = this.#xcom2ProjectFoundrySession;
    this.#applicationContentLayoutSession = undefined;
    this.#desktopPanelLayoutHarness = undefined;
    this.#nativeApplicationContentLayoutSession = undefined;
    this.#nativeDesktopFileOpenSession = undefined;
    this.#nativeRefactorKitJavaImportSession = undefined;
    this.#nativeXcom2MachineSettingsMissingSteamSession = undefined;
    this.#nativeXcom2ModuleActivationSession = undefined;
    this.#nativeXcom2ModuleConfigurationActivationSession = undefined;
    this.#nativeXcom2ModuleConfigurationDiagnosticsSession = undefined;
    this.#standaloneWebApp = undefined;
    this.#refactorKit062ProtocolFixture = undefined;
    this.#refactorKit070SnapshotDiagnosticsFixture = undefined;
    this.#refactorKit070SnapshotProtocolFixture = undefined;
    this.#refactorKitJavaImportSession = undefined;
    this.#xcom2MachineSettingsSession = undefined;
    this.#xcom2ProjectFoundrySession = undefined;
    try {
      if (nativeApplicationContentLayoutSession) {
        try {
          if (!this.#applicationContentLayoutEvidenceAttached) {
            await this.attach(
              JSON.stringify(nativeApplicationContentLayoutSession.evidence()),
              "application/json",
            );
            const diagnostics = nativeApplicationContentLayoutSession.redactedDiagnostics();
            if (diagnostics) await this.attach(diagnostics, "text/plain");
          }
        } finally {
          await nativeApplicationContentLayoutSession.dispose();
        }
      }
      if (nativeDesktopFileOpenSession) {
        try {
          if (!this.#nativeDesktopEvidenceAttached) {
            await this.attach(
              JSON.stringify(nativeDesktopFileOpenSession.evidence()),
              "application/json",
            );
            const diagnostics = nativeDesktopFileOpenSession.redactedDiagnostics();
            if (diagnostics) await this.attach(diagnostics, "text/plain");
          }
        } finally {
          await nativeDesktopFileOpenSession.dispose();
        }
      }
      if (nativeRefactorKitJavaImportSession) {
        try {
          if (!this.#nativeRefactorKitJavaImportEvidenceAttached) {
            await this.attach(
              JSON.stringify(nativeRefactorKitJavaImportSession.evidence()),
              "application/json",
            );
            const diagnostics = nativeRefactorKitJavaImportSession.redactedDiagnostics();
            if (diagnostics) await this.attach(diagnostics, "text/plain");
          }
        } finally {
          await nativeRefactorKitJavaImportSession.dispose();
        }
      }
      if (nativeXcom2MachineSettingsMissingSteamSession) {
        await nativeXcom2MachineSettingsMissingSteamSession.dispose();
        if (!this.#nativeXcom2MachineSettingsMissingSteamEvidenceAttached) {
          await this.attach(
            JSON.stringify(nativeXcom2MachineSettingsMissingSteamSession.evidence()),
            "application/json",
          );
          const diagnostics = nativeXcom2MachineSettingsMissingSteamSession.redactedDiagnostics();
          if (diagnostics) await this.attach(diagnostics, "text/plain");
          this.#nativeXcom2MachineSettingsMissingSteamEvidenceAttached = true;
        }
      }
      if (nativeXcom2ModuleActivationSession) {
        try {
          if (!this.#nativeXcom2ModuleActivationEvidenceAttached) {
            await this.attach(
              JSON.stringify(nativeXcom2ModuleActivationSession.evidence()),
              "application/json",
            );
          }
        } finally {
          await nativeXcom2ModuleActivationSession.dispose();
          await this.attach(
            JSON.stringify(nativeXcom2ModuleActivationSession.evidence()),
            "application/json",
          );
          const diagnostics = nativeXcom2ModuleActivationSession.redactedDiagnostics();
          if (diagnostics) await this.attach(diagnostics, "text/plain");
        }
      }
      if (nativeXcom2ModuleConfigurationActivationSession) {
        try {
          if (!this.#nativeXcom2ModuleConfigurationActivationEvidenceAttached) {
            await this.attach(
              JSON.stringify(nativeXcom2ModuleConfigurationActivationSession.evidence()),
              "application/json",
            );
          }
        } finally {
          await nativeXcom2ModuleConfigurationActivationSession.dispose();
          await this.attach(
            JSON.stringify(nativeXcom2ModuleConfigurationActivationSession.evidence()),
            "application/json",
          );
          const diagnostics = nativeXcom2ModuleConfigurationActivationSession.redactedDiagnostics();
          if (diagnostics) await this.attach(diagnostics, "text/plain");
        }
      }
      if (nativeXcom2ModuleConfigurationDiagnosticsSession) {
        await nativeXcom2ModuleConfigurationDiagnosticsSession.dispose();
        if (!this.#nativeXcom2ModuleConfigurationDiagnosticsEvidenceAttached) {
          await this.attach(
            JSON.stringify(nativeXcom2ModuleConfigurationDiagnosticsSession.evidence()),
            "application/json",
          );
          const diagnostics =
            nativeXcom2ModuleConfigurationDiagnosticsSession.redactedDiagnostics();
          if (diagnostics) await this.attach(diagnostics, "text/plain");
          this.#nativeXcom2ModuleConfigurationDiagnosticsEvidenceAttached = true;
        }
      }
      await app?.dispose();
      await desktopPanelLayoutHarness?.dispose();
      await refactorKitFixture?.dispose();
      await refactorKit070SnapshotDiagnosticsFixture?.dispose();
      await refactorKit070SnapshotProtocolFixture?.dispose();
      await refactorKitJavaImportSession?.dispose();
      if (xcom2MachineSettingsSession) {
        try {
          if (!this.#xcom2MachineSettingsEvidenceAttached) {
            await this.attach(
              JSON.stringify(xcom2MachineSettingsSession.evidence()),
              "application/json",
            );
            this.#xcom2MachineSettingsEvidenceAttached = true;
          }
        } finally {
          await xcom2MachineSettingsSession.dispose();
        }
      }
      if (xcom2ProjectFoundrySession) {
        try {
          await this.attach(
            JSON.stringify(xcom2ProjectFoundrySession.evidence()),
            "application/json",
          );
        } finally {
          await xcom2ProjectFoundrySession.dispose();
        }
      }
    } finally {
      await this.targetProfileSeam.dispose();
    }
  }
}

setWorldConstructor(StoryWorld);

After<StoryWorld>({ timeout: 20_000 }, async function () {
  await this.dispose();
});
