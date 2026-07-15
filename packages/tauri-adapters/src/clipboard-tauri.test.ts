import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriClipboardAdapter } from "./clipboard-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

describe("TauriClipboardAdapter", () => {
  beforeEach(() => invokeMock.mockReset());

  it("reads text with the fixed command and no arguments", async () => {
    invokeMock.mockResolvedValueOnce("class Example {}");
    await expect(new TauriClipboardAdapter().readText()).resolves.toBe("class Example {}");
    expect(invokeMock).toHaveBeenCalledWith("read_clipboard_text");
  });

  it("redacts native errors and malformed values", async () => {
    const secret = "class SecretClipboardSource {}";
    invokeMock.mockRejectedValueOnce({ message: secret });
    const error = await new TauriClipboardAdapter().readText().catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriClipboardReadError",
      code: "TAURI_CLIPBOARD_READ_FAILED",
    });
    expect(String(error)).not.toContain(secret);
    expect(error).not.toHaveProperty("cause");

    invokeMock.mockResolvedValueOnce({ text: secret });
    await expect(new TauriClipboardAdapter().readText()).rejects.toThrow(
      "Clipboard text could not be read.",
    );
  });
});
