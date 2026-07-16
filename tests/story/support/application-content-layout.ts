import assert from "node:assert/strict";

import type { Locator, Page } from "@playwright/test";

import { captureApplicationLayoutFromDocument as captureApplicationLayoutFromDocumentJs } from "./layout-dom-capture.js";

export const GEOMETRY_TOLERANCE_PX = 1;
const PANEL_TRANSITION_MS = 250;
const SETTLED_SAMPLE_MS = 75;

export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface RegionMeasurement extends Rectangle {
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly hidden: boolean;
  readonly ariaHidden: string | null;
}

export interface SeparatorSemantics {
  readonly label: string | null;
  readonly orientation: string | null;
  readonly valueMin: number;
  readonly valueNow: number;
  readonly tabIndex: number;
}

export interface ToggleSemantics {
  readonly label: string | null;
  readonly expanded: string | null;
  readonly tabIndex: number;
}

export interface LayoutSnapshot {
  readonly change: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly header?: RegionMeasurement;
  readonly shell: RegionMeasurement;
  readonly workspace: RegionMeasurement;
  readonly activityRail: RegionMeasurement;
  readonly sidebar: RegionMeasurement;
  readonly contentColumn: RegionMeasurement;
  readonly editor: RegionMeasurement;
  readonly bottomPanel: RegionMeasurement;
  readonly statusBar: RegionMeasurement;
  readonly verticalSeparator?: SeparatorSemantics;
  readonly horizontalSeparator?: SeparatorSemantics;
  readonly sidebarToggle?: ToggleSemantics;
  readonly bottomPanelToggle?: ToggleSemantics;
  readonly topology: {
    readonly activityRailInWorkspace: boolean;
    readonly sidebarInWorkspace: boolean;
    readonly contentColumnInWorkspace: boolean;
    readonly editorRowInContentColumn: boolean;
    readonly editorInEditorRow: boolean;
    readonly bottomPanelInContentColumn: boolean;
  };
}

export interface KeyboardResizeObservation {
  readonly separator: "left sidebar" | "bottom panel";
  readonly before: SeparatorSemantics;
  readonly after: SeparatorSemantics;
  readonly extentBefore: number;
  readonly extentAfter: number;
}

export interface LayoutStoryEvidence {
  readonly target: string;
  readonly nativeGui: boolean;
  readonly e2e: boolean;
  readonly kind?: string;
  readonly packagedApplication?: boolean;
  readonly rendering?: string;
  readonly browserVersion?: string;
}

export interface ApplicationContentLayoutStorySession {
  assertApplicationRegionsAvailable(): Promise<void>;
  exercisePanelChanges(): Promise<void>;
  exerciseDesktopPanelChanges(): Promise<void>;
  assertFullHeightNavigation(): void;
  assertEditorSideBottomPanel(): void;
  assertChromeAndStatusBarSeparate(): void;
  assertChromeAndStatusBarStable(): void;
  assertKeyboardResizeAndAccessibility(): void;
  evidence(): Readonly<Record<string, unknown>>;
}

export class LayoutGeometryAssertions {
  readonly #snapshots: LayoutSnapshot[] = [];
  readonly #keyboardResizes: KeyboardResizeObservation[] = [];
  #requiresPersistentToggles = false;

  reset(requiresPersistentToggles = false): void {
    this.#snapshots.length = 0;
    this.#keyboardResizes.length = 0;
    this.#requiresPersistentToggles = requiresPersistentToggles;
  }

