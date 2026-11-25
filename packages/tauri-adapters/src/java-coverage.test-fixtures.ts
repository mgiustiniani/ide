import type { JavaCoverageResults } from "@ide/contracts";
export function coverage(): JavaCoverageResults {
  const counters = {
    instructions: { missed: 2, covered: 3 },
    branches: { missed: 1, covered: 1 },
    lines: { missed: 1, covered: 1 },
  };
  return {
    status: "ready",
    provider: "jacoco",
    version: "0.8.15",
    projectPath: "",
    buildTool: "maven",
    reports: 1,
    message: null,
    counters,
    files: [
      {
        id: "target/site/jacoco/jacoco.xml:example/Choice.java",
        reportPath: "target/site/jacoco/jacoco.xml",
        moduleRoot: null,
        packageName: "example",
        name: "Choice.java",
        counters,
        lines: [
          {
            number: 2,
            missedInstructions: 1,
            coveredInstructions: 3,
            missedBranches: 1,
            coveredBranches: 1,
          },
          {
            number: 3,
            missedInstructions: 1,
            coveredInstructions: 0,
            missedBranches: 0,
            coveredBranches: 0,
          },
        ],
      },
    ],
  };
}
