import { After, setWorldConstructor, World, type IWorldOptions } from "@cucumber/cucumber";

import { ApplicationContentLayoutSession } from "./application-content-layout.js";
import { NativeDesktopFileOpenSession } from "./native-desktop-file-open.js";
import { RefactorKit062ProtocolFixture } from "./refactorkit-062-protocol-fixture.js";
import { SharedPanelLayoutHarness } from "./shared-panel-layout-harness.js";
import { StandaloneWebApp } from "./standalone-web-app.js";
import {
  createTargetProfileSeam,
  resolveTargetProfile,
  type StoryWorldParameters,
  type TargetProfile,
  type TargetProfileSeam,
} from "./target-profile.js";

export class StoryWorld extends World<StoryWorldParameters> {
  readonly targetProfile: TargetProfile;
  readonly targetProfileSeam: TargetProfileSeam;
  #applicationContentLayoutSession?: ApplicationContentLayoutSession;
  #desktopPanelLayoutHarness?: SharedPanelLayoutHarness;
  #nativeDesktopFileOpenSession?: NativeDesktopFileOpenSession;
  #nativeDesktopEvidenceAttached = false;
  #refactorKit062ProtocolFixture?: RefactorKit062ProtocolFixture;
  #standaloneWebApp?: StandaloneWebApp;

  constructor(options: IWorldOptions<StoryWorldParameters>) {
    super(options);

    this.targetProfile = resolveTargetProfile(options.parameters);
    this.targetProfileSeam = createTargetProfileSeam(this.targetProfile);
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

  async openDesktopApplicationContentLayoutHarness(): Promise<void> {
    if (this.targetProfile.name !== "desktop" || this.targetProfile.driver !== "tauri") {
      throw new TypeError(
        `The desktop layout Story requires the explicit desktop/tauri target, received ${this.targetProfile.name}/${this.targetProfile.driver}`,
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

  applicationContentLayoutSession(): ApplicationContentLayoutSession {
    if (!this.#applicationContentLayoutSession) {
      throw new Error("The application-content layout Story session has not been created");
    }
    return this.#applicationContentLayoutSession;
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

  async dispose(): Promise<void> {
    const app = this.#standaloneWebApp;
    const desktopPanelLayoutHarness = this.#desktopPanelLayoutHarness;
    const nativeDesktopFileOpenSession = this.#nativeDesktopFileOpenSession;
    const refactorKitFixture = this.#refactorKit062ProtocolFixture;
    this.#applicationContentLayoutSession = undefined;
    this.#desktopPanelLayoutHarness = undefined;
    this.#nativeDesktopFileOpenSession = undefined;
    this.#standaloneWebApp = undefined;
    this.#refactorKit062ProtocolFixture = undefined;
    try {
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
      await app?.dispose();
      await desktopPanelLayoutHarness?.dispose();
      await refactorKitFixture?.dispose();
    } finally {
      await this.targetProfileSeam.dispose();
    }
  }
}

setWorldConstructor(StoryWorld);

After<StoryWorld>({ timeout: 10_000 }, async function () {
  await this.dispose();
});
