export const STORY_STATUS_TAGS = new Set([
  "@implemented-and-validated",
  "@implemented-not-e2e-validated",
  "@partial",
  "@config-only",
  "@placeholder",
  "@absent",
  "@not-implemented",
]);

export const STORY_TARGET_TAGS = new Set(["@web", "@desktop"]);

export function scenarioKey(scenario) {
  return `${scenario.uri}:${scenario.line} ${scenario.name}`;
}

function selectedTags(tags, candidates) {
  return [...candidates].filter((tag) => tags.has(tag));
}

export function evaluateDeclaredStoryRouting(scenarios) {
  const failures = [];
  const expectedWeb = [];
  const expectedDesktopTauriHarness = [];
  const unsupportedValidatedDesktop = [];

  for (const scenario of scenarios) {
    const statuses = selectedTags(scenario.tags, STORY_STATUS_TAGS);
    const targets = selectedTags(scenario.tags, STORY_TARGET_TAGS);
    const key = scenarioKey(scenario);

    if (statuses.length !== 1) {
      failures.push(
        `${key} must declare exactly one Story status tag; received ${statuses.length}`,
      );
    }
    if (targets.length !== 1) {
      failures.push(`${key} must declare exactly one Story target tag; received ${targets.length}`);
    }
    if (statuses.length !== 1 || targets.length !== 1) {
      continue;
    }

    const [status] = statuses;
    const [target] = targets;
    if (status === "@implemented-and-validated" && target === "@web") {
      expectedWeb.push(scenario);
    } else if (status === "@implemented-not-e2e-validated" && target === "@desktop") {
      expectedDesktopTauriHarness.push(scenario);
    } else if (status === "@implemented-and-validated" && target === "@desktop") {
      unsupportedValidatedDesktop.push(scenario);
      failures.push(
        `${key} is @implemented-and-validated @desktop but no packaged native GUI/E2E profile exists`,
      );
    } else if (status === "@implemented-not-e2e-validated") {
      failures.push(`${key} has no supported ${status} ${target} Story evidence route`);
    }
  }

  return {
    failures,
    expectedWeb,
    expectedDesktopTauriHarness,
    unsupportedValidatedDesktop,
  };
}
