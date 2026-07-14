import assert from "node:assert/strict";

import type { Locator, Page } from "@playwright/test";

const GEOMETRY_TOLERANCE_PX = 1;
const PANEL_TRANSITION_MS = 250;

interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface SeparatorSemantics {
  readonly orientation: string | null;
  readonly valueMin: number;
  readonly valueNow: number;
  readonly tabIndex: number;
}

interface LayoutSnapshot {
  readonly change: string;
  readonly shell: Rectangle;
  readonly workspace: Rectangle;
  readonly activityRail: Rectangle;
  readonly sidebar: Rectangle;
  readonly editor: Rectangle;
  readonly bottomPanel: Rectangle;
  readonly statusBar: Rectangle;
  readonly topLevelChrome?: Rectangle;
}

interface KeyboardResizeObservation {
  readonly separator: "left sidebar" | "bottom panel";
  readonly before: SeparatorSemantics;
  readonly after: SeparatorSemantics;
  readonly extentBefore: number;
  readonly extentAfter: number;
}

export interface LayoutStoryEvidence {
  readonly target: "web/playwright" | "desktop/tauri-harness";
  readonly nativeGui: boolean;
  readonly e2e: boolean;
  readonly rendering: string;
}

export class ApplicationContentLayoutSession {
  readonly #page: Page;
  readonly #evidence: LayoutStoryEvidence;
  readonly #snapshots: LayoutSnapshot[] = [];
  readonly #keyboardResizes: KeyboardResizeObservation[] = [];

  constructor(page: Page, evidence: LayoutStoryEvidence) {
    this.#page = page;
    this.#evidence = evidence;
  }

  evidence(): LayoutStoryEvidence {
    return this.#evidence;
  }

