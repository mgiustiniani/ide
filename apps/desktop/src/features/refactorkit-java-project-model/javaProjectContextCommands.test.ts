import { describe, expect, it, vi } from "vitest";
import { javaProjectContextCommands, type JavaProjectCommandState } from "./javaProjectContextCommands";

function fixture() {
  let current: JavaProjectCommandState = {
    workspaceId: "one", generation: 2, isSwitching: false, isMetadataLoading: false, isWriting: false,
    controller: {
      settings: { projectPath: "maven", sdkHome: "/jdk", mavenRepository: "", activeMavenProfiles: [], inactiveMavenProfiles: [] },
      isBusy: false, synchronize: vi.fn(async () => {}), evaluateGradle: vi.fn(async () => {}),
    },
  };
  const open = vi.fn();
  return { get current() { return current; }, replace: (value: JavaProjectCommandState) => { current = value; },
    open, commands: () => javaProjectContextCommands(current, () => current, open) };
}

describe("Java Project commands", () => {
  it("synchronizes saved inputs through the current controller without evaluating Gradle", async () => {
    const f = fixture();
    const commands = f.commands();
    expect(commands.map(c => c.id)).toEqual(["java.project-context.synchronize"]);
    const fresh = vi.fn(async () => {});
    f.replace({ ...f.current, controller: { ...f.current.controller, synchronize: fresh } });
    await commands[0].run();
    expect(f.open).toHaveBeenCalledOnce();
    expect(fresh).toHaveBeenCalledOnce();
    expect(f.current.controller.evaluateGradle).not.toHaveBeenCalled();
  });

  it("offers Gradle evaluation separately only with valid settings", async () => {
    const f = fixture();
    f.current.controller.settings.gradle = { executable: "/tools/gradle", userHome: "", projectProperties: {} };
    const commands = f.commands();
    await commands.find(c => c.id === "java.project-context.synchronize")!.run();
    expect(f.current.controller.evaluateGradle).not.toHaveBeenCalled();
    await commands.find(c => c.id === "java.project-context.evaluate-gradle")!.run();
    expect(f.current.controller.evaluateGradle).toHaveBeenCalledOnce();
    f.current.controller.settings.gradle.executable = "relative/gradle";
    expect(f.commands().map(c => c.id)).toEqual(["java.project-context.synchronize"]);
  });

  it.each(["workspace", "generation", "switching", "loading", "writing", "busy", "settings", "sdk"])(
    "withholds unavailable commands and refuses a retained command after %s changes", async reason => {
      const f = fixture();
      const saved = f.commands()[0];
      if (reason === "workspace") f.current.workspaceId = "two";
      if (reason === "generation") f.current.generation++;
      if (reason === "switching") f.current.isSwitching = true;
      if (reason === "loading") f.current.isMetadataLoading = true;
      if (reason === "writing") f.current.isWriting = true;
      if (reason === "busy") f.current.controller.isBusy = true;
      if (reason === "settings") f.current.controller.settings.projectPath = "other";
      if (reason === "sdk") f.current.controller.settings.sdkHome = "";
      await saved.run();
      expect(f.open).not.toHaveBeenCalled();
      expect(f.current.controller.synchronize).not.toHaveBeenCalled();
      expect(f.current.controller.evaluateGradle).not.toHaveBeenCalled();
      if (!["workspace", "generation", "settings"].includes(reason)) expect(f.commands()).toEqual([]);
    },
  );

  it.each([false, true])("leaves progress visible while the %s Gradle-evaluation request is pending", evaluate => {
    const f = fixture();
    f.current.controller.settings.gradle = { executable: "/tools/gradle", userHome: "", projectProperties: {} };
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const start = vi.fn(() => pending);
    if (evaluate) f.current.controller.evaluateGradle = start;
    else f.current.controller.synchronize = start;
    const command = f.commands().find(c => c.id === (evaluate ? "java.project-context.evaluate-gradle" : "java.project-context.synchronize"))!;
    expect(command.run()).toBeUndefined();
    expect(start).toHaveBeenCalledOnce();
    expect(f.open).toHaveBeenCalledOnce();
    finish();
  });

  it("does not offer acquisition without a workspace", () => {
    const f = fixture(); f.current.workspaceId = null;
    expect(f.commands()).toEqual([]);
  });

  it("refuses a retained Gradle command after toolchain settings change", async () => {
    const f = fixture();
    f.current.controller.settings.gradle = { executable: "/tools/gradle", userHome: "", projectProperties: {} };
    const saved = f.commands().find(c => c.id === "java.project-context.evaluate-gradle")!;
    f.current.controller.settings.gradle.gradleRuntimeHome = "/another-jdk";
    await saved.run();
    expect(f.open).not.toHaveBeenCalled();
    expect(f.current.controller.evaluateGradle).not.toHaveBeenCalled();
  });
});
