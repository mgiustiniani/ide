import { After, setWorldConstructor, World, type IWorldOptions } from "@cucumber/cucumber";

import { RefactorKit062ProtocolFixture } from "./refactorkit-062-protocol-fixture.js";
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

  async dispose(): Promise<void> {
    const app = this.#standaloneWebApp;
    const refactorKitFixture = this.#refactorKit062ProtocolFixture;
    this.#standaloneWebApp = undefined;
    this.#refactorKit062ProtocolFixture = undefined;
    try {
      await app?.dispose();
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