  addSnapshot(snapshot: LayoutSnapshot): void {
    assert.ok(this.#snapshots.length < 8, "layout evidence must remain bounded to eight states");
    this.#snapshots.push(snapshot);
  }

  addKeyboardResize(observation: KeyboardResizeObservation): void {
    assert.equal(observation.after.valueNow, observation.before.valueNow + 10);
    assertNear(
      observation.extentAfter,
      observation.extentBefore + 10,
      `${observation.separator} must settle at the documented +10px keyboard extent`,
    );
    this.#keyboardResizes.push(observation);
  }

  evidence(): {
    readonly snapshots: readonly LayoutSnapshot[];
    readonly keyboardResizes: readonly KeyboardResizeObservation[];
  } {
    return {
      snapshots: this.#snapshots.map((snapshot) => structuredClone(snapshot)),
      keyboardResizes: this.#keyboardResizes.map((observation) => ({ ...observation })),
    };
  }

  assertFullHeightNavigation(): void {
    for (const snapshot of this.#requireSnapshots()) {
      assertNear(
        snapshot.activityRail.top,
        snapshot.workspace.top,
        `${snapshot.change}: the activity rail must start at the top of application content`,
      );
      assertNear(
        snapshot.activityRail.bottom,
        snapshot.statusBar.top,
        `${snapshot.change}: the activity rail must span the full application-content height`,
      );
      assertNear(
        snapshot.sidebar.top,
        snapshot.workspace.top,
        `${snapshot.change}: the left-sidebar host must start at application-content top`,
      );
      assertNear(
        snapshot.sidebar.bottom,
        snapshot.statusBar.top,
        `${snapshot.change}: the left-sidebar host must span the full application-content height`,
      );
      assert.equal(snapshot.topology.activityRailInWorkspace, true, snapshot.change);
      assert.equal(snapshot.topology.sidebarInWorkspace, true, snapshot.change);
      assert.equal(snapshot.topology.contentColumnInWorkspace, true, snapshot.change);
    }
  }

  assertEditorSideBottomPanel(): void {
    for (const snapshot of this.#requireSnapshots()) {
      assert.equal(snapshot.topology.editorRowInContentColumn, true, snapshot.change);
      assert.equal(snapshot.topology.editorInEditorRow, true, snapshot.change);
      assert.equal(snapshot.topology.bottomPanelInContentColumn, true, snapshot.change);

      if (snapshot.bottomPanel.hidden || snapshot.bottomPanel.ariaHidden === "true") {
        assertNear(
          snapshot.bottomPanel.clientHeight,
          0,
          `${snapshot.change}: hidden bottom tool host must have zero client extent`,
        );
        assert.equal(
          snapshot.horizontalSeparator,
          undefined,
          `${snapshot.change}: a hidden bottom panel must not retain its separator`,
        );
        continue;
      }

      assertNear(
        snapshot.bottomPanel.left,
        snapshot.contentColumn.left,
        `${snapshot.change}: the bottom tool host must begin at the editor-side column`,
      );
      assertNear(
        snapshot.bottomPanel.right,
        snapshot.contentColumn.right,
        `${snapshot.change}: the bottom tool host must occupy only editor-side width`,
      );
      assert.ok(
        snapshot.bottomPanel.left + GEOMETRY_TOLERANCE_PX >= snapshot.sidebar.right,
        `${snapshot.change}: the bottom tool host runs beneath navigation`,
      );
    }
  }

  assertChromeAndStatusBarSeparate(): void {
    for (const snapshot of this.#requireSnapshots()) {
      assertNear(
        snapshot.workspace.bottom,
        snapshot.statusBar.top,
        `${snapshot.change}: the status bar must begin after application content`,
      );
      assertNear(
        snapshot.statusBar.bottom,
        snapshot.shell.bottom,
        `${snapshot.change}: the status bar must remain at shell bottom`,
      );
      if (snapshot.header) {
        assertNear(
          snapshot.header.bottom,
          snapshot.shell.top,
          `${snapshot.change}: application DOM header must remain outside the shell`,
        );
      } else {
        assertNear(
          snapshot.shell.top,
          0,
          `${snapshot.change}: web shell must start at viewport top`,
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
        `${snapshot.change}: status-bar geometry changed with panel geometry`,
      );
      if (baseline.header && snapshot.header) {
        assertRectangleNear(
          snapshot.header,
          baseline.header,
          `${snapshot.change}: application DOM header geometry changed with panel geometry`,
        );
      }
    }
  }

  assertKeyboardResizeAndAccessibility(): void {
    assert.equal(this.#keyboardResizes.length, 2, "Both panel boundaries must be keyboard-resized");
    for (const observation of this.#keyboardResizes) {
      assertSeparatorSemantics(
        observation.before,
        observation.separator === "left sidebar" ? "vertical" : "horizontal",
      );
      assertSeparatorSemantics(
        observation.after,
        observation.separator === "left sidebar" ? "vertical" : "horizontal",
      );
      assert.equal(observation.after.valueNow, observation.before.valueNow + 10);
      assertNear(
        observation.extentAfter,
        observation.extentBefore + 10,
        `${observation.separator} did not retain exact +10px keyboard geometry`,
      );
    }

    for (const snapshot of this.#requireSnapshots()) {
      const bottomVisible =
        !snapshot.bottomPanel.hidden && snapshot.bottomPanel.ariaHidden !== "true";
      if (this.#requiresPersistentToggles) {
        assertPersistentToggle(snapshot, "sidebar", snapshot.sidebar.clientWidth > 1);
        assertPersistentToggle(snapshot, "bottom panel", bottomVisible);
      }
      if (snapshot.sidebar.clientWidth <= 1) {
        assert.equal(snapshot.verticalSeparator, undefined, snapshot.change);
      } else {
        assert.ok(snapshot.verticalSeparator, `${snapshot.change}: left separator is absent`);
        assertSeparatorSemantics(snapshot.verticalSeparator, "vertical");
      }
      if (!bottomVisible) {
        assert.equal(snapshot.horizontalSeparator, undefined, snapshot.change);
      } else {
        assert.ok(snapshot.horizontalSeparator, `${snapshot.change}: bottom separator is absent`);
        assertSeparatorSemantics(snapshot.horizontalSeparator, "horizontal");
      }
    }
  }

  #requireSnapshots(): readonly LayoutSnapshot[] {
    assert.ok(this.#snapshots.length > 0, "Panel changes must be exercised before assertions");
    return this.#snapshots;
  }
}

export class ApplicationContentLayoutSession implements ApplicationContentLayoutStorySession {
  readonly #page: Page;
  readonly #baseEvidence: LayoutStoryEvidence;
  readonly #geometry = new LayoutGeometryAssertions();
  readonly #headerSelector?: string;

  constructor(page: Page, evidence: LayoutStoryEvidence, headerSelector?: string) {
    this.#page = page;
    this.#baseEvidence = evidence;
    this.#headerSelector = headerSelector;
  }

  evidence(): Readonly<Record<string, unknown>> {
    return { ...this.#baseEvidence, ...this.#geometry.evidence() };
  }

  async assertApplicationRegionsAvailable(): Promise<void> {
    await this.#page.locator(".ide-shell").waitFor({ state: "visible" });
    await this.#page.getByRole("navigation", { name: "Primary activity" }).waitFor();
    await this.#page.getByRole("tabpanel", { name: "Explorer" }).waitFor();
    await this.#page.getByRole("main", { name: "Editor area" }).waitFor();
    await this.#page.locator(".ide-bottom-panel:not([hidden])").waitFor();
    await this.#page.locator(".ide-shell > .statusbar").waitFor();
    assert.equal(await this.#verticalSeparator().count(), 1);
    assert.equal(await this.#horizontalSeparator().count(), 1);
  }

  /** Existing web action remains intentionally unchanged. */
  async exercisePanelChanges(): Promise<void> {
    this.#geometry.reset();
    this.#geometry.addSnapshot(await this.#captureSettled("expanded"));
    await this.#resizeWithKeyboard(this.#verticalSeparator(), "left sidebar", "ArrowRight");
    this.#geometry.addSnapshot(await this.#captureSettled("left-sidebar-keyboard-resized"));
    await this.#resizeWithKeyboard(this.#horizontalSeparator(), "bottom panel", "ArrowUp");
    this.#geometry.addSnapshot(await this.#captureSettled("bottom-panel-keyboard-resized"));
    await this.#page.getByRole("button", { name: "Collapse sidebar" }).click();
    await this.#verticalSeparator().waitFor({ state: "detached" });
    this.#geometry.addSnapshot(await this.#captureSettled("left-sidebar-collapsed"));
  }

  async exerciseDesktopPanelChanges(): Promise<void> {
    this.#geometry.reset(true);
    this.#geometry.addSnapshot(await this.#captureSettled("expanded"));
    await this.#resizeWithKeyboard(this.#verticalSeparator(), "left sidebar", "ArrowRight");
    this.#geometry.addSnapshot(await this.#captureSettled("left-sidebar-keyboard-resized"));
    await this.#resizeWithKeyboard(this.#horizontalSeparator(), "bottom panel", "ArrowUp");
    this.#geometry.addSnapshot(await this.#captureSettled("bottom-panel-keyboard-resized"));

    await this.#clickToggle("Collapse sidebar", "true");
    await this.#verticalSeparator().waitFor({ state: "detached" });
    const sidebarCollapsed = await this.#captureSettled("left-sidebar-collapsed");
    this.#geometry.addSnapshot(sidebarCollapsed);
    assertPersistentToggle(sidebarCollapsed, "sidebar", false);

    await this.#clickToggle("Expand sidebar", "false");
    await this.#verticalSeparator().waitFor({ state: "visible" });
    const sidebarReexpanded = await this.#captureSettled("left-sidebar-re-expanded");
    this.#geometry.addSnapshot(sidebarReexpanded);
    assertPersistentToggle(sidebarReexpanded, "sidebar", true);

    await this.#clickToggle("Collapse bottom panel", "true");
    await this.#horizontalSeparator().waitFor({ state: "detached" });
    const bottomCollapsed = await this.#captureSettled("bottom-panel-collapsed");
    this.#geometry.addSnapshot(bottomCollapsed);
    assertPersistentToggle(bottomCollapsed, "bottom panel", false);

    await this.#clickToggle("Expand bottom panel", "false");
    await this.#horizontalSeparator().waitFor({ state: "visible" });
    const bottomReexpanded = await this.#captureSettled("bottom-panel-re-expanded");
    this.#geometry.addSnapshot(bottomReexpanded);
    assertPersistentToggle(bottomReexpanded, "bottom panel", true);
  }

  assertFullHeightNavigation(): void {
    this.#geometry.assertFullHeightNavigation();
  }
  assertEditorSideBottomPanel(): void {
    this.#geometry.assertEditorSideBottomPanel();
  }
  assertChromeAndStatusBarSeparate(): void {
    this.#geometry.assertChromeAndStatusBarSeparate();
  }
  assertChromeAndStatusBarStable(): void {
    this.#geometry.assertChromeAndStatusBarStable();
  }
  assertKeyboardResizeAndAccessibility(): void {
    this.#geometry.assertKeyboardResizeAndAccessibility();
  }

  async #resizeWithKeyboard(
    separator: Locator,
    separatorName: KeyboardResizeObservation["separator"],
    key: "ArrowRight" | "ArrowUp",
  ): Promise<void> {
    const before = await separatorSemantics(separator);
    const extentBefore = await this.#panelExtent(separatorName);
    await separator.focus();
    assert.equal(await separator.evaluate((element) => element === document.activeElement), true);
    await separator.press(key);
    await this.#page.waitForFunction(
      ({ label, expected }) =>
        [...document.querySelectorAll<HTMLElement>("[role='separator']")]
          .find((candidate) => candidate.getAttribute("aria-label") === label)
          ?.getAttribute("aria-valuenow") === String(expected),
      {
        label: separatorName === "left sidebar" ? "Resize file explorer" : "Resize bottom panel",
        expected: before.valueNow + 10,
      },
    );
    await this.#page.waitForTimeout(PANEL_TRANSITION_MS);
    this.#geometry.addKeyboardResize({
      separator: separatorName,
      before,
      after: await separatorSemantics(separator),
      extentBefore,
      extentAfter: await this.#panelExtent(separatorName),
    });
  }

  async #clickToggle(label: string, expectedExpanded: "true" | "false"): Promise<void> {
    const toggle = this.#page.getByRole("button", { name: label, exact: true });
    assert.equal(await toggle.count(), 1, `Required accessible ${label} toggle is missing`);
    assert.equal(await toggle.getAttribute("aria-expanded"), expectedExpanded);
    await toggle.click();
  }

  async #panelExtent(separator: KeyboardResizeObservation["separator"]): Promise<number> {
    const bounds = await this.#page
      .locator(separator === "left sidebar" ? ".ide-sidebar" : ".ide-bottom-panel")
      .boundingBox();
    assert.ok(bounds, `Could not measure the ${separator}`);
    return separator === "left sidebar" ? bounds.width : bounds.height;
  }

