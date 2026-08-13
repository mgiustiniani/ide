Business Need: Portable Linux AppImage packaging of the real IDE desktop
  To let CachyOS/Arch users run the IDE without a package manager or a source build
  People on portable Linux need one deterministic AppImage release that launches the real IDE desktop and exits cleanly.

Ability: Build and validate a fixed AppImage release from a deterministic command
  The IDE desktop workspace can produce a self-contained, executable AppImage named IDE at a fixed path and prove that the packaged app launches the real IDE and exits cleanly with no surviving processes.

Feature: AppImage-only release packaging for CachyOS/Arch portable use
  This requirement covers only the AppImage bundle produced at the frozen baseline by the fixed deterministic packaging command.
  deb/rpm/pacman native packages, custom PKGBUILD, Windows/MSI/NSIS, macOS/DMG, code signing, installer branding, and distribution or store publication are outside its scope.

  @REQ-IDE-PACKAGING-001 @desktop @packaging @native-gui @functional-requirement @non-functional-requirement @implemented-and-validated
  Scenario: Build and validate the deterministic AppImage release of the IDE desktop
    Given the IDE desktop workspace is at the frozen baseline BASELINE-REQ-IDE-PACKAGING-001-v1
    And the host is a portable Linux environment compatible with CachyOS/Arch
    And the AppImage bundle arguments and executable selection remain fixed
    When the scenario runs the fixed deterministic packaging command:
      """
      pnpm --filter @ide/desktop tauri build --bundles appimage --ci
      """
    Then the command exits successfully and produces a real release AppImage artifact
    And the artifact exists at the fixed path "apps/desktop/src-tauri/target/release/bundle/appimage/IDE_0.1.0_amd64.AppImage"
    And the artifact has the fixed product name "IDE" and the fixed version "0.1.0"
    And the artifact is executable and self-contained
    When the artifact launches the real IDE desktop
    Then the IDE desktop starts and its native window becomes ready
    When the person closes the IDE window
    Then the packaged app exits cleanly
    And zero IDE desktop processes survive after exit
