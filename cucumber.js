const common = {
  paths: ["features/**/*.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
};

const targets = {
  unselected: { target: { name: "unselected", driver: "unselected" } },
  web: { target: { name: "web", driver: "playwright" } },
  desktop: { target: { name: "desktop", driver: "tauri" } },
};

const defaultProfile = {
  ...common,
  worldParameters: targets.unselected,
};

const declaredDiscovery = {
  ...common,
  dryRun: true,
  worldParameters: targets.unselected,
};

const implementedDiscovery = {
  ...common,
  dryRun: true,
  tags: "@implemented-and-validated",
  worldParameters: targets.unselected,
};

const implementedWeb = {
  ...common,
  tags: "@implemented-and-validated and @web and not @desktop",
  worldParameters: targets.web,
};

const implementedDesktop = {
  ...common,
  tags: "@implemented-and-validated and @desktop and not @web",
  worldParameters: targets.desktop,
};

const implementedDesktopTauriHarness = {
  ...common,
  tags: "@implemented-not-e2e-validated and @desktop and not @web",
  worldParameters: {
    ...targets.desktop,
    evidence: { kind: "tauri-harness", nativeGui: false, e2e: false },
  },
};

const web = {
  ...common,
  tags: "@web and not @desktop",
  worldParameters: targets.web,
};

const desktop = {
  ...common,
  tags: "@desktop and not @web",
  worldParameters: targets.desktop,
};

export {
  defaultProfile as default,
  declaredDiscovery,
  implementedDiscovery,
  implementedWeb,
  implementedDesktop,
  implementedDesktopTauriHarness,
  web,
  desktop,
};
