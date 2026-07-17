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
  desktopTauriHarness: {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
    },
  },
  desktopTauriWebdriver: {
    target: { name: "desktop", driver: "tauri-webdriver" },
    evidence: {
      kind: "tauri-webdriver",
      nativeGui: true,
      e2e: true,
      packagedApplication: false,
      artifactKind: "release-no-bundle",
    },
  },
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
  worldParameters: targets.desktopTauriHarness,
};

const implementedDesktopTauriWebdriver = {
  ...common,
  tags: "@implemented-and-validated and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const desktopTauriWebdriver = {
  ...common,
  tags: "@implemented-and-validated and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const desktopFileOpenNativeGui = {
  ...common,
  tags: "@REQ-DESKTOP-FILE-OPEN-001 and @implemented-and-validated and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const refactorKitJavaImportNativeGui = {
  ...common,
  tags: "@REQ-REFACTORKIT-JAVA-IMPORT-002 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const desktopLayoutNativeGui = {
  ...common,
  tags: "@REQ-LAYOUT-DESKTOP-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const xcom2MachineSettingsTauriHarness = {
  ...common,
  tags: "@REQ-XCOM2-MACHINE-SETTINGS-001",
  worldParameters: targets.desktopTauriHarness,
};

const xcom2ModuleActivationNativeGui = {
  ...common,
  tags: "@REQ-XCOM2-MODULE-ACTIVATION-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const xcom2ModuleConfigurationActivationNativeGui = {
  ...common,
  tags: "@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const xcom2ModuleConfigurationDiagnosticsNativeGui = {
  ...common,
  tags: "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
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
  implementedDesktopTauriWebdriver,
  desktopTauriWebdriver,
  desktopFileOpenNativeGui,
  refactorKitJavaImportNativeGui,
  desktopLayoutNativeGui,
  xcom2MachineSettingsTauriHarness,
  xcom2ModuleActivationNativeGui,
  xcom2ModuleConfigurationActivationNativeGui,
  xcom2ModuleConfigurationDiagnosticsNativeGui,
  web,
  desktop,
};
