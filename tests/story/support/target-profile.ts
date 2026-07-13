export const TARGET_PROFILES = {
  unselected: { name: "unselected", driver: "unselected" },
  web: { name: "web", driver: "playwright" },
  desktop: { name: "desktop", driver: "tauri" },
} as const;

export type TargetProfile = (typeof TARGET_PROFILES)[keyof typeof TARGET_PROFILES];

export interface StoryWorldParameters {
  readonly target: TargetProfile;
}

/**
 * Per-scenario seam for a future target-specific driver.
 *
 * The scaffold deliberately exposes no driver capability. A later Story slice
 * can replace this placeholder with an owned adapter without putting browser or
 * desktop state in the Cucumber World.
 */
export interface TargetProfileSeam {
  readonly profile: TargetProfile;
  dispose(): Promise<void>;
}

class TargetProfilePlaceholder implements TargetProfileSeam {
  readonly profile: TargetProfile;
  #disposed = false;

  constructor(profile: TargetProfile) {
    this.profile = profile;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
  }
}

export function resolveTargetProfile(parameters: StoryWorldParameters): TargetProfile {
  const configuredTarget = parameters.target;

  for (const profile of Object.values(TARGET_PROFILES)) {
    if (configuredTarget.name === profile.name && configuredTarget.driver === profile.driver) {
      return profile;
    }
  }

  throw new TypeError(
    `Unsupported Story target profile: ${configuredTarget.name}/${configuredTarget.driver}`,
  );
}

export function createTargetProfileSeam(profile: TargetProfile): TargetProfileSeam {
  return new TargetProfilePlaceholder(profile);
}
