import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserClipboardAdapter,
  BrowserClipboardReadDeniedError,
  BrowserClipboardUnavailableError,
  createBrowserAdapters,
} from "../index";

function installClipboard(readText: () => Promise<string>): void {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { readText },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis.navigator, "clipboard");
});

describe("BrowserClipboardAdapter", () => {
  it("returns the exact text from navigator.clipboard.readText", async () => {
    const content = " exact clipboard text\n";
    const readText = vi.fn().mockResolvedValue(content);
    installClipboard(readText);

    await expect(new BrowserClipboardAdapter().readText()).resolves.toBe(content);
    expect(readText).toHaveBeenCalledOnce();
  });

  it("raises a typed unavailable error when the Clipboard API is absent", async () => {
    const result = new BrowserClipboardAdapter().readText();

    await expect(result).rejects.toBeInstanceOf(BrowserClipboardUnavailableError);
    await expect(result).rejects.toMatchObject({
      code: "BROWSER_CLIPBOARD_UNAVAILABLE",
      message: "Clipboard reading is unavailable in this browser context.",
    });
  });

  it("redacts rejected API details and clipboard content", async () => {
    const clipboardContent = "private clipboard content";
    installClipboard(
      vi
        .fn()
        .mockRejectedValue(
          new DOMException(`Denied while reading: ${clipboardContent}`, "NotAllowedError"),
        ),
    );

    const error = await new BrowserClipboardAdapter().readText().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BrowserClipboardReadDeniedError);
    expect(error).toMatchObject({
      code: "BROWSER_CLIPBOARD_READ_DENIED",
      message: "Clipboard read permission was denied.",
    });
    expect(String(error)).not.toContain(clipboardContent);
    expect(error).not.toHaveProperty("cause");
  });

  it("does not read until readText is explicitly invoked", async () => {
    const readText = vi.fn().mockResolvedValue("content");
    installClipboard(readText);

    const adapter = new BrowserClipboardAdapter();
    const adapters = createBrowserAdapters();

    expect(adapters.clipboardAdapter).toBeInstanceOf(BrowserClipboardAdapter);
    expect(readText).not.toHaveBeenCalled();

    await adapter.readText();
    expect(readText).toHaveBeenCalledOnce();
  });

  it("does not install timers or event listeners", async () => {
    const readText = vi.fn().mockResolvedValue("content");
    installClipboard(readText);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const windowListenerSpy = vi.spyOn(globalThis, "addEventListener");
    const documentListenerSpy = vi.spyOn(globalThis.document, "addEventListener");

    const adapter = new BrowserClipboardAdapter();
    await adapter.readText();

    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(windowListenerSpy).not.toHaveBeenCalled();
    expect(documentListenerSpy).not.toHaveBeenCalled();
  });
});
