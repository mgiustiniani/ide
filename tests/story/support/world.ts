import { After, setWorldConstructor, World, type IWorldOptions } from "@cucumber/cucumber";

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

  async dispose(): Promise<void> {
    const app = this.#standaloneWebApp;
    this.#standaloneWebApp = undefined;
    try {
      await app?.dispose();
    } finally {
      await this.targetProfileSeam.dispose();
    }
  }
}

setWorldConstructor(StoryWorld);

After<StoryWorld>({ timeout: 10_000 }, async function () {
  await this.dispose();
});