  async #captureSettled(change: string): Promise<LayoutSnapshot> {
    await this.#page.waitForTimeout(PANEL_TRANSITION_MS);
    const first = await this.#capture(change);
    await this.#page.waitForTimeout(SETTLED_SAMPLE_MS);
    const second = await this.#capture(change);
    assertLayoutSnapshotSettled(first, second);
    return second;
  }

  async #capture(change: string): Promise<LayoutSnapshot> {
    return await this.#page.evaluate(captureApplicationLayoutFromDocumentJs, {
      change,
      ...(this.#headerSelector ? { headerSelector: this.#headerSelector } : {}),
    });
  }

  #verticalSeparator(): Locator {
    return this.#page.getByRole("separator", { name: "Resize file explorer" });
  }
  #horizontalSeparator(): Locator {
    return this.#page.getByRole("separator", { name: "Resize bottom panel" });
  }
}

export function assertPersistentToggle(
  snapshot: LayoutSnapshot,
  panel: "sidebar" | "bottom panel",
  expanded: boolean,
): void {
  const toggle = panel === "sidebar" ? snapshot.sidebarToggle : snapshot.bottomPanelToggle;
  const expectedLabel = `${expanded ? "Collapse" : "Expand"} ${panel}`;
  assert.ok(
    toggle,
    `${snapshot.change}: missing persistent accessible ${expectedLabel} toggle while the panel is ${expanded ? "expanded" : "collapsed"}`,
  );
  assert.equal(toggle.label, expectedLabel, `${snapshot.change}: incorrect toggle accessible name`);
  assert.equal(toggle.expanded, String(expanded), `${snapshot.change}: incorrect aria-expanded`);
  assert.ok(
    toggle.tabIndex >= 0,
    `${snapshot.change}: ${expectedLabel} must be keyboard-focusable`,
  );
}