  async assertApplicationRegionsAvailable(): Promise<void> {
    await this.#page.locator(".ide-shell").waitFor({ state: "visible" });
    await this.#page.getByRole("navigation", { name: "Primary activity" }).waitFor({
      state: "visible",
    });
    await this.#page.getByRole("tabpanel", { name: "Explorer" }).waitFor({ state: "visible" });
    await this.#page.getByRole("main", { name: "Editor area" }).waitFor({ state: "visible" });
    await this.#page.locator(".ide-bottom-panel:not([hidden])").waitFor({ state: "visible" });
    await this.#page.locator(".ide-shell > .statusbar").waitFor({ state: "visible" });

    assert.equal(
      await this.#verticalSeparator().count(),
      1,
      "The expanded left sidebar must expose one keyboard-focusable resize boundary",
    );
    assert.equal(
      await this.#horizontalSeparator().count(),
      1,
      "The expanded bottom panel must expose one keyboard-focusable resize boundary",
    );
  }

  async exercisePanelChanges(): Promise<void> {
    this.#snapshots.length = 0;
    this.#keyboardResizes.length = 0;

    this.#snapshots.push(await this.#capture("expanded"));
    await this.#resizeWithKeyboard(this.#verticalSeparator(), "left sidebar", "ArrowRight");
    this.#snapshots.push(await this.#capture("left-sidebar-keyboard-resized"));
    await this.#resizeWithKeyboard(this.#horizontalSeparator(), "bottom panel", "ArrowUp");
    this.#snapshots.push(await this.#capture("bottom-panel-keyboard-resized"));

    await this.#page.getByRole("button", { name: "Collapse sidebar" }).click();
    await this.#verticalSeparator().waitFor({ state: "detached" });
    await this.#page.waitForTimeout(PANEL_TRANSITION_MS);
    this.#snapshots.push(await this.#capture("left-sidebar-collapsed"));
  }

  assertFullHeightNavigation(): void {
    for (const snapshot of this.#requireSnapshots()) {
      const contentTop = snapshot.workspace.top;
      const contentBottom = snapshot.statusBar.top;
      assertNear(
        snapshot.activityRail.top,
        contentTop,
        `${snapshot.change}: the activity rail must start at the top of application content`,
      );
      assertNear(
        snapshot.activityRail.bottom,
        contentBottom,
        `${snapshot.change}: the activity rail ends at ${snapshot.activityRail.bottom}px, but full-height application content ends at ${contentBottom}px; the current row topology stops navigation above the bottom tool host`,
      );

      if (snapshot.sidebar.width > GEOMETRY_TOLERANCE_PX) {
        assertNear(
          snapshot.sidebar.top,
          contentTop,
          `${snapshot.change}: the visible left sidebar must start at the top of application content`,
        );
        assertNear(
          snapshot.sidebar.bottom,
          contentBottom,
          `${snapshot.change}: the visible left sidebar ends at ${snapshot.sidebar.bottom}px, but full-height application content ends at ${contentBottom}px; the current row topology stops the sidebar above the bottom tool host`,
        );
      }
    }
  }

  assertEditorSideBottomPanel(): void {
    for (const snapshot of this.#requireSnapshots()) {
      assert.ok(
        snapshot.bottomPanel.left + GEOMETRY_TOLERANCE_PX >= snapshot.sidebar.right,
        `${snapshot.change}: the bottom tool host starts at ${snapshot.bottomPanel.left}px before the sidebar right edge at ${snapshot.sidebar.right}px, so it runs beneath navigation`,
      );
      assertNear(
        snapshot.bottomPanel.right,
        snapshot.shell.right,
        `${snapshot.change}: the bottom tool host must occupy the available editor-side width`,
      );
    }
  }

  assertChromeAndStatusBarSeparate(): void {
    for (const snapshot of this.#requireSnapshots()) {
      assertNear(
        snapshot.bottomPanel.bottom,
        snapshot.statusBar.top,
        `${snapshot.change}: the status bar must begin after application content`,
      );
      assertNear(
        snapshot.statusBar.bottom,
        snapshot.shell.bottom,
        `${snapshot.change}: the status bar must remain at the bottom of the shared shell`,
      );

      if (snapshot.topLevelChrome) {
        assertNear(
          snapshot.topLevelChrome.bottom,
          snapshot.shell.top,
          `${snapshot.change}: desktop top-level chrome must remain outside the shared application shell`,
        );
      } else {
        assertNear(
          snapshot.shell.top,
          0,
          `${snapshot.change}: browser chrome must remain outside the standalone web document viewport`,
        );
      }
    }
  }

  assertChromeAndStatusBarStable(): void {
    const [baseline, ...changes] = this.#requireSnapshots();
    for (const snapshot of changes) {
      assertRectangleNear(
        snapshot.statusBar,
        baseline.statusBar,
        `${snapshot.change}: status bar geometry changed with panel geometry`,
      );
      if (baseline.topLevelChrome && snapshot.topLevelChrome) {
        assertRectangleNear(
          snapshot.topLevelChrome,
          baseline.topLevelChrome,
          `${snapshot.change}: top-level chrome geometry changed with panel geometry`,
        );
      }
    }
  }

  assertKeyboardResizeAndAccessibility(): void {
    assert.equal(
      this.#keyboardResizes.length,
      2,
      "Both panel boundaries must be resized by keyboard",
    );

    for (const observation of this.#keyboardResizes) {
      assert.equal(
        observation.before.orientation,
        observation.separator === "left sidebar" ? "vertical" : "horizontal",
      );
      assert.equal(observation.before.tabIndex, 0);
      assert.ok(Number.isFinite(observation.before.valueMin));
      assert.ok(Number.isFinite(observation.before.valueNow));
      assert.equal(observation.after.valueNow, observation.before.valueNow + 10);
      assert.ok(
        observation.extentAfter > observation.extentBefore + GEOMETRY_TOLERANCE_PX,
        `${observation.separator} did not become larger after its documented keyboard resize`,
      );
    }
  }

  async #resizeWithKeyboard(
    separator: Locator,
    separatorName: KeyboardResizeObservation["separator"],
    key: "ArrowRight" | "ArrowUp",
  ): Promise<void> {
    const before = await separatorSemantics(separator);
    const extentBefore = await this.#panelExtent(separatorName);
    await separator.focus();
    await separator.press(key);
    await this.#page.waitForFunction(
      ({ label, expected }) => {
        const element = [...document.querySelectorAll<HTMLElement>("[role='separator']")].find(
          (candidate) => candidate.getAttribute("aria-label") === label,
        );
        return element?.getAttribute("aria-valuenow") === String(expected);
      },
      {
        label: separatorName === "left sidebar" ? "Resize file explorer" : "Resize bottom panel",
        expected: before.valueNow + 10,
      },
    );
    await this.#page.waitForTimeout(PANEL_TRANSITION_MS);

    this.#keyboardResizes.push({
      separator: separatorName,
      before,
      after: await separatorSemantics(separator),
      extentBefore,
      extentAfter: await this.#panelExtent(separatorName),
    });
  }

  async #panelExtent(separator: KeyboardResizeObservation["separator"]): Promise<number> {
    const selector = separator === "left sidebar" ? ".ide-sidebar" : ".ide-bottom-panel";
    const rectangle = await this.#page.locator(selector).boundingBox();
    assert.ok(rectangle, `Could not measure the ${separator}`);
    return separator === "left sidebar" ? rectangle.width : rectangle.height;
  }

  async #capture(change: string): Promise<LayoutSnapshot> {
    const topLevelChrome =
      (await this.#page.locator("[data-story-top-level-chrome]").count()) > 0
        ? await this.#rectangle("[data-story-top-level-chrome]")
        : undefined;

    return {
      change,
      shell: await this.#rectangle(".ide-shell"),
      workspace: await this.#rectangle(".ide-workspace"),
      activityRail: await this.#rectangle(".activity-rail"),
      sidebar: await this.#rectangle(".ide-sidebar"),
      editor: await this.#rectangle(".ide-main-editor-pane"),
      bottomPanel: await this.#rectangle(".ide-bottom-panel:not([hidden])"),
      statusBar: await this.#rectangle(".ide-shell > .statusbar"),
      ...(topLevelChrome ? { topLevelChrome } : {}),
    };
  }

  async #rectangle(selector: string): Promise<Rectangle> {
    const bounds = await this.#page.locator(selector).boundingBox();
    assert.ok(bounds, `Required layout element could not be measured: ${selector}`);
    return {
      ...bounds,
      top: bounds.y,
      right: bounds.x + bounds.width,
      bottom: bounds.y + bounds.height,
      left: bounds.x,
    };
  }

  #verticalSeparator(): Locator {
    return this.#page.getByRole("separator", { name: "Resize file explorer" });
  }

  #horizontalSeparator(): Locator {
    return this.#page.getByRole("separator", { name: "Resize bottom panel" });
  }

  #requireSnapshots(): readonly LayoutSnapshot[] {
    assert.ok(
      this.#snapshots.length > 0,
      "Panel changes must be exercised before geometry is asserted",
    );
    return this.#snapshots;
  }
}

async function separatorSemantics(separator: Locator): Promise<SeparatorSemantics> {
  return separator.evaluate((element) => ({
    orientation: element.getAttribute("aria-orientation"),
    valueMin: Number(element.getAttribute("aria-valuemin")),
    valueNow: Number(element.getAttribute("aria-valuenow")),
    tabIndex: (element as HTMLElement).tabIndex,
  }));
}

function assertNear(actual: number, expected: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= GEOMETRY_TOLERANCE_PX,
    `${message} (expected ${expected}px ± ${GEOMETRY_TOLERANCE_PX}px, received ${actual}px)`,
  );
}

function assertRectangleNear(actual: Rectangle, expected: Rectangle, message: string): void {
  assertNear(actual.x, expected.x, `${message}: x`);
  assertNear(actual.y, expected.y, `${message}: y`);
  assertNear(actual.width, expected.width, `${message}: width`);
  assertNear(actual.height, expected.height, `${message}: height`);
}
