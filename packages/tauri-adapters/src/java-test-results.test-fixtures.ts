import type { JavaTestResults } from "@ide/contracts";

export function reports(): JavaTestResults {
  return {
    status: "ready",
    projectPath: "service",
    buildTool: "maven",
    unchangedReports: 0,
    suites: [
      {
        name: "example.SampleTest",
        reportPath: "service/target/surefire-reports/TEST-Sample.xml",
        cases: [
          {
            id: "case-1",
            name: "fails",
            className: "example.SampleTest",
            state: "failed",
            durationMs: 2,
            detail: "AssertionError\nat SampleTest.java:9",
            detailTruncated: false,
          },
          {
            id: "case-2",
            name: "passes",
            className: "example.SampleTest",
            state: "passed",
            durationMs: 1,
            detail: "",
            detailTruncated: false,
          },
        ],
      },
    ],
    summary: { total: 2, failed: 1, passed: 1, error: 0, skipped: 0, flaky: 0 },
    message: null,
    canRerunFailed: true,
    rerunReason: null,
  };
}
