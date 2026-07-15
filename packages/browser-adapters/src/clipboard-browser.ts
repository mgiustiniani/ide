import type { ClipboardPort } from "@ide/web-core/ports";

/** Error raised when the browser does not expose the asynchronous Clipboard API. */
export class BrowserClipboardUnavailableError extends Error {
  readonly code = "BROWSER_CLIPBOARD_UNAVAILABLE";

  constructor() {
    super("Clipboard reading is unavailable in this browser context.");
    this.name = "BrowserClipboardUnavailableError";
  }
}

/** Error raised when the browser rejects an explicit clipboard read request. */
export class BrowserClipboardReadDeniedError extends Error {
  readonly code = "BROWSER_CLIPBOARD_READ_DENIED";

  constructor() {
    super("Clipboard read permission was denied.");
    this.name = "BrowserClipboardReadDeniedError";
  }
}

/** Browser clipboard access performed only when the use case explicitly calls readText. */
export class BrowserClipboardAdapter implements ClipboardPort {
  async readText(): Promise<string> {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard || typeof clipboard.readText !== "function") {
      throw new BrowserClipboardUnavailableError();
    }

    try {
      return await clipboard.readText();
    } catch {
      // Do not expose browser rejection details because they may contain clipboard data.
      throw new BrowserClipboardReadDeniedError();
    }
  }
}
