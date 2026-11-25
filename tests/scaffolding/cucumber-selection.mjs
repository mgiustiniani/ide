import assert from "node:assert/strict";
import path from "node:path";
import { discoverCucumberSelection } from "../../scripts/cucumber-selection.mjs";

/** Count authored pickle steps, not incidental Before/After registrations. */
export function assertAuthoredSelection(profile, scenarioCount, stepCount, discoveredScenarios) {
  const scenarios =
    discoveredScenarios ??
    discoverCucumberSelection({ repositoryRoot: path.resolve("."), profile });
  assert.equal(scenarios.length, scenarioCount, `${profile}: selected scenarios`);
  assert.equal(
    scenarios.reduce((total, entry) => total + entry.authoredStepCount, 0),
    stepCount,
    `${profile}: authored steps`,
  );
  for (const scenario of scenarios)
    assert.deepEqual(
      scenario.unmatchedSteps,
      [],
      `${profile}: undefined or ambiguous authored steps`,
    );
}
