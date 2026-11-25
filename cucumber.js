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
  desktopTauriAppImageWebdriver: {
    target: { name: "desktop", driver: "tauri-webdriver" },
    evidence: {
      kind: "tauri-webdriver",
      nativeGui: true,
      e2e: true,
      packagedApplication: true,
      artifactKind: "appimage",
    },
  },
  // Focused IDE-packaging profile: the ide-packaging.ts driver genuinely
  // launches the real release AppImage, detects the native x11 window, closes
  // it, and scans for zero survivors, so this desktop/tauri harness route is
  // native-capable, E2E, and validates the packaged application. Mirrors the
  // nativeGui/e2e/packagedApplication flag pattern of the desktop/tauri-
  // webdriver native profiles while keeping the AppImage-harness driver.
  idePackagingTauriHarness: {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: true,
      e2e: true,
      packagedApplication: true,
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
  tags: "@implemented-and-validated and @desktop and @native-gui and not @web and not @packaging",
  worldParameters: targets.desktopTauriWebdriver,
};

const desktopTauriWebdriver = {
  ...common,
  tags: "@implemented-and-validated and @desktop and @native-gui and not @web and not @packaging",
  worldParameters: targets.desktopTauriWebdriver,
};

const desktopFileOpenNativeGui = {
  ...common,
  tags: "@REQ-DESKTOP-FILE-OPEN-001 and @implemented-and-validated and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaSourceFileCreationNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaLargePackageAppImageNativeGui = {
  ...javaSourceFileCreationNativeGui,
  tags: `${javaSourceFileCreationNativeGui.tags} and @native-java-large-package`,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const desktopStartupResponsivenessNativeGui = {
  ...common,
  tags: "@REQ-IDE-STARTUP-RESPONSIVENESS-NATIVE-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const editorCloseGuardsNativeGui = {
  ...common,
  tags: "@REQ-IDE-EDITOR-CLOSE-GUARDS-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaExecutionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-jdk and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaFlightRecorderNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-jfr and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaFlightRecorderAppImageNativeGui = {
  ...javaFlightRecorderNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaBuildToolsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-build-tools and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaFailsafeReactorNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-failsafe-reactor and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaFailsafeReactorAppImageNativeGui = {
  ...javaFailsafeReactorNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const workspaceTerminalNativeGui = {
  ...common,
  tags: "@REQ-IDE-WORKSPACE-TERMINAL-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaDebuggerNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-debugger and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaDebuggerAppImageNativeGui = {
  ...javaDebuggerNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};
const javaJdiDebuggerNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-jdi-debugger and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaJdiDebuggerAppImageNativeGui = {
  ...javaJdiDebuggerNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};
const javaJdiRunToCursorNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-run-to-cursor and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaClassChangeReviewNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-class-change-review and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaDropFrameNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-drop-frame and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaRestartExecutionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-restart-session and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaExecutionCommandsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-execution-commands and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaTestJvmNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-test-jvm-options and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaCoverageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-coverage and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaCoverageAppImageNativeGui = {
  ...javaCoverageNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaConditionalDebuggerNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-conditional-debugger and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaConditionalDebuggerAppImageNativeGui = {
  ...javaConditionalDebuggerNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaExceptionBreakpointsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-exception-breakpoints and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaAttachDebuggerNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-jdi-attach and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaFileOperationsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-FILE-OPERATIONS-NATIVE-001 and @native-java-file-operations and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaTestDiscoveryNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-test-discovery and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaTestNgDiscoveryNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-testng-discovery and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaJupiterTestExecutionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-junit5-test-execution and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaTestNgTestExecutionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-testng-test-execution and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaApplicationInputNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-application-input and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaWorkingDirectoryNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-working-directory and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const java8MavenRunNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java8-maven-run and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java8MavenRunAppImageNativeGui = {
  ...java8MavenRunNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};

const javaCompilerAndSourceCreationAppImageNativeGui = {
  ...common,
  tags: "(@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001 or (@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and (@native-java-jdk or @native-java-build-tools or @native-java-application-input)) or (@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and (@native-java-project-execution or @native-java-gradle-project-execution))) and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};

const javaPlainJdkTestNgNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-EXECUTION-NATIVE-001 and @native-java-plain-jdk-testng and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaPlainJdkTestNgAppImageNativeGui = {
  ...javaPlainJdkTestNgNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};

const editorRecoveryNativeGui = {
  ...common,
  tags: "@REQ-IDE-EDITOR-RECOVERY-001 and @native-recovery-restart and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const editorExternalChangesNativeGui = {
  ...common,
  tags: "@REQ-IDE-EDITOR-EXTERNAL-CHANGES-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const editorDiskComparisonNativeGui = {
  ...common,
  tags: "@REQ-IDE-EDITOR-DISK-COMPARISON-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const editorRecoveryHistoryNativeGui = {
  ...common,
  tags: "@REQ-IDE-EDITOR-RECOVERY-001 and @native-recovery-history and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const editorStorageFullNativeGui = {
  ...common,
  tags: "@native-editor-storage-full and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const editorRecoveryCapacityCorruptionNativeGui = {
  ...common,
  tags: "@REQ-IDE-EDITOR-RECOVERY-001 and @native-recovery-capacity-corruption and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const editorRecoveryFailuresNativeGui = {
  ...common,
  tags: "@REQ-IDE-EDITOR-RECOVERY-001 and @native-recovery-failures and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const refactorKitJavaImportNativeGui = {
  ...common,
  tags: "@REQ-REFACTORKIT-JAVA-IMPORT-002 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaCursorNavigationNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CURSOR-NAVIGATION-NATIVE-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaCursorNavigationAppImageNativeGui = {
  ...javaCursorNavigationNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaLanguageResponsivenessNativeGui = {
  ...common,
  tags: "@native-java-language-responsiveness and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaCodeActionsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and @desktop and @native-gui and not @web and not @native-java-organize-imports and not @native-java-semantic-local-rename and not @native-java-semantic-parameter-rename and not @native-java-semantic-cross-file-rename and not @native-java-semantic-nested-type-rename and not @native-java-semantic-record-component-rename and not @native-java-semantic-multi-document-code-action and not @native-java-surround-try-catch and not @native-java-language-responsiveness and not @native-java-javadoc",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaJavadocNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and @native-java-javadoc and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaOnTypeFormattingNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and @native-java-typing-formatting and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaOrganizeImportsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and @native-java-organize-imports and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaFormatterProfileNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and @native-java-formatter-profile and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaLocalRenameNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and @native-java-semantic-local-rename and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaParameterRenameNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and @native-java-semantic-parameter-rename and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaCrossFileRenameNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and @native-java-semantic-cross-file-rename and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaSemanticTypeRenameNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and (@native-java-semantic-nested-type-rename or @native-java-semantic-record-component-rename) and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaMultiDocumentCodeActionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and @native-java-semantic-multi-document-code-action and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaTryCatchCodeActionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 and @native-java-surround-try-catch and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaLibraryNavigationNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-LIBRARY-NAVIGATION-NATIVE-001 and @desktop and @native-gui and not @web and not @native-java-platform-source and not @native-java-platform-unavailable and not @native-java-modulepath-library",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaModularLibraryNavigationNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-LIBRARY-NAVIGATION-NATIVE-001 and @native-java-modulepath-library and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaPlatformSourceNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-LIBRARY-NAVIGATION-NATIVE-001 and (@native-java-platform-source or @native-java-platform-unavailable) and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaCompactSourceNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-compact-source and not @native-java-compact-source-gradle and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleCompactSourceNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-compact-source-gradle and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaNamedModuleSourceCreationNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-modular-source-creation and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaReferenceBackendNativeGui = {
 ...common,
 tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-reference-backend and @desktop and @native-gui and not @web",
 worldParameters: targets.desktopTauriWebdriver,
};
const javaReferenceBackendAppImageNativeGui = {
  ...javaReferenceBackendNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaProjectContextNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and not @native-java-project-scaffold and not @native-java-text-search and not @native-java-entry-points and not @native-java-declared-project and not @native-java-editor-diagnostics and not @native-java-editor-sdk26-diagnostics and not @native-java-project-execution and not @native-java-project-working-directory and not @native-java-gradle-diagnostics and not @native-java-maven-preparation and not @native-java-project-wrapper and not @native-java-project-custom-output and not @native-java-gradle-project-execution and not @native-java-gradle-composite and not @native-java-gradle-mixed-jvm and not @native-java-gradle-kotlin-definition and not @native-java-maven-mixed-jvm and not @native-java-gradle-custom-source-set and not @native-java-maven-failsafe-context and not @native-java-gradle-kotlin-dsl and not @native-java-project-debugger and not @native-java-selected-test-debugger and not @native-java-failed-test-debugger and not @native-java-framework-test-debugger and not @native-java-project-tests and not @native-java-project-jupiter-tests and not @native-java-project-testng-tests and not @native-java-project-mixed-engines and not @native-java-project-coverage and not @native-java-test-templates and not @native-java-test-templates-gradle and not @native-java-maven-module-rename and not @native-java-gradle-project-model and not @native-java-gradle-preview and not @native-java-gradle-jpms-v5 and not @native-java-maven-jpms-v5 and not @native-java-unsupported-release-context and not @native-java26-scaffold-build and not @native-java26-scaffold-wrapper-build and not @native-java27-scaffold-wrapper-build and not @native-java26-supported-context and not @native-java27-supported-context and not @native-java27-preview-source-ownership and not @native-java27-v7-owner-only-source-ownership and not @native-java27-v7-jdtls-definition and not @native-java-git-branch-context and not @native-java-git-rebase-context and not @native-java-reference-backend and not @native-java-modular-source-creation and not @native-java-compact-source and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleProjectModelNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-project-model and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleJpmsV5NativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-jpms-v5 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaMavenJpmsV5NativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-maven-jpms-v5 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradlePreviewNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-preview and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaMavenModuleRenameNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-maven-module-rename and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaMavenModuleCreateNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-maven-module-create and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleModuleCreateNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-module-create and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaModuleCreationAppImageNativeGui = {
  ...common,
  tags: [javaMavenModuleCreateNativeGui, javaGradleModuleCreateNativeGui]
    .map(({ tags }) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaProjectTestTemplatesNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-test-templates and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectTestTemplatesGradleNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-test-templates-gradle and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectScaffoldNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-scaffold and not @native-java-spring-boot-starter and not @native-java-spring-boot-gradle-starter and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaSpringBootStarterAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-spring-boot-starter and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaSpringBootGradleStarterAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-spring-boot-gradle-starter and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const java26ScaffoldNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java26-scaffold and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java26ScaffoldBuildNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java26-scaffold-build and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java26ScaffoldWrapperBuildAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java26-scaffold-wrapper-build and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const java27ScaffoldWrapperBuildAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java27-scaffold-wrapper-build and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaUnsupportedReleaseContextNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-unsupported-release-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java26ProjectContextNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java26-supported-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java26ProjectContextAppImageNativeGui = {
  ...java26ProjectContextNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const java26MavenContextNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java26-maven-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java26GradleContextNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java26-gradle-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java27ProjectContextNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java27-supported-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java27ProjectContextAppImageNativeGui = {
  ...java27ProjectContextNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const java27GradleContextNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java27-gradle-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java27MavenContextNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java27-maven-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java27PreviewSourceOwnershipNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java27-preview-source-ownership and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java27V7OwnerOnlySourceOwnershipNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java27-v7-owner-only-source-ownership and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java27V7JdtlsDefinitionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java27-v7-jdtls-definition and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectTextSearchNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-text-search and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaEntryPointsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-entry-points and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaDeclaredProjectNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-declared-project and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaEditorDiagnosticsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-editor-diagnostics and not @native-java-editor-gradle-diagnostics and not @native-java-editor-multi-module-diagnostics and not @native-java-editor-test-source-diagnostics and not @native-java-editor-metadata-only-diagnostics and not @native-java-editor-external-source-diagnostics and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java26EditorDiagnosticsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-editor-sdk26-diagnostics and not @native-java-editor-sdk26-test-diagnostics and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java26TestSourceEditorDiagnosticsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-editor-sdk26-test-diagnostics and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java26EditorDiagnosticsAppImageNativeGui = {
  ...common,
  tags: `(${java26EditorDiagnosticsNativeGui.tags}) or (${java26TestSourceEditorDiagnosticsNativeGui.tags})`,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaExternalSourceEditorDiagnosticsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-editor-external-source-diagnostics and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaMetadataOnlyEditorDiagnosticsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-editor-metadata-only-diagnostics and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaTestSourceEditorDiagnosticsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-editor-test-source-diagnostics and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaMultiModuleEditorDiagnosticsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-editor-multi-module-diagnostics and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleEditorDiagnosticsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-editor-gradle-diagnostics and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaDeclaredProjectTestsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-declared-project-tests and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaProjectExecutionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-execution and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleDiagnosticsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-diagnostics and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleDiagnosticsAppImageNativeGui = {
  ...javaGradleDiagnosticsNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaMavenPreparationAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-maven-preparation and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaProjectWorkingDirectoryNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-working-directory and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectWorkingDirectoryAppImageNativeGui = {
  ...javaProjectWorkingDirectoryNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaProjectWrapperNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-wrapper and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectCustomOutputNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-custom-output and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectDebuggerNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-debugger and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectDebuggerAppImageNativeGui = {
  ...javaProjectDebuggerNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};
const javaGradleProjectExecutionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-project-execution and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectExecutionAndDebuggerAppImageNativeGui = {
  ...common,
  tags: [
    javaProjectExecutionNativeGui,
    javaGradleProjectExecutionNativeGui,
    javaProjectDebuggerNativeGui,
  ].map(({ tags }) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaGradleMixedJvmNativeGui = {
  ...javaGradleProjectExecutionNativeGui,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-mixed-jvm and @desktop and @native-gui and not @web",
};
const javaGradleKotlinDefinitionNativeGui = {
  ...javaGradleMixedJvmNativeGui,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-kotlin-definition and @desktop and @native-gui and not @web",
};
const javaGradleKotlinDefinitionAppImageNativeGui = {
  ...javaGradleKotlinDefinitionNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};
const javaMavenMixedJvmNativeGui = {
  ...javaGradleMixedJvmNativeGui,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-maven-mixed-jvm and @desktop and @native-gui and not @web",
};
const javaMixedJvmAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and (@native-java-gradle-mixed-jvm or @native-java-maven-mixed-jvm) and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};
const javaGradleCompositeExecutionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-composite and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleCompositeExecutionAppImageNativeGui = {
  ...javaGradleCompositeExecutionNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};
const javaGradleCustomSourceSetNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-custom-source-set and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaSelectedTestDebuggerNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-selected-test-debugger and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaSelectedTestDebuggerAppImageNativeGui = {
  ...javaSelectedTestDebuggerNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};
const javaFailedTestDebuggerNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-failed-test-debugger and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaFailedTestDebuggerAppImageNativeGui = {
  ...javaFailedTestDebuggerNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};
const javaMavenFailedTestDebuggerAppImageNativeGui = {
  ...javaFailedTestDebuggerAppImageNativeGui,
  tags: `${javaFailedTestDebuggerAppImageNativeGui.tags} and @native-java-maven-failed-test-debugger`,
};
const javaFrameworkTestDebuggerNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-framework-test-debugger and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaMavenFailsafeContextNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-maven-failsafe-context and not @native-java-maven-test-jvm-selection and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaMavenFailsafeContextAppImageNativeGui = {
  ...javaMavenFailsafeContextNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};
const javaMavenTestJvmSelectionAppImageNativeGui = {
  ...javaMavenFailsafeContextAppImageNativeGui,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-maven-test-jvm-selection and @desktop and @native-gui and not @web",
};
const javaGradleKotlinDslNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-kotlin-dsl and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectDiscoveryNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-discovery and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectCoverageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-coverage and not @native-java-gradle-multimodule-coverage and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectGradleMultimoduleCoverageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-gradle-multimodule-coverage and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectCoverageAppImageNativeGui = {
  ...javaProjectCoverageNativeGui,
  tags: `(${javaProjectCoverageNativeGui.tags}) or (${javaProjectGradleMultimoduleCoverageNativeGui.tags})`,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaProjectTestRerunNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-test-rerun and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectJupiterTestsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-jupiter-tests and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectTestNgTestsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-testng-tests and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectMixedTestEnginesNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-project-mixed-engines and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectTestWorkflowsAppImageNativeGui = {
  ...common,
  tags: [
    javaProjectJupiterTestsNativeGui,
    javaProjectTestNgTestsNativeGui,
    javaProjectMixedTestEnginesNativeGui,
    javaProjectTestRerunNativeGui,
    javaFrameworkTestDebuggerNativeGui,
  ].map(({ tags }) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaMavenProjectTestScopeAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-maven-project-test-scope and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
  failFast: true,
};

const javaMavenAggregatorDiscoveryAppImageNativeGui = {
  ...common,
  tags: `${javaTestDiscoveryNativeGui.tags} and @native-java-maven-aggregator-discovery`,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaGradleBatchCleanupNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-batch-cleanup and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaBatchCleanupNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-batch-cleanup and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaConstructorSignatureNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-constructor-signature-basic and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaConstructorSignatureVariantsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-constructor-signature-variants and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaConstructorReferencesNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-constructor-reference-signature and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaConstructorDelegationNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-constructor-delegation-basic and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaConstructorDelegationVariantsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-constructor-delegation-variants and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaConstructorRefactoringAppImageNativeGui = {
  ...common,
  tags: [
    javaConstructorSignatureNativeGui,
    javaConstructorSignatureVariantsNativeGui,
    javaConstructorReferencesNativeGui,
    javaConstructorDelegationNativeGui,
    javaConstructorDelegationVariantsNativeGui,
  ].map(({ tags }) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaProjectMavenCommandsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-project-commands-maven and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaProjectGradleCommandsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-project-commands-gradle and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaFieldTypeNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-field-type-change and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaFieldTypeAppImageNativeGui = {
  ...javaFieldTypeNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaGradleModuleRenameGroovyNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-module-rename-groovy and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaGradleModuleRenameKotlinNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-module-rename-kotlin and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaModuleRenameAppImageNativeGui = {
  ...common,
  tags: [javaMavenModuleRenameNativeGui, javaGradleModuleRenameGroovyNativeGui, javaGradleModuleRenameKotlinNativeGui]
    .map(({ tags }) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaGradleModuleRenameInboundAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-module-rename-inbound and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaGradleApplicationModuleRenameAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-module-rename-application-inbound and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaConstructorSelectionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-constructor-selection-refusal and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaFunctionalReferencesNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-functional-reference-signature and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaFunctionalReferencesAppImageNativeGui = {
  ...javaFunctionalReferencesNativeGui,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and (@native-java-functional-reference-signature or @native-java-bound-reference-signature) and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaSignatureHierarchyNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-signature-hierarchy-variants and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaSdkRefactoringNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-saved-refactoring and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaJpqlReviewNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-jpql-review and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaJpqlReviewAppImageNativeGui = {
  ...javaJpqlReviewNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaJpqlOpaqueResourceAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-jpql-opaque-resource and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaJpqlManagedAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-jpql-managed and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaJpqlNamedQueryAppImageNativeGui = {
  ...javaJpqlManagedAppImageNativeGui,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-jpql-named-query and @desktop and @native-gui and not @web",
};

const javaSdkFormatterProfileNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-sdk-formatter-profile and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaCleanupAppImageNativeGui = {
  ...common,
  tags: [javaSdkFormatterProfileNativeGui, javaBatchCleanupNativeGui, javaGradleBatchCleanupNativeGui]
    .map(({ tags }) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaBatchFormatterProfileAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-batch-formatter-profile and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaExtractMethodNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-extract-method and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaExtractVariableNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-extract-variable and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaInlineRefactoringsNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-inline-refactorings and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaInlineRefactoringsAppImageNativeGui = {
  ...javaInlineRefactoringsNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaInlineMethodUpgradeAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-inline-method-upgrade and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaParameterObjectAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-parameter-object and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaExtractDelegateAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-extract-delegate and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaInlineVariableNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-inline-variable and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaInlineConstantNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-inline-constant and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaExtractParameterNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-extract-parameter and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaExtractFieldNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-extract-field and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaExtractVariableInitializerNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-extract-variable-initializer and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaExtractExpressionAppImageNativeGui = {
  ...common,
  tags: [
    "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-extract-constant and @desktop and @native-gui and not @web",
    javaExtractVariableNativeGui.tags,
    javaExtractVariableInitializerNativeGui.tags,
    javaExtractParameterNativeGui.tags,
    javaExtractFieldNativeGui.tags,
  ].map((tags) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaCursorParameterReorderNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-cursor-parameter-reorder and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaCursorParameterRenameNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-cursor-parameter-rename and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaPublicParameterReorderRefusalNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-public-parameter-reorder-refusal and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaMakeStaticNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-make-static and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaMakePublicNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-make-public and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaRefactorKitLspNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-lsp-refactoring and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaExtractInterfaceNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-extract-interface and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaExtractSuperclassNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-extract-superclass and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaMoveMemberNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-move-member and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaPullUpMemberNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-pull-up-member and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaPushDownMemberNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-push-down-member and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaEncapsulateFieldNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-encapsulate-field and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaMemberRefactoringAppImageNativeGui = {
  ...common,
  tags: [
    javaExtractInterfaceNativeGui,
    javaExtractSuperclassNativeGui,
    javaMoveMemberNativeGui,
    javaPullUpMemberNativeGui,
    javaPushDownMemberNativeGui,
    javaEncapsulateFieldNativeGui,
  ].map(({ tags }) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaCursorParameterAdditionNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and (@native-java-cursor-parameter-addition or @native-java-signature-hierarchy) and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaCursorParameterTypeChangeNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-cursor-parameter-type-change and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaParameterTypeAppImageNativeGui = {
  ...javaCursorParameterTypeChangeNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaCursorParameterRemovalNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-cursor-parameter-removal and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaDraftRefactoringNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-draft-refactoring and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaDraftImportsRenameNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-draft-imports-rename and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaProjectModelClassRefactoringNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-project-model-class-refactoring and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const httpRequestFilesNativeGui = {
  ...common,
  tags: "@REQ-IDE-HTTP-CLIENT-001 and @http-request-files and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const httpOAuthAuthorizationNativeGui = {
  ...common,
  tags: "@REQ-IDE-HTTP-CLIENT-001 and @http-oauth-browser and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const httpClientNativeGui = {
  ...common,
  tags: "@REQ-IDE-HTTP-CLIENT-001 and @http-client-native and not @http-request-files and not @http-oauth-browser and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectContextGitBranchNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-git-branch-context and not @native-gradle-git-branch-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleProjectContextGitBranchNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-gradle-git-branch-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectContextGitRebaseNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-git-rebase-context and not @native-gradle-git-rebase-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleProjectContextGitRebaseNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-gradle-git-rebase-context and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const gitBranchDeletionNativeGui = {
 ...common,
 tags: "@REQ-IDE-GIT-SOURCE-CONTROL-001 and @native-git-branch-deletion and @desktop and @native-gui and not @web",
 worldParameters: targets.desktopTauriWebdriver,
};
const gitHistoryNativeGui = {
  ...common,
  tags: "@REQ-IDE-GIT-SOURCE-CONTROL-001 and @native-git-history and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const gitWorkspaceNativeGui = {
  ...common,
  tags: "@REQ-IDE-GIT-SOURCE-CONTROL-001 and not @native-git-history and not @native-git-branch-deletion and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaDatabasePlansNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-DATABASE-001 and @native-java-database-plans and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaDatabaseNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-DATABASE-001 and @java-database-native and not @native-java-database-plans and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectModelPackageMoveNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-project-model-package-refactoring and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectModelPackageMoveCommandPaletteNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-project-model-package-refactoring-command-palette and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleProjectModelPackageMoveNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-project-model-package-refactoring and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectModelPackageMoveAppImageNativeGui = {
  ...common,
  tags: [
    javaProjectModelPackageMoveNativeGui,
    javaProjectModelPackageMoveCommandPaletteNativeGui,
    javaGradleProjectModelPackageMoveNativeGui,
  ].map(({ tags }) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaGradleProjectModelClassRefactoringNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-project-model-class-refactoring and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectModelClassRefactoringAppImageNativeGui = {
  ...common,
  tags: `(${javaProjectModelClassRefactoringNativeGui.tags}) or (${javaGradleProjectModelClassRefactoringNativeGui.tags})`,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaGradleCrossModuleClassMoveAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-cross-module-class-move and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaReferenceDevelopmentAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-reference-development and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaGradleClassMoveRecoveryAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-class-move-recovery and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaProjectModelSourceRootRefactoringNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-project-model-source-root-refactoring and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaProjectModelSourceRootRefactoringAppImageNativeGui = {
  ...javaProjectModelSourceRootRefactoringNativeGui,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaDraftRecoveryNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-draft-restart and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaGradleDraftRecoveryAppImageNativeGui = {
  ...common,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-draft-restart and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaDraftRefactoringAppImageNativeGui = {
  ...javaDraftRefactoringNativeGui,
  tags: [javaDraftRefactoringNativeGui, javaDraftImportsRenameNativeGui, javaDraftRecoveryNativeGui]
    .map(({ tags }) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaMethodRefactoringAppImageNativeGui = {
  ...javaExtractMethodNativeGui,
  tags: [javaExtractMethodNativeGui, javaCursorParameterReorderNativeGui,
    javaPublicParameterReorderRefusalNativeGui, javaSignatureHierarchyNativeGui,
    javaCursorParameterRenameNativeGui, javaCursorParameterAdditionNativeGui,
    javaCursorParameterRemovalNativeGui, javaCursorParameterTypeChangeNativeGui]
    .map(({ tags }) => `(${tags})`).join(" or "),
  worldParameters: targets.desktopTauriAppImageWebdriver,
};
const javaGradleExtractMethodAppImageNativeGui = {
  ...javaExtractMethodNativeGui,
  tags: "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 and @native-java-gradle-extract-method and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
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

const xcom2ProjectFoundryTauriHarness = {
  ...common,
  tags: "@REQ-XCOM2-PROJECT-FOUNDRY-001",
  worldParameters: targets.desktopTauriHarness,
};

const xcom2ProjectBuildRecipeTauriHarness = {
  ...common,
  tags: "@REQ-XCOM2-PROJECT-BUILD-RECIPE-001",
  worldParameters: targets.desktopTauriHarness,
};

const piWorkspaceAgentTauriHarness = {
  ...common,
  tags: "@REQ-PI-WORKSPACE-AGENT-001",
  worldParameters: targets.desktopTauriHarness,
};

// Focused Java language service characterization profile (REQ-IDE-JAVA-LANGUAGE-001).
// Runner-neutral: paths limited to the single java-language-service.feature source, so
// no competing feature source is exercised. Deterministic desktop/tauri-harness evidence
// mirrors the throwaway tmp/java-language.cucumber.js payload verified GREEN by
// ts-story-driven; this permanent profile replaces that throwaway config.
const javaLanguageServiceTauriHarness = {
  paths: ["features/workspace/java-language-service.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-LANGUAGE-001 and not @native-gui",
  worldParameters: targets.desktopTauriHarness,
};

const javaLanguageIntelligenceNativeGui = {
  paths: ["features/workspace/java-language-service.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-LANGUAGE-001 and @native-java-language-intelligence and not @native-java27-preview and not @native-java26-preview and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java26PreviewImportNativeGui = {
  paths: ["features/workspace/java-language-service.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-LANGUAGE-001 and @native-java26-preview and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const java27PreviewImportNativeGui = {
  paths: ["features/workspace/java-language-service.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-LANGUAGE-001 and @native-java27-preview and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};
const javaPreviewCompatibilityNativeGui = {
  ...java26PreviewImportNativeGui,
  tags: "@REQ-IDE-JAVA-LANGUAGE-001 and @native-java-preview-incompatible and @desktop and @native-gui and not @web",
};
const javaJdtlsRuntimePreferenceNativeGui = {
  ...javaLanguageIntelligenceNativeGui,
  tags: "@REQ-IDE-JAVA-LANGUAGE-001 and @native-java-jdtls-runtime-preference and @desktop and @native-gui and not @web",
};

const javaLanguageIntelligenceCoreNativeGui = {
  paths: ["features/workspace/java-language-service.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-LANGUAGE-001 and @native-java-language-intelligence and not @native-java-search-everywhere and not @native-java27-preview and not @native-java26-preview and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaLanguageIntelligenceAppImageNativeGui = {
  paths: ["features/workspace/java-language-service.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-LANGUAGE-001 and (@native-java-language-intelligence or @native-java-templates) and not @native-java-search-everywhere and not @native-java27-preview and not @native-java26-preview and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaApplicationInputAppImageNativeGui = {
  ...javaApplicationInputNativeGui,
  failFast: true,
  worldParameters: targets.desktopTauriAppImageWebdriver,
};

const javaTemplatesNativeGui = {
  paths: ["features/workspace/java-language-service.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-LANGUAGE-001 and @native-java-templates and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const javaSearchEverywhereNativeGui = {
  paths: ["features/workspace/java-language-service.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-LANGUAGE-001 and @native-java-search-everywhere and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

// Focused RefactorKit Java refactoring characterization profile (REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001).
// Runner-neutral: paths limited to the single java-refactoring.feature source, so no competing feature
// source is exercised. Deterministic desktop/tauri-harness evidence mirrors the throwaway
// tmp/refactorkit-java-refactoring.cucumber.cjs payload verified GREEN by ts-story-driven; this permanent
// profile replaces that throwaway config. Support drivers plus the full steps glob (which includes
// shared-operational.steps.ts) are imported, and the focused tag scope disambiguates shared step wording.
const refactorKitJavaRefactoringTauriHarness = {
  paths: ["features/refactorkit/java-refactoring.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001",
  worldParameters: targets.desktopTauriHarness,
};

// Focused RefactorKit engine-integration characterization profile (REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001).
// Runner-neutral: paths limited to the single engine-integration.feature source, so no competing feature
// source is exercised. Deterministic desktop/tauri-harness evidence mirrors the throwaway
// tmp/refactorkit-engine-integration.cucumber.cjs payload verified GREEN by ts-story-driven; this permanent
// profile replaces that throwaway config. Support drivers plus the full steps glob (which includes
// shared-operational.steps.ts) are imported, and the focused tag scope disambiguates shared step wording.
const refactorKitEngineIntegrationTauriHarness = {
  paths: ["features/refactorkit/engine-integration.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001",
  worldParameters: targets.desktopTauriHarness,
};

// Focused RefactorKit Java-navigation characterization profile (REQ-IDE-JAVA-NAVIGATION-001).
// Runner-neutral: paths limited to the single java-navigation.feature source, so no competing
// feature source is exercised. Deterministic desktop/tauri-harness evidence mirrors the
// refactorKitEngineIntegrationTauriHarness pattern. Support drivers plus the full steps glob
// (which includes shared-operational.steps.ts) are imported, and the focused tag scope
// disambiguates shared step wording.
const refactorKitJavaNavigationTauriHarness = {
  paths: ["features/refactorkit/java-navigation.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-NAVIGATION-001",
  worldParameters: targets.desktopTauriHarness,
};

// Focused RefactorKit Java project-model characterization profile (REQ-IDE-JAVA-PROJECT-MODEL-001).
// Runner-neutral: paths limited to the single java-project-model.feature source, so no competing
// feature source is exercised. Deterministic desktop/tauri-harness evidence mirrors the
// refactorKitJavaNavigationTauriHarness pattern. Support drivers plus the full steps glob
// (which includes shared-operational.steps.ts) are imported, and the focused tag scope
// disambiguates shared step wording.
const refactorKitJavaProjectModelTauriHarness = {
  paths: ["features/refactorkit/java-project-model.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-PROJECT-MODEL-001",
  worldParameters: targets.desktopTauriHarness,
};

// Focused RefactorKit Java build/run characterization profile (REQ-IDE-JAVA-BUILD-RUN-DEBUG-001).
// Runner-neutral: paths limited to the single java-build-run.feature source, so no competing
// feature source is exercised. Deterministic desktop/tauri-harness evidence mirrors the
// refactorKitJavaProjectModelTauriHarness pattern. Support drivers plus the full steps glob
// (which includes shared-operational.steps.ts) are imported, and the focused tag scope
// disambiguates shared step wording.
const refactorKitJavaBuildRunTauriHarness = {
  paths: ["features/refactorkit/java-build-run.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
  tags: "@REQ-IDE-JAVA-BUILD-RUN-DEBUG-001",
  worldParameters: targets.desktopTauriHarness,
};

const idePackagingTauriHarness = {
  ...common,
  tags: "@REQ-IDE-PACKAGING-001",
  worldParameters: targets.idePackagingTauriHarness,
};

const piWorkspaceAgentNativeGui = {
  ...common,
  tags: "@REQ-PI-WORKSPACE-AGENT-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
};

const xcom2ProjectFoundryApplyTauriHarness = {
  ...common,
  tags: "@REQ-XCOM2-PROJECT-FOUNDRY-002",
  worldParameters: targets.desktopTauriHarness,
};

const xcom2ProjectFoundryDestinationConflictTauriHarness = {
  ...common,
  tags: "@REQ-XCOM2-PROJECT-FOUNDRY-003",
  worldParameters: targets.desktopTauriHarness,
};

const xcom2ProjectFoundryVerifiedCleanupTauriHarness = {
  ...common,
  tags: "@REQ-XCOM2-PROJECT-FOUNDRY-004",
  worldParameters: targets.desktopTauriHarness,
};

const xcom2MachineSettingsMissingSteamNativeGui = {
  ...common,
  tags: "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001 and @desktop and @native-gui and not @web",
  worldParameters: targets.desktopTauriWebdriver,
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
  javaSourceFileCreationNativeGui,
  javaLargePackageAppImageNativeGui,
  desktopStartupResponsivenessNativeGui,
  editorRecoveryNativeGui,
  editorDiskComparisonNativeGui,
  editorExternalChangesNativeGui,
  editorRecoveryHistoryNativeGui,
  editorRecoveryFailuresNativeGui,
  editorRecoveryCapacityCorruptionNativeGui,
  editorStorageFullNativeGui,
  editorCloseGuardsNativeGui,
  javaExecutionNativeGui,
  javaFlightRecorderNativeGui,
  javaFlightRecorderAppImageNativeGui,
  javaBuildToolsNativeGui,
  javaFailsafeReactorNativeGui,
  javaFailsafeReactorAppImageNativeGui,
  javaDebuggerNativeGui,
  javaDebuggerAppImageNativeGui,
  workspaceTerminalNativeGui,
  javaJdiDebuggerNativeGui,
  javaJdiDebuggerAppImageNativeGui,
  javaJdiRunToCursorNativeGui,
  javaClassChangeReviewNativeGui,
  javaDropFrameNativeGui,
  javaRestartExecutionNativeGui,
  javaExecutionCommandsNativeGui,
  javaTestJvmNativeGui,
  javaCoverageNativeGui,
  javaCoverageAppImageNativeGui,
  javaConditionalDebuggerNativeGui,
  javaConditionalDebuggerAppImageNativeGui,
  javaExceptionBreakpointsNativeGui,
  javaAttachDebuggerNativeGui,
  javaFileOperationsNativeGui,
  javaTestDiscoveryNativeGui,
  javaTestNgDiscoveryNativeGui,
  javaJupiterTestExecutionNativeGui,
  javaTestNgTestExecutionNativeGui,
  javaPlainJdkTestNgNativeGui,
  javaPlainJdkTestNgAppImageNativeGui,
  javaWorkingDirectoryNativeGui,
  java8MavenRunNativeGui,
  java8MavenRunAppImageNativeGui,
  javaApplicationInputNativeGui,
  javaCompilerAndSourceCreationAppImageNativeGui,
  javaCursorNavigationNativeGui,
  javaCursorNavigationAppImageNativeGui,
  javaCodeActionsNativeGui,
  javaOnTypeFormattingNativeGui,
  javaJavadocNativeGui,
  javaLanguageResponsivenessNativeGui,
  javaOrganizeImportsNativeGui,
  javaFormatterProfileNativeGui,
  javaLocalRenameNativeGui,
  javaParameterRenameNativeGui,
  javaCrossFileRenameNativeGui,
  javaSemanticTypeRenameNativeGui,
  javaMultiDocumentCodeActionNativeGui,
  javaTryCatchCodeActionNativeGui,
  javaLibraryNavigationNativeGui,
  javaModularLibraryNavigationNativeGui,
  javaPlatformSourceNativeGui,
  javaProjectContextNativeGui,
  javaReferenceBackendNativeGui,
  javaReferenceBackendAppImageNativeGui,
  javaCompactSourceNativeGui,
  javaGradleCompactSourceNativeGui,
  javaNamedModuleSourceCreationNativeGui,
  javaGradleProjectModelNativeGui,
  javaGradleJpmsV5NativeGui,
  javaMavenJpmsV5NativeGui,
  javaGradlePreviewNativeGui,
  javaMavenModuleRenameNativeGui,
  javaMavenModuleCreateNativeGui,
  javaGradleModuleCreateNativeGui,
  javaModuleCreationAppImageNativeGui,
  javaProjectTestTemplatesNativeGui,
  javaProjectTestTemplatesGradleNativeGui,
  javaProjectScaffoldNativeGui,
  javaSpringBootStarterAppImageNativeGui,
  javaSpringBootGradleStarterAppImageNativeGui,
  java26ScaffoldNativeGui,
  java26ScaffoldBuildNativeGui,
  java26ScaffoldWrapperBuildAppImageNativeGui,
  java27ScaffoldWrapperBuildAppImageNativeGui,
  javaUnsupportedReleaseContextNativeGui,
  java26ProjectContextNativeGui,
  java26ProjectContextAppImageNativeGui,
  java26MavenContextNativeGui,
  java26GradleContextNativeGui,
  java27ProjectContextNativeGui,
  java27ProjectContextAppImageNativeGui,
  java27GradleContextNativeGui,
  java27MavenContextNativeGui,
  java27PreviewSourceOwnershipNativeGui,
  java27V7OwnerOnlySourceOwnershipNativeGui,
  java27V7JdtlsDefinitionNativeGui,
  javaProjectTextSearchNativeGui,
  javaEntryPointsNativeGui,
  javaDeclaredProjectNativeGui,
  javaDeclaredProjectTestsNativeGui,
  javaEditorDiagnosticsNativeGui,
  java26EditorDiagnosticsNativeGui,
  java26TestSourceEditorDiagnosticsNativeGui,
  java26EditorDiagnosticsAppImageNativeGui,
  javaGradleEditorDiagnosticsNativeGui,
  javaMultiModuleEditorDiagnosticsNativeGui,
  javaTestSourceEditorDiagnosticsNativeGui,
  javaMetadataOnlyEditorDiagnosticsNativeGui,
  javaExternalSourceEditorDiagnosticsNativeGui,
  javaProjectExecutionNativeGui,
  javaGradleDiagnosticsNativeGui,
  javaGradleDiagnosticsAppImageNativeGui,
  javaMavenPreparationAppImageNativeGui,
  javaProjectWorkingDirectoryNativeGui,
  javaProjectWorkingDirectoryAppImageNativeGui,
  javaProjectWrapperNativeGui,
  javaProjectCustomOutputNativeGui,
  javaProjectDebuggerNativeGui,
  javaProjectDebuggerAppImageNativeGui,
  javaProjectExecutionAndDebuggerAppImageNativeGui,
  javaGradleProjectExecutionNativeGui,
  javaGradleMixedJvmNativeGui,
  javaGradleKotlinDefinitionNativeGui,
  javaGradleKotlinDefinitionAppImageNativeGui,
  javaMavenMixedJvmNativeGui,
  javaMixedJvmAppImageNativeGui,
  javaGradleCompositeExecutionNativeGui,
  javaGradleCompositeExecutionAppImageNativeGui,
  javaGradleCustomSourceSetNativeGui,
  javaMavenFailsafeContextNativeGui,
  javaMavenFailsafeContextAppImageNativeGui,
  javaMavenTestJvmSelectionAppImageNativeGui,
  javaSelectedTestDebuggerNativeGui,
  javaSelectedTestDebuggerAppImageNativeGui,
  javaFailedTestDebuggerNativeGui,
  javaFailedTestDebuggerAppImageNativeGui,
  javaMavenFailedTestDebuggerAppImageNativeGui,
  javaFrameworkTestDebuggerNativeGui,
  javaGradleKotlinDslNativeGui,
  javaProjectDiscoveryNativeGui,
  javaProjectCoverageNativeGui,
  javaProjectCoverageAppImageNativeGui,
  javaProjectGradleMultimoduleCoverageNativeGui,
  javaProjectTestRerunNativeGui,
  javaProjectJupiterTestsNativeGui,
  javaProjectTestNgTestsNativeGui,
  javaProjectMixedTestEnginesNativeGui,
  javaProjectTestWorkflowsAppImageNativeGui,
  javaMavenProjectTestScopeAppImageNativeGui,
  javaMavenAggregatorDiscoveryAppImageNativeGui,
  javaGradleBatchCleanupNativeGui,
  javaBatchCleanupNativeGui,
  javaSdkRefactoringNativeGui,
  javaSignatureHierarchyNativeGui,
  javaFunctionalReferencesNativeGui,
  javaFunctionalReferencesAppImageNativeGui,
  javaConstructorSelectionNativeGui,
  javaGradleModuleRenameKotlinNativeGui,
  javaModuleRenameAppImageNativeGui,
  javaGradleModuleRenameInboundAppImageNativeGui,
  javaGradleApplicationModuleRenameAppImageNativeGui,
  javaGradleModuleRenameGroovyNativeGui,
  javaFieldTypeNativeGui,
  javaFieldTypeAppImageNativeGui,
  javaProjectGradleCommandsNativeGui,
  javaProjectMavenCommandsNativeGui,
  javaConstructorDelegationNativeGui,
  javaConstructorDelegationVariantsNativeGui,
  javaConstructorRefactoringAppImageNativeGui,
  javaConstructorReferencesNativeGui,
  javaConstructorSignatureNativeGui,
  javaConstructorSignatureVariantsNativeGui,
  javaJpqlReviewNativeGui,
  javaJpqlReviewAppImageNativeGui,
  javaJpqlOpaqueResourceAppImageNativeGui,
  javaJpqlManagedAppImageNativeGui,
  javaJpqlNamedQueryAppImageNativeGui,
  javaSdkFormatterProfileNativeGui,
  javaCleanupAppImageNativeGui,
  javaBatchFormatterProfileAppImageNativeGui,
  javaExtractMethodNativeGui,
  javaExtractVariableNativeGui,
  javaInlineRefactoringsNativeGui,
  javaInlineRefactoringsAppImageNativeGui,
  javaInlineMethodUpgradeAppImageNativeGui,
  javaParameterObjectAppImageNativeGui,
  javaExtractDelegateAppImageNativeGui,
  javaInlineVariableNativeGui,
  javaInlineConstantNativeGui,
  javaExtractParameterNativeGui,
  javaExtractFieldNativeGui,
  javaExtractVariableInitializerNativeGui,
  javaExtractExpressionAppImageNativeGui,
  javaCursorParameterReorderNativeGui,
  javaCursorParameterRenameNativeGui,
  javaPublicParameterReorderRefusalNativeGui,
  javaMakeStaticNativeGui,
  javaMakePublicNativeGui,
  javaRefactorKitLspNativeGui,
  javaExtractInterfaceNativeGui,
  javaExtractSuperclassNativeGui,
  javaMoveMemberNativeGui,
  javaPullUpMemberNativeGui,
  javaPushDownMemberNativeGui,
  javaEncapsulateFieldNativeGui,
  javaMemberRefactoringAppImageNativeGui,
  javaCursorParameterAdditionNativeGui,
  javaCursorParameterTypeChangeNativeGui,
  javaParameterTypeAppImageNativeGui,
  javaCursorParameterRemovalNativeGui,
  javaDraftRefactoringNativeGui,
  javaDraftImportsRenameNativeGui,
  javaProjectModelClassRefactoringNativeGui,
  httpClientNativeGui,
  httpOAuthAuthorizationNativeGui,
  gitWorkspaceNativeGui,
  gitHistoryNativeGui,
  gitBranchDeletionNativeGui,
  javaProjectContextGitBranchNativeGui,
  javaGradleProjectContextGitBranchNativeGui,
  javaProjectContextGitRebaseNativeGui,
  javaGradleProjectContextGitRebaseNativeGui,
  httpRequestFilesNativeGui,
  javaDatabaseNativeGui,
  javaDatabasePlansNativeGui,
  javaProjectModelPackageMoveNativeGui,
  javaProjectModelPackageMoveCommandPaletteNativeGui,
  javaGradleProjectModelPackageMoveNativeGui,
  javaProjectModelPackageMoveAppImageNativeGui,
  javaGradleProjectModelClassRefactoringNativeGui,
  javaProjectModelClassRefactoringAppImageNativeGui,
  javaGradleCrossModuleClassMoveAppImageNativeGui,
  javaReferenceDevelopmentAppImageNativeGui,
  javaGradleClassMoveRecoveryAppImageNativeGui,
  javaProjectModelSourceRootRefactoringNativeGui,
  javaProjectModelSourceRootRefactoringAppImageNativeGui,
  javaDraftRecoveryNativeGui,
  javaGradleDraftRecoveryAppImageNativeGui,
  javaDraftRefactoringAppImageNativeGui,
  javaMethodRefactoringAppImageNativeGui,
  javaGradleExtractMethodAppImageNativeGui,
  refactorKitJavaImportNativeGui,
  desktopLayoutNativeGui,
  xcom2MachineSettingsTauriHarness,
  xcom2ProjectFoundryTauriHarness,
  xcom2ProjectBuildRecipeTauriHarness,
  piWorkspaceAgentTauriHarness,
  javaLanguageServiceTauriHarness,
  javaLanguageIntelligenceNativeGui,
  java26PreviewImportNativeGui,
  javaPreviewCompatibilityNativeGui,
  java27PreviewImportNativeGui,
  javaJdtlsRuntimePreferenceNativeGui,
  javaLanguageIntelligenceCoreNativeGui,
  javaLanguageIntelligenceAppImageNativeGui,
  javaApplicationInputAppImageNativeGui,
  javaSearchEverywhereNativeGui,
  javaTemplatesNativeGui,
  refactorKitJavaRefactoringTauriHarness,
  refactorKitEngineIntegrationTauriHarness,
  refactorKitJavaNavigationTauriHarness,
  refactorKitJavaProjectModelTauriHarness,
  refactorKitJavaBuildRunTauriHarness,
  piWorkspaceAgentNativeGui,
  idePackagingTauriHarness,
  xcom2ProjectFoundryApplyTauriHarness,
  xcom2ProjectFoundryDestinationConflictTauriHarness,
  xcom2ProjectFoundryVerifiedCleanupTauriHarness,
  xcom2MachineSettingsMissingSteamNativeGui,
  xcom2ModuleActivationNativeGui,
  xcom2ModuleConfigurationActivationNativeGui,
  xcom2ModuleConfigurationDiagnosticsNativeGui,
  web,
  desktop,
};
