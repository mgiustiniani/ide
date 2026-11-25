import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EDITOR_RECOVERY_MAX_FILE_BYTES } from "../../../packages/contracts/src/editor-recovery.js";
import { NativeEditorSurface, textKeySequence } from "./native-editor-surface.js";
import type { NativeDesktopApplication } from "./native-desktop-application.js";

// The UTF-16 character count is below the limit; UTF-8 is exactly at the limit.
export const NATIVE_RECOVERY_CAPACITY_SOURCE = "é".repeat(EDITOR_RECOVERY_MAX_FILE_BYTES / 2);
export const NATIVE_RECOVERY_OVERSIZED_BUFFER = NATIVE_RECOVERY_CAPACITY_SOURCE + "!";
const MAX_COPIED_BYTES = EDITOR_RECOVERY_MAX_FILE_BYTES + 1;

/** Monaco virtualizes large buffers: copy via real keyboard, then independently read X11 clipboard. */
export class NativeEditorLargeBuffer {
  constructor(private readonly application: NativeDesktopApplication) {}
  async assertCopied(file: string, expected: string): Promise<void> {
    assert.ok(Buffer.byteLength(expected) <= MAX_COPIED_BYTES);
    assert.ok(["capacity-proof.txt", "companion.txt"].includes(file));
    const browser = this.application.browser();
    await browser
      .$(`[role="textbox"][aria-label^="Code editor for ${file}"]`)
      .waitForDisplayed({ timeout: 15_000 });
    await new NativeEditorSurface(this.application).focus(file);
    await browser.keys(["Control", "a"]);
    await browser.keys(["Control", "c"]);
    const { stdout } = await promisify(execFile)(
      "/usr/bin/python3",
      [
        "-c",
        "import gi; gi.require_version('Gtk','3.0'); from gi.repository import Gtk, Gdk; value=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text(); print(value if value is not None else '',end='')",
      ],
      {
        env: { ...process.env, GDK_BACKEND: "x11" },
        timeout: 5_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    // Do not let assertion diagnostics emit a MiB of source content.
    assert.ok(
      stdout === expected,
      `Native clipboard buffer mismatch: ${Buffer.byteLength(stdout)} observed bytes, ${Buffer.byteLength(expected)} expected bytes${expected.length <= 128 ? `; bounded text ${JSON.stringify(stdout.slice(0, 64))}` : ""}`,
    );
    await browser.keys(["Control", "Home"]);
  }
  async replace(file: string, content: string): Promise<void> {
    assert.ok(Array.from(content).length <= 128, "large-buffer fixture typing must stay bounded");
    const browser = this.application.browser();
    await new NativeEditorSurface(this.application).focus(file);
    await browser.keys(["Control", "a"]);
    try {
      await browser.performActions([
        { type: "key", id: "native-recovery-bounded-typing", actions: textKeySequence(content) },
      ]);
    } finally {
      await browser.releaseActions();
    }
    await this.assertCopied(file, content);
    await new NativeEditorSurface(this.application).assertDirty(file, true);
  }
  async open(file: string, expected: string): Promise<void> {
    assert.ok(["capacity-proof.txt", "companion.txt"].includes(file));
    const browser = this.application.browser();
    const item = browser.$(`[role="treeitem"][data-path="${file}"]`);
    await item.waitForDisplayed({ timeout: 15_000 });
    await item.click();
    const tab = new NativeEditorSurface(this.application).tab(file);
    await tab.waitForDisplayed({ timeout: 15_000 });
    assert.equal(await tab.getAttribute("aria-selected"), "true");
    await this.assertCopied(file, expected);
  }
}
