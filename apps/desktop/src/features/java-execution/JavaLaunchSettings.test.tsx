import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { JavaLaunchConfiguration } from "@ide/contracts";
import { JavaLaunchSettings } from "./JavaLaunchSettings";
import { validateLaunchSettings } from "./javaLaunchSettings";

const configuration: JavaLaunchConfiguration = {
  buildTool: "jdk",
  mainClass: "Main",
  classPath: [],
  programArguments: ["", "two words"],
  jvmOptions: ["-Xmx96m", "-Dnote=before"],
  testJvmOptions: ["-Xmx128m", "-Dnote=test"],
  environment: [{ name: "MODE", value: "" }],
};
describe("Java launch settings", () => {
  it("accepts provider-qualified selections and restores legacy selections for unique resolution", () => {
    expect(
      validateLaunchSettings({
        ...configuration,
        projectModule: { moduleId: "app", sourceSetId: "main" },
      }),
    ).toBeNull();
    expect(
      validateLaunchSettings({
        ...configuration,
        projectModule: {
          providerId: "maven-effective-v1",
          moduleId: "app",
          sourceSetId: "main",
        },
      }),
    ).toBeNull();
    expect(
      validateLaunchSettings({
        ...configuration,
        projectModule: { providerId: "", moduleId: "app", sourceSetId: "main" },
      }),
    ).not.toBeNull();
  });

  it("retains bounded incomplete attach drafts but admits only valid JDI endpoints", () => {
    const attach = {
      ...configuration,
      debuggerMode: "jdi" as const,
      debuggerAttach: { host: "localhost", port: "5005" },
    };
    expect(validateLaunchSettings(attach, false, "attach")).toBeNull();
    for (const target of [
      { host: "", port: "5005" },
      { host: "host/path", port: "5005" },
      { host: "*", port: "5005" },
      { host: "::1", port: "0" },
      { host: "::1", port: "65536" },
    ]) {
      const draft = { ...attach, debuggerAttach: target };
      expect(validateLaunchSettings(draft, true)).toBeNull();
      expect(validateLaunchSettings(draft, false, "attach")).not.toBeNull();
      expect(validateLaunchSettings(draft, false, "run")).toBeNull();
    }
    expect(validateLaunchSettings({ ...attach, debuggerMode: "jdb" }, false, "attach")).toContain(
      "JDI",
    );
  });
  it("edits literal values, preserves an empty argument and removes only the selected row", () => {
    const update = vi.fn();
    render(
      <JavaLaunchSettings
        configuration={configuration}
        capabilities={null}
        disabled={false}
        update={update}
      />,
    );
    expect(screen.getByLabelText("Argument 1")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Argument 2"), {
      target: { value: "both'\"quotes\n😀" },
    });
    expect(update).toHaveBeenLastCalledWith({
      ...configuration,
      programArguments: ["", "both'\"quotes\n😀"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove argument 2" }));
    expect(update).toHaveBeenLastCalledWith({ ...configuration, programArguments: [""] });
    fireEvent.click(screen.getByRole("button", { name: "Add argument" }));
    expect(update).toHaveBeenLastCalledWith({
      ...configuration,
      programArguments: ["", "two words", ""],
    });
    fireEvent.change(screen.getByLabelText("Variable 1 value"), {
      target: { value: "literal = spaced'\"😀" },
    });
    expect(update).toHaveBeenLastCalledWith({
      ...configuration,
      environment: [{ name: "MODE", value: "literal = spaced'\"😀" }],
    });
    fireEvent.change(screen.getByLabelText("JDK directory (absolute; optional)"), {
      target: { value: "/opt/jdk-21" },
    });
    expect(update).toHaveBeenLastCalledWith({ ...configuration, jdkHome: "/opt/jdk-21" });
  });
  it("keeps launch settings disabled during task preparation or execution", () => {
    const update = vi.fn();
    render(
      <JavaLaunchSettings
        configuration={configuration}
        capabilities={null}
        disabled
        update={update}
      />,
    );
    for (const label of [
      "Argument 1",
      "Argument 2",
      "JVM option 1",
      "JVM option 2",
      "Test JVM option 1",
      "Test JVM option 2",
      "Variable 1 name",
      "Variable 1 value",
      "JDK directory (absolute; optional)",
    ])
      expect(screen.getByLabelText(label)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add argument" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add JVM option" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add test JVM option" })).toBeDisabled();
  });
  it("edits test JVM options independently and validates only the operation that consumes them", () => {
    const update = vi.fn();
    render(
      <JavaLaunchSettings
        configuration={configuration}
        capabilities={null}
        disabled={false}
        update={update}
      />,
    );
    const value = "-Dtest=both'\"quotes\\slash\n😀";
    fireEvent.change(screen.getByLabelText("Test JVM option 2"), { target: { value } });
    expect(update).toHaveBeenLastCalledWith({
      ...configuration,
      testJvmOptions: ["-Xmx128m", value],
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove test JVM option 1" }));
    expect(update).toHaveBeenLastCalledWith({ ...configuration, testJvmOptions: ["-Dnote=test"] });
    fireEvent.click(screen.getByRole("button", { name: "Add test JVM option" }));
    expect(update).toHaveBeenLastCalledWith({
      ...configuration,
      testJvmOptions: [...configuration.testJvmOptions!, ""],
    });
    for (const testJvmOptions of [[""], ["-jar"], ["-Dide.test.jvm.options=spoof"]]) {
      expect(
        validateLaunchSettings({ ...configuration, testJvmOptions }, false, "test"),
      ).not.toBeNull();
      expect(
        validateLaunchSettings({ ...configuration, testJvmOptions }, false, "coverage"),
      ).not.toBeNull();
      expect(
        validateLaunchSettings({ ...configuration, testJvmOptions }, false, "integration-test"),
      ).not.toBeNull();
      expect(
        validateLaunchSettings({ ...configuration, testJvmOptions }, false, "integration-coverage"),
      ).not.toBeNull();
      expect(validateLaunchSettings({ ...configuration, testJvmOptions }, true)).toBeNull();
      for (const operation of ["build", "run", "debug"] as const)
        expect(
          validateLaunchSettings({ ...configuration, testJvmOptions }, false, operation),
        ).toBeNull();
    }
    for (const testJvmOptions of [
      ["bad\0"],
      Array(129).fill("-ea"),
      ["x".repeat(4097)],
      Array(5).fill("x".repeat(4096)),
    ])
      for (const operation of [
        "build",
        "run",
        "test",
        "integration-test",
        "integration-coverage",
        "debug",
      ] as const)
        expect(
          validateLaunchSettings({ ...configuration, testJvmOptions }, false, operation),
        ).not.toBeNull();
  });
  it("preserves each JVM option as a literal value and removes only its selected row", () => {
    const update = vi.fn();
    render(
      <JavaLaunchSettings
        configuration={configuration}
        capabilities={null}
        disabled={false}
        update={update}
      />,
    );
    const value = "-Dnote=both'\"quotes\\slash\n😀";
    fireEvent.change(screen.getByLabelText("JVM option 2"), { target: { value } });
    expect(update).toHaveBeenLastCalledWith({ ...configuration, jvmOptions: ["-Xmx96m", value] });
    fireEvent.click(screen.getByRole("button", { name: "Remove JVM option 1" }));
    expect(update).toHaveBeenLastCalledWith({ ...configuration, jvmOptions: ["-Dnote=before"] });
    fireEvent.click(screen.getByRole("button", { name: "Add JVM option" }));
    expect(update).toHaveBeenLastCalledWith({
      ...configuration,
      jvmOptions: ["-Xmx96m", "-Dnote=before", ""],
    });
  });
  it("retains bounded JVM option drafts but refuses launcher selectors and oversized values before execution", () => {
    for (const jvmOptions of [
      [""],
      ["Main"],
      ["@file"],
      ["-cp"],
      ["--class-path=outside"],
      ["-jar"],
      ["--module=other"],
      ["--source=21"],
      ["--"],
    ]) {
      expect(validateLaunchSettings({ ...configuration, jvmOptions })).not.toBeNull();
      expect(validateLaunchSettings({ ...configuration, jvmOptions }, true)).toBeNull();
      expect(validateLaunchSettings({ ...configuration, jvmOptions }, false, "build")).toBeNull();
      expect(validateLaunchSettings({ ...configuration, jvmOptions }, false, "test")).toBeNull();
    }
    for (const jvmOptions of [
      ["bad\0"],
      ["-Dvalue=" + "x".repeat(4096)],
      Array(129).fill("-ea"),
      Array(5).fill("-Dvalue=" + "x".repeat(4096 - 8)),
    ])
      expect(validateLaunchSettings({ ...configuration, jvmOptions }, true)).not.toBeNull();
    expect(
      validateLaunchSettings({
        ...configuration,
        jvmOptions: [
          "-Dempty=",
          "-Dvalue=both'\"quotes\n😀",
          "--add-opens=java.base/java.lang=ALL-UNNAMED",
        ],
      }),
    ).toBeNull();
  });
  it("refuses duplicate/reserved environment names, invalid JDK paths and oversized literal values", () => {
    expect(validateLaunchSettings(configuration)).toBeNull();
    for (const environment of [
      [
        { name: "MODE", value: "one" },
        { name: "MODE", value: "two" },
      ],
      [{ name: "JAVA_HOME", value: "/other" }],
      [{ name: "1NAME", value: "" }],
      [{ name: "MODE", value: "bad\0" }],
    ])
      expect(validateLaunchSettings({ ...configuration, environment })).not.toBeNull();
    for (const programArguments of [
      ["x".repeat(4097)],
      Array(129).fill(""),
      Array(5).fill("x".repeat(4096)),
      ["bad\0"],
    ])
      expect(validateLaunchSettings({ ...configuration, programArguments })).not.toBeNull();
    for (const jdkHome of ["relative", "/jdk\nother"])
      expect(validateLaunchSettings({ ...configuration, jdkHome })).toMatch(/absolute/);
    expect(validateLaunchSettings({ ...configuration, jdkHome: "C:\\Java\\jdk" })).toBeNull();
  });
});

it("edits a separate application directory without replacing the project or launch arguments", () => {
  const update = vi.fn();
  render(<JavaLaunchSettings configuration={{ ...configuration, projectPath: "modules/app" }} capabilities={null} disabled={false} update={update} />);
  fireEvent.change(screen.getByLabelText("Application working directory (workspace-relative; optional)"), { target: { value: "run assets/servízio's" } });
  expect(update).toHaveBeenLastCalledWith({ ...configuration, projectPath: "modules/app", workingDirectory: "run assets/servízio's" });
});

it("admits bounded directory drafts but rejects unsafe Run/Debug paths without blocking Build or Tests", () => {
  for (const value of ["", ".", "run assets/servízio's", "modules/app/runtime"]) {
    expect(validateLaunchSettings({ ...configuration, workingDirectory: value }, false, "run")).toBeNull();
  }
  for (const value of ["../outside", "/tmp", "C:/data", "a\\b", "a/../b", "a//b", "a\n"]) {
    const draft = { ...configuration, workingDirectory: value };
    expect(validateLaunchSettings(draft, true)).toBeNull();
    expect(validateLaunchSettings(draft, false, "run")).not.toBeNull();
    expect(validateLaunchSettings(draft, false, "debug")).not.toBeNull();
    expect(validateLaunchSettings(draft, false, "build")).toBeNull();
    expect(validateLaunchSettings(draft, false, "test")).toBeNull();
    expect(validateLaunchSettings(draft, false, "discover")).toBeNull();
  }
  expect(validateLaunchSettings({ ...configuration, workingDirectory: "a\0" }, true)).not.toBeNull();
});
