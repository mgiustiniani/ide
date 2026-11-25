import { describe, expect, it } from "vitest";
import { javaSourceRootTargetPath } from "./javaSourceRootTargetPath";

describe("javaSourceRootTargetPath", () => {
  it("keeps v3/v4 provider paths workspace-relative", () => {
    expect(
      javaSourceRootTargetPath(
        "gradle",
        "gradle/unrelated/src/extra/java",
        "java-project-context-v3",
      ),
    ).toBe("gradle/unrelated/src/extra/java");
    expect(
      javaSourceRootTargetPath(
        "maven",
        "maven/unrelated/src/extra/java",
        "java-project-context-v4",
      ),
    ).toBe("maven/unrelated/src/extra/java");
    expect(
      javaSourceRootTargetPath(
        "gradle",
        "gradle/unrelated/src/extra/java",
        "java-project-context-v6",
      ),
    ).toBe("gradle/unrelated/src/extra/java");
  });

  it("qualifies v1/v2 paths relative to the selected project", () => {
    expect(
      javaSourceRootTargetPath("maven", "unrelated/src/extra/java", "java-project-context-v2"),
    ).toBe("maven/unrelated/src/extra/java");
  });

  it("keeps the v7 Maven source-root review target workspace-relative", () => {
    expect(
      javaSourceRootTargetPath("maven", "maven/app/src/extra/java", "java-project-context-v7"),
    ).toBe("maven/app/src/extra/java");
  });
});
