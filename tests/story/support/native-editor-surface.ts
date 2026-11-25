import assert from "node:assert/strict";
import type { NativeDesktopApplication } from "./native-desktop-application.js";
import { assertNativeCopiedText, pasteNativeText } from "./native-text-input.js";
const css = (text: string) => text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
export function textKeySequence(text: string): Array<{ type: "keyDown" | "keyUp"; value: string }> {
  return Array.from(text).flatMap((value) => [
    { type: "keyDown" as const, value },
    { type: "keyUp" as const, value },
  ]);
}

/** Read accessible production DOM and edit through real mouse/keyboard actions. */
export class NativeEditorSurface {
  constructor(private readonly application: Pick<NativeDesktopApplication, "browser">) {}
  private browser() {
    return this.application.browser();
  }
  tab(file: string) {
    return this.browser().$(`[role="tab"][data-path="${css(file)}"]`);
  }
  input(file: string) {
    return this.browser().$(`[role="textbox"][aria-label^="${css(`Code editor for ${file}`)}"]`);
  }
  async open(file: string, expected: string, readBack: "rendered" | "clipboard" = "rendered"): Promise<void> {
    const item = this.browser().$(`[role="treeitem"][data-path="${css(file)}"]`);
    await item.waitForDisplayed({ timeout: 15_000, interval: 100 });
    await item.scrollIntoView({ block: "center", inline: "nearest" });
    await item.waitForClickable({ timeout: 15_000 });
    await item.waitForStable({ timeout: 5_000 });
    await item.click();
    await this.browser().waitUntil(
      async () => (await item.getAttribute("aria-selected")) === "true",
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: `The file tree did not select ${file}`,
      },
    );
    await this.tab(file).waitForDisplayed({ timeout: 15_000 });
    await this.assertBuffer(file, expected, readBack);
    assert.equal(await this.tab(file).getAttribute("aria-selected"), "true");
  }
  async renderedText({
    includeInjectedText = false,
    file,
  }: { includeInjectedText?: boolean; file?: string } = {}) {
    return this.browser().execute(
      (includeInjections, filePath) => {
        const input = filePath
          ? Array.from(document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]')).find(
              (element) => element.getAttribute("aria-label") === `Code editor for ${filePath}`,
            )
          : null;
        const host = filePath ? input?.closest(".monaco-code-editor-host") : null;
        if (filePath && !host) return "";
        const root: ParentNode = host ?? document;
        return Array.from(
          root.querySelectorAll<HTMLElement>(".monaco-editor .view-lines .view-line"),
        )
          .map((line) => ({
            line,
            bounds: line.getBoundingClientRect(),
          }))
          .filter(({ line, bounds }) => line.getClientRects().length > 0 && bounds.height > 0)
          .sort(
            (left, right) =>
              left.bounds.top - right.bounds.top || left.bounds.left - right.bounds.left,
          )
          .map(({ line }) => {
            const copy = line.cloneNode(true) as HTMLElement;
            if (!includeInjections) {
              for (const element of copy.querySelectorAll<HTMLElement>("[class]")) {
                if (Array.from(element.classList).some((name) => name.startsWith("dyn-rule-")))
                  element.remove();
              }
            }
            return copy.textContent ?? "";
          })
          .join("\n")
          .replaceAll("\u00a0", " ");
      },
      includeInjectedText,
      file ?? null,
    );
  }
  private hasFocus(file: string): Promise<boolean> {
    // Observe the current DOM directly: Monaco may replace its input between
    // WebDriver's element lookup and isFocused while a language document opens.
    return this.browser().execute((filePath) => {
      const input = Array.from(document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'))
        .find((element) => element.getAttribute("aria-label") === `Code editor for ${filePath}`);
      return input !== undefined && document.activeElement === input;
    }, file);
  }
  async focus(file: string): Promise<void> {
    // Monaco paints input overlays above tokens, and long lines extend beyond
    // the viewport. Observe a visible point inside the rendered editor, then use
    // real pointer actions; never call focus(), dispatchEvent() or the private API.
    if (await this.hasFocus(file)) return;
    const point = await this.browser().waitUntil(
      async () =>
        (await this.browser().execute((filePath) => {
          const input = Array.from(
            document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
          ).find((element) => element.getAttribute("aria-label") === `Code editor for ${filePath}`);
          const editor = input
            ?.closest(".monaco-code-editor-host")
            ?.querySelector(".monaco-editor");
          if (!editor) return null;
          const editorBounds = editor.getBoundingClientRect();
          if (editorBounds.width < 16 || editorBounds.height < 16) return null;
          const clamp = (value: number, minimum: number, maximum: number) =>
            Math.min(maximum, Math.max(minimum, value));
          const candidates = [];
          // Virtualized lines can remain rendered above the viewport. Clicking a
          // clamped coordinate there can hit Monaco's sticky header instead of text.
          for (const line of Array.from(editor.querySelectorAll(".view-lines .view-line")).slice(0, 128)) {
            const bounds = line.getBoundingClientRect();
            if (bounds.width > 0 && bounds.height > 0 && bounds.top >= editorBounds.top + 4 && bounds.bottom <= editorBounds.bottom - 4) {
              candidates.push({
                x: clamp(Math.max(bounds.left + 8, editorBounds.left + 88), editorBounds.left + 4, editorBounds.right - 4),
                y: bounds.top + bounds.height / 2,
              });
            }
          }
          candidates.push(
            {
              x: editorBounds.left + Math.min(96, editorBounds.width / 2),
              y: editorBounds.top + Math.min(32, editorBounds.height / 2),
            },
            {
              x: editorBounds.left + editorBounds.width / 2,
              y: editorBounds.top + editorBounds.height / 2,
            },
          );
          for (const candidate of candidates) {
            const x = Math.round(candidate.x),
              y = Math.round(candidate.y),
              hit = document.elementFromPoint(x, y);
            if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight &&
                hit instanceof Element && editor.contains(hit) && hit.closest(".view-lines"))
              return { x, y };
          }
          return null;
        }, file)) || false,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "visible Monaco surface unavailable",
      },
    );
    await this.browser()
      .action("pointer")
      .move({ ...point, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
    await this.browser().waitUntil(() => this.hasFocus(file), {
      timeout: 2_000,
      interval: 50,
      timeoutMsg: "visible Monaco click did not focus its input",
    });
  }
  async openContextMenu(file: string): Promise<void> {
    const point = await this.browser().execute((filePath) => {
      const input = Array.from(
        document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
      ).find((element) => element.getAttribute("aria-label") === `Code editor for ${filePath}`);
      const editor = input?.closest(".monaco-code-editor-host")?.querySelector(".monaco-editor");
      const line = editor?.querySelector(".view-lines .view-line");
      if (!editor || !line) throw new Error("Java editor text surface is unavailable");
      const bounds = line.getBoundingClientRect();
      const editorBounds = editor.getBoundingClientRect();
      const x = Math.round(Math.max(bounds.left + 8, editorBounds.left + 88));
      const y = Math.round(Math.max(bounds.top + bounds.height / 2, editorBounds.top + 12));
      const hit = document.elementFromPoint(x, y);
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || !editor.contains(hit))
        throw new Error("Java editor text surface is not available for a context click");
      return { x, y };
    }, file);
    await this.browser()
      .action("pointer")
      .move({ ...point, origin: "viewport" })
      .down({ button: 2 })
      .up({ button: 2 })
      .perform();
  }
  async contextMenuItem(label: string): Promise<{ x: number; y: number } | null> {
    return this.browser().execute((expectedLabel) => {
      const roots: Array<Document | ShadowRoot> = [document];
      while (roots.length) {
        const root = roots.pop()!;
        for (const menu of root.querySelectorAll<HTMLElement>(".monaco-menu")) {
          if (!menu.getClientRects().length) continue;
          for (const item of menu.querySelectorAll<HTMLElement>(
            '[role="menuitem"].action-menu-item',
          )) {
            const actionLabel = item.querySelector<HTMLElement>(".action-label");
            if (
              actionLabel?.getAttribute("aria-label") === expectedLabel &&
              !item.classList.contains("disabled")
            ) {
              item.scrollIntoView({ block: "center", inline: "nearest" });
              const bounds = item.getBoundingClientRect();
              const menuBounds = menu.getBoundingClientRect();
              if (bounds.bottom <= menuBounds.top || bounds.top >= menuBounds.bottom) return null;
              return {
                x: Math.round(bounds.left + bounds.width / 2),
                y: Math.round(bounds.top + bounds.height / 2),
              };
            }
          }
        }
        for (const element of root.querySelectorAll<HTMLElement>("*"))
          if (element.shadowRoot) roots.push(element.shadowRoot);
      }
      return null;
    }, label);
  }
  async replace(file: string, content: string, expectedDirty = true): Promise<void> {
    await pasteNativeText(this.application, this.input(file), content, {
      focus: () => this.focus(file),
      verify: async () => (await this.renderedText({ file })) === content,
    });
    await this.assertBuffer(file, content);
    await this.assertDirty(file, expectedDirty);
  }
  async replaceText(
    file: string,
    search: string,
    replacement: string,
    expected: string,
  ): Promise<void> {
    assert.ok(search.length > 0);
    await this.focus(file);
    await this.browser().keys(["Control", "f"]);
    const find = this.browser().$('[aria-label="Find"]');
    await find.waitForDisplayed({ timeout: 5_000 });
    await find.setValue(search);
    await this.browser().keys(["Escape"]);
    try {
      await this.browser().performActions([
        { type: "key", id: "native-editor-replacement", actions: textKeySequence(replacement) },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.assertBuffer(file, expected);
    await this.assertDirty(file, true);
  }
  async replaceCharacter(
    file: string,
    offset: number,
    character: string,
    expected: string,
    options: { readBack?: "rendered" | "clipboard"; dirty?: boolean } = {},
  ): Promise<void> {
    assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset < 256);
    assert.equal(Array.from(character).length, 1);
    await this.focus(file);
    await this.browser().keys(["Control", "Home"]);
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "native-editor-position",
          actions: textKeySequence("\uE014".repeat(offset)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.browser().keys(["Shift", "ArrowRight"]);
    await this.browser().keys(character);
    await this.assertBuffer(file, expected, options.readBack);
    await this.assertDirty(file, options.dirty ?? true);
  }
  async selectText(file: string, selectedText: string): Promise<void> {
    assert.ok(selectedText.length > 0);
    await this.focus(file);
    const visibleText = await this.renderedText({ file });
    const start = visibleText.indexOf(selectedText);
    assert.ok(start >= 0, `Selected Java text is not visible in ${file}`);
    await this.browser().keys(["Control", "Home"]);
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "native-editor-select-java-text",
          actions: textKeySequence("\uE014".repeat(start)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    for (let index = 0; index < selectedText.length; index++)
      await this.browser().keys(["Shift", "ArrowRight"]);
  }
  async assertBuffer(file: string, expected: string, readBack: "rendered" | "clipboard" = "rendered"): Promise<void> {
    await this.browser().waitUntil(
      () =>
        this.browser().execute(
          (filePath) =>
            Array.from(document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]')).some(
              (input) =>
                input.getAttribute("aria-label") === `Code editor for ${filePath}` &&
                input.getClientRects().length > 0,
            ),
          file,
        ),
      {
        timeout: 15_000,
        interval: 50,
        timeoutMsg: `Java editor input for ${file} was not displayed`,
      },
    );
    if (readBack === "clipboard") {
      await this.focus(file);
      await assertNativeCopiedText(this.application, expected);
      return;
    }
    let observed = "";
    try {
      await this.browser().waitUntil(
        async () => {
          observed = await this.renderedText({ file });
          return observed === expected;
        },
        {
          timeout: 15_000,
          interval: 50,
          timeoutMsg: `exact rendered buffer for ${file} did not match`,
        },
      );
    } catch {
      let difference = 0;
      while (
        difference < Math.min(observed.length, expected.length) &&
        observed[difference] === expected[difference]
      )
        difference += 1;
      throw new Error(
        `Rendered fixture mismatch for ${file}: observed length ${observed.length}, expected ${expected.length}, first difference ${difference}, bounded fixture text ${JSON.stringify(observed.slice(Math.max(0, difference - 24), difference + 64))}`,
      );
    }
  }
  async assertDirty(file: string, dirty: boolean): Promise<void> {
    await this.browser().waitUntil(
      async () => (await this.tab(file).$('[aria-label="Unsaved changes"]').isExisting()) === dirty,
      { timeout: 5_000, interval: 50, timeoutMsg: `${file} dirty state mismatch` },
    );
  }
  async save(file: string): Promise<void> {
    await this.focus(file);
    await this.browser().keys(["Control", "s"]);
  }
  async assertAlert(message: string): Promise<void> {
    await this.browser().waitUntil(
      async () => {
        const alerts = await this.browser().$$('[role="alert"]').getElements();
        return (await alerts.map((el) => el.getText())).includes(message);
      },
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: "expected visible safety refusal was not presented",
      },
    );
  }
  async discardUsingDisk(
    file: string,
    expected: string,
    {
      verifyClipboard = false,
      verifyRenderedBuffer = true,
      expectedBuffer,
      staleReviewRetries = 0,
    }: {
      verifyClipboard?: boolean;
      verifyRenderedBuffer?: boolean;
      expectedBuffer?: string;
      staleReviewRetries?: number;
    } = {},
  ): Promise<void> {
    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    for (let attempt = 0; attempt <= staleReviewRetries; attempt += 1) {
      if (expectedBuffer !== undefined) await this.assertBuffer(file, expectedBuffer);
      await this.browser().$("button=Compare with disk").click();
      await dialog.waitForDisplayed({ timeout: 10_000 });
      assert.equal(await dialog.getComputedLabel(), "Compare with disk");
      const inspected = await this.browser().execute(
        () =>
          document.querySelector('[role="dialog"] [aria-label="Inspected disk version"] pre')
            ?.textContent ?? null,
      );
      assert.equal(inspected, expected);
      if (expectedBuffer !== undefined) await this.assertBuffer(file, expectedBuffer);
      await this.browser().$("button=Discard buffer edits and use disk version").click();

      let outcome: "closed" | "stale" | undefined;
      try {
        await this.browser().waitUntil(
          async () => {
            if (!(await dialog.isExisting())) {
              outcome = "closed";
              return true;
            }
            const stale = await this.browser().execute(() =>
              Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]')).some((item) =>
                item.innerText.includes(
                  "The buffer or its save baseline changed. Compare again; no edits were discarded.",
                ),
              ),
            );
            if (stale) {
              outcome = "stale";
              return true;
            }
            return false;
          },
          { timeout: 30_000, interval: 50 },
        );
      } catch {
        outcome = undefined;
      }
      if (outcome === "closed") break;
      if (outcome === "stale" && attempt < staleReviewRetries && expectedBuffer !== undefined) {
        await this.assertBuffer(file, expectedBuffer);
        await this.assertDirty(file, true);
        await this.browser().$("button=Keep editor buffer").click();
        await dialog.waitForExist({ reverse: true, timeout: 5_000 });
        continue;
      }

      const remaining = await this.browser().execute(() => ({
        dialogs: Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).map(
          (item) => ({
            label:
              item.getAttribute("aria-label") ??
              item.getAttribute("aria-labelledby") ??
              item.getAttribute("aria-describedby"),
            text: item.innerText.slice(0, 1_000),
            visible: item.getClientRects().length > 0,
          }),
        ),
        alerts: Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]')).map(
          (item) => ({
            text: item.innerText.slice(0, 500),
            visible: item.getClientRects().length > 0,
          }),
        ),
        buttons: Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
          .filter((button) => button.getClientRects().length > 0)
          .map((button) => ({ text: button.innerText, disabled: button.disabled }))
          .slice(-20),
      }));
      throw new Error(
        `Compare with disk remained after confirmation: ${JSON.stringify(remaining)}`,
      );
    }
    await this.assertDirty(file, false);
    if (verifyClipboard) {
      await this.focus(file);
      await assertNativeCopiedText(this.application, expected);
    } else if (verifyRenderedBuffer) {
      await this.assertBuffer(file, expected);
    }
  }
}
