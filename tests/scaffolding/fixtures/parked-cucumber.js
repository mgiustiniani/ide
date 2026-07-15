const defaultProfile = {};

const parkedNativeGuiFixture = {
  paths: ["tests/scaffolding/fixtures/parked-native-gui.feature"],
  tags: "@implemented-and-validated and @desktop and @native-gui and not @web",
  dryRun: true,
  format: ["progress"],
  strict: true,
};

export { defaultProfile as default, parkedNativeGuiFixture };
