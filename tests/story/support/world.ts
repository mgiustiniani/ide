import { After, setWorldConstructor, World, type IWorldOptions } from "@cucumber/cucumber";

import {
  ApplicationContentLayoutSession,
  type ApplicationContentLayoutStorySession,
} from "./application-content-layout.js";
import { NativeApplicationContentLayoutSession } from "./native-application-content-layout.js";
import { NativeDesktopFileOpenSession } from "./native-desktop-file-open.js";
import { NativeRefactorKitJavaImportSession } from "./native-refactorkit-java-import.js";
import { RefactorKit062ProtocolFixture } from "./refactorkit-062-protocol-fixture.js";
import { RefactorKitJavaImportStorySession } from "./refactorkit-java-import.js";
import { SharedPanelLayoutHarness } from "./shared-panel-layout-harness.js";
import { StandaloneWebApp } from "./standalone-web-app.js";
import { Xcom2MachineSettingsHarness } from "./xcom2-machine-settings.js";
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
  #refactorKit062ProtocolFixture?: RefactorKit062ProtocolFixture;
  #refactorKitJavaImportSession?: RefactorKitJavaImportStorySession;
  #standaloneWebApp?: StandaloneWebApp;
  #xcom2MachineSettingsSession?: Xcom2MachineSettingsHarness;
  #xcom2MachineSettingsEvidenceAttached = false;

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
    const refactorKitFixture = this.#refactorKit062ProtocolFixture;
    const refactorKitJavaImportSession = this.#refactorKitJavaImportSession;
    const xcom2MachineSettingsSession = this.#xcom2MachineSettingsSession;
    this.#applicationContentLayoutSession = undefined;
    this.#desktopPanelLayoutHarness = undefined;
    this.#nativeApplicationContentLayoutSession = undefined;
    this.#nativeDesktopFileOpenSession = undefined;
    this.#nativeRefactorKitJavaImportSession = undefined;
    this.#standaloneWebApp = undefined;
    this.#refactorKit062ProtocolFixture = undefined;
    this.#refactorKitJavaImportSession = undefined;
    this.#xcom2MachineSettingsSession = undefined;
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
      await app?.dispose();
      await desktopPanelLayoutHarness?.dispose();
      await refactorKitFixture?.dispose();
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
    } finally {
      await this.targetProfileSeam.dispose();
    }
  }
}

setWorldConstructor(StoryWorld);

After<StoryWorld>({ timeout: 20_000 }, async function () {
  await this.dispose();
});
