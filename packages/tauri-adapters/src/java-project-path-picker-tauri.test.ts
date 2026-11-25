import { beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { TauriAdapterError } from "./errors";
import { TauriJavaProjectPathPickerAdapter } from "./java-project-path-picker-tauri";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
const openMock = vi.mocked(open);

describe("TauriJavaProjectPathPickerAdapter", () => {
  beforeEach(() => openMock.mockReset());

  it("returns one absolute directory and one absolute file without exposing dialog APIs to the UI", async () => {
    const adapter = new TauriJavaProjectPathPickerAdapter();
    openMock.mockResolvedValueOnce("/opt/jdks/temurin-25");
    openMock.mockResolvedValueOnce("/workspace/app");
    openMock.mockResolvedValueOnce("/opt/gradle/bin/gradle");

    await expect(adapter.selectDirectory()).resolves.toBe("/opt/jdks/temurin-25");
    await expect(adapter.selectDirectory("/workspace")).resolves.toBe("/workspace/app");
    await expect(adapter.selectFile()).resolves.toBe("/opt/gradle/bin/gradle");
    expect(openMock).toHaveBeenNthCalledWith(1, { directory: true, multiple: false });
    expect(openMock).toHaveBeenNthCalledWith(2, {
      directory: true,
      defaultPath: "/workspace",
      multiple: false,
    });
    expect(openMock).toHaveBeenNthCalledWith(3, { directory: false, multiple: false });
  });

  it("preserves cancellation and rejects multiple, relative or malformed paths", async () => {
    const adapter = new TauriJavaProjectPathPickerAdapter();
    openMock.mockResolvedValueOnce(null);
    await expect(adapter.selectDirectory()).resolves.toBeNull();

    for (const result of [["/one", "/two"], "relative/path", "", "/bad\0path"]) {
      openMock.mockResolvedValueOnce(result as never);
      await expect(adapter.selectFile()).rejects.toBeInstanceOf(TauriAdapterError);
    }
    await expect(adapter.selectDirectory("relative/path")).rejects.toBeInstanceOf(
      TauriAdapterError,
    );
  });

  it("returns a workspace-relative XML path from the formatter profile dialog", async () => {
    openMock.mockResolvedValueOnce("/workspace/app/config/format.xml");
    await expect(
      new TauriJavaProjectPathPickerAdapter().selectWorkspaceXmlFile("/workspace/app"),
    ).resolves.toBe("config/format.xml");
    expect(openMock).toHaveBeenCalledWith({
      directory: false,
      defaultPath: "/workspace/app",
      multiple: false,
      filters: [{ name: "Eclipse formatter profile", extensions: ["xml"] }],
    });
  });

  it("preserves cancellation and refuses files outside the workspace", async () => {
    openMock.mockResolvedValueOnce(null);
    await expect(
      new TauriJavaProjectPathPickerAdapter().selectWorkspaceXmlFile("/workspace/app"),
    ).resolves.toBeNull();

    openMock.mockResolvedValueOnce("/workspace/other/format.xml");
    await expect(
      new TauriJavaProjectPathPickerAdapter().selectWorkspaceXmlFile("/workspace/app"),
    ).rejects.toThrow("inside the active workspace");
  });

  it("hides native dialog rejection details", async () => {
    openMock.mockRejectedValueOnce(new Error("private dialog detail"));
    await expect(new TauriJavaProjectPathPickerAdapter().selectDirectory()).rejects.toThrow(
      "The Java project path dialog failed.",
    );
  });
});
