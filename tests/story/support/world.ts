import { After, setWorldConstructor, World, type IWorldOptions } from "@cucumber/cucumber";

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

  constructor(options: IWorldOptions<StoryWorldParameters>) {
    super(options);

    this.targetProfile = resolveTargetProfile(options.parameters);
    this.targetProfileSeam = createTargetProfileSeam(this.targetProfile);
  }

  async dispose(): Promise<void> {
    await this.targetProfileSeam.dispose();
  }
}

setWorldConstructor(StoryWorld);

After<StoryWorld>(async function () {
  await this.dispose();
});
