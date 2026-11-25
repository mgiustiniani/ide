export const TARGET_PROFILES = {
  unselected: { name: "unselected", driver: "unselected" },
  web: { name: "web", driver: "playwright" },
  desktop: { name: "desktop", driver: "tauri" },
  desktopTauriWebdriver: { name: "desktop", driver: "tauri-webdriver" },
} as const;

export type TargetProfile = (typeof TARGET_PROFILES)[keyof typeof TARGET_PROFILES];

export interface StoryTargetEvidence {
  readonly kind: string;
  readonly nativeGui: boolean;
  readonly e2e: boolean;
  readonly packagedApplication: boolean;
  readonly artifactKind?: string;
}

export interface StoryWorldParameters {
  readonly target: TargetProfile;
  readonly evidence?: StoryTargetEvidence;
}

/**
 * Per-scenario lifecycle seam for the selected Story target.
 *
 * Real Playwright, Tauri harness, and tauri-webdriver sessions remain owned by
 * their Story support classes rather than placing driver state in the World.
 */
export interface TargetProfileSeam {
  readonly profile: TargetProfile;
  dispose(): Promise<void>;
}

class TargetProfileLifecycle implements TargetProfileSeam {
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
      if (profile === TARGET_PROFILES.desktopTauriWebdriver) {
        const evidence = parameters.evidence;
        const releaseNoBundle =
          evidence?.packagedApplication === false &&
          evidence?.artifactKind === "release-no-bundle";
        const appImage =
          evidence?.packagedApplication === true && evidence?.artifactKind === "appimage";
        if (
          evidence?.kind !== "tauri-webdriver" ||
          evidence?.nativeGui !== true ||
          evidence?.e2e !== true ||
          (!releaseNoBundle && !appImage)
        ) {
          throw new TypeError(
            "desktop/tauri-webdriver requires explicit nativeGui/e2e release-no-bundle or AppImage evidence",
          );
        }
      }
      return profile;
    }
  }

  throw new TypeError(
    `Unsupported Story target profile: ${configuredTarget.name}/${configuredTarget.driver}`,
  );
}

export function createTargetProfileSeam(profile: TargetProfile): TargetProfileSeam {
  return new TargetProfileLifecycle(profile);
}
