const common = {
  paths: ["features/**/*.feature"],
  import: ["tests/story/support/**/*.ts", "tests/story/steps/**/*.ts"],
  format: ["progress"],
  strict: true,
};

const defaultProfile = {
  ...common,
  worldParameters: {
    target: { name: "unselected", driver: "unselected" },
  },
};

const implemented = {
  ...common,
  tags: "@implemented-and-validated",
  worldParameters: {
    target: { name: "unselected", driver: "unselected" },
  },
};

const web = {
  ...common,
  worldParameters: {
    target: { name: "web", driver: "playwright" },
  },
};

const desktop = {
  ...common,
  worldParameters: {
    target: { name: "desktop", driver: "tauri" },
  },
};

export { defaultProfile as default, implemented, web, desktop };
