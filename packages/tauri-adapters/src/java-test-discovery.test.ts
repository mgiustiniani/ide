import { describe, expect, it } from "vitest";
import { normalizeJavaTestDiscovery } from "./java-test-discovery";

function discovery() {
  return {
    status: "ready",
    projectPath: "module",
    buildTool: "gradle",
    scope: "test-task",
    message: null,
    tests: [
      {
        id: `test-${"a".repeat(64)}`,
        kind: "class",
        className: "p.Test",
        methodName: null,
        label: "p.Test",
      },
      {
        id: `test-${"b".repeat(64)}`,
        kind: "method",
        className: "p.Test",
        methodName: "selected",
        label: "selected 😀",
      },
    ],
  };
}
describe("native Java test discovery validation", () => {
  it("accepts JUnit engine discovery for plain JDK projects", () => {
    expect(
      normalizeJavaTestDiscovery(
        { ...discovery(), buildTool: "jdk", scope: "engines" },
        "succeeded",
      ).buildTool,
    ).toBe("jdk");
  });
  it("admits class and literal method identities without treating discovery as execution", () => {
    expect(normalizeJavaTestDiscovery(discovery(), "succeeded").tests).toHaveLength(2);
    expect(
      normalizeJavaTestDiscovery({ ...discovery(), status: "collecting", tests: [] }, "running")
        .status,
    ).toBe("collecting");
    expect(
      normalizeJavaTestDiscovery(
        { ...discovery(), status: "unavailable", tests: [], message: "No supported test provider" },
        "failed",
      ).status,
    ).toBe("unavailable");
  });
  it("rejects inconsistent states, scopes, identities and text limits", () => {
    for (const data of [
      { ...discovery(), scope: "engines" },
      { ...discovery(), status: "collecting" },
      { ...discovery(), status: "unavailable" },
      { ...discovery(), tests: [discovery().tests[0], discovery().tests[0]] },
      { ...discovery(), tests: [{ ...discovery().tests[1], methodName: "selected()" }] },
      { ...discovery(), tests: [{ ...discovery().tests[0], className: "--arguments" }] },
      { ...discovery(), tests: [{ ...discovery().tests[0], label: "\0" }] },
      { ...discovery(), tests: [{ ...discovery().tests[0], label: "😀".repeat(1025) }] },
      { ...discovery(), tests: Array(10001).fill(discovery().tests[0]) },
    ]) {
      expect(() => normalizeJavaTestDiscovery(data, "succeeded")).toThrow(
        "Invalid Java test discovery",
      );
    }
    expect(() => normalizeJavaTestDiscovery(discovery(), "failed")).toThrow();
  });
});

it("retains exact Unicode class and method identities in discovery", () => {
  const data = discovery();
  data.tests[0].className = "café.Próva𐐀";
  data.tests[1].className = "café.Próva𐐀";
  data.tests[1].methodName = "réussit𐐀";
  const result = normalizeJavaTestDiscovery(data, "succeeded");
  expect(result.tests[1].className).toBe("café.Próva𐐀");
  expect(result.tests[1].methodName).toBe("réussit𐐀");
});

it("preserves bounded display-name groups and refuses inconsistent group metadata", () => {
  const base = discovery();
  const method = {
    ...base.tests[1],
    label: "selected()",
    displayNames: ["selected()", "selected(TestInfo)"],
    displayNameCount: 2,
  };
  expect(
    normalizeJavaTestDiscovery({ ...base, tests: [method] }, "succeeded").tests[0].displayNames,
  ).toEqual(method.displayNames);
  for (const change of [
    { displayNameCount: 1 },
    { displayNameCount: 10001 },
    { displayNameCount: 2.5 },
    { displayNames: ["selected()"] },
    { displayNames: ["selected()", "selected()"] },
    { displayNames: ["selected()", "\0"] },
    { displayNameCount: undefined },
    { displayNames: undefined },
    { kind: "class", methodName: null },
    { label: "not among the display names" },
  ])
    expect(() =>
      normalizeJavaTestDiscovery({ ...base, tests: [{ ...method, ...change }] }, "succeeded"),
    ).toThrow();
});