export function assertLayoutSnapshotSettled(first: LayoutSnapshot, second: LayoutSnapshot): void {
  for (const key of [
    "header",
    "shell",
    "workspace",
    "activityRail",
    "sidebar",
    "contentColumn",
    "editor",
    "bottomPanel",
    "statusBar",
  ] as const) {
    const before = first[key];
    const after = second[key];
    if (before && after)
      assertRectangleNear(after, before, `${second.change}: ${key} did not settle`);
  }
}

export function assertNear(actual: number, expected: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= GEOMETRY_TOLERANCE_PX,
    `${message} (expected ${expected}px ± ${GEOMETRY_TOLERANCE_PX}px, received ${actual}px)`,
  );
}

export function assertRectangleNear(actual: Rectangle, expected: Rectangle, message: string): void {
  assertNear(actual.x, expected.x, `${message}: x`);
  assertNear(actual.y, expected.y, `${message}: y`);
  assertNear(actual.width, expected.width, `${message}: width`);
  assertNear(actual.height, expected.height, `${message}: height`);
}

function assertSeparatorSemantics(
  semantics: SeparatorSemantics,
  orientation: "vertical" | "horizontal",
): void {
  assert.equal(semantics.orientation, orientation);
  assert.equal(semantics.tabIndex, 0);
  assert.ok(Number.isFinite(semantics.valueMin));
  assert.ok(Number.isFinite(semantics.valueNow));
}

async function separatorSemantics(separator: Locator): Promise<SeparatorSemantics> {
  return await separator.evaluate((element) => ({
    label: element.getAttribute("aria-label"),
    orientation: element.getAttribute("aria-orientation"),
    valueMin: Number(element.getAttribute("aria-valuemin")),
    valueNow: Number(element.getAttribute("aria-valuenow")),
    tabIndex: (element as HTMLElement).tabIndex,
  }));
}
