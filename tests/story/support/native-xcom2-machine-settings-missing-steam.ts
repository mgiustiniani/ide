import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { remote } from "webdriverio";

import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

const REQUIREMENT = "REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001" as const;
const WORKSPACE_NAME = "generic-workspace" as const;
const DRIVER_START_TIMEOUT_MS = 10_000;
const SESSION_START_TIMEOUT_MS = 20_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_LIMIT = 16 * 1024;

const EXPECTED_EMPTY_LOCATIONS = [
  { binding: "HOME", location: "home" },
  { binding: "XDG_CONFIG_HOME", location: "xdg/config" },
  { binding: "XDG_CACHE_HOME", location: "xdg/cache" },
  { binding: "XDG_DATA_HOME", location: "xdg/data" },
  { binding: "XDG_STATE_HOME", location: "xdg/state" },
  { binding: "XDG_RUNTIME_DIR", location: "xdg/runtime" },
  { binding: "IDE_HOME", location: "ide-home" },
  { binding: "authorized generic workspace", location: WORKSPACE_NAME },
] as const;

const EXPECTED_PRODUCT_DETAILS = Object.freeze({
  "Download progress": "Progress unknown",
  "Download bytes": "Unknown downloaded / Unknown total",
  "Staging progress": "Progress unknown",
  "Staging bytes": "Unknown staged / Unknown total",
  StateFlags: "Not reported",
  "Size on disk": "Unknown",
  "Install directory present": "No",
  "Download directory present": "No",
  "Last update": "No manifest found",
  Completeness: "Incomplete",
  "Completeness evidence": "Steam appmanifest was not found",
  Stability: "Unstable",
  "Stability evidence": "Product state is unavailable",
  Mutation: "Blocked",
});

const CLAIMS_EXCLUDED = Object.freeze([
  "refresh or reopen",
  "Plan Setup or canPlan",
  "transaction area",
  "project activity or tools",
  "post-launch filesystem identity",
  "polling or subscription lifecycle",
  "live Steam or machine correctness",
  "application package, bundle, or installer",
  "Wayland, other operating systems, or other DPI",
]);

type Browser = Awaited<ReturnType<typeof remote>>;
type StoryElement = WebdriverIO.Element;
type DriverExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
type ProductRow = {
  readonly product: string;
  readonly "Steam AppID": string;
  readonly role: string;
  readonly "accessible lifecycle": string;
};
type FieldRow = { readonly field: string; readonly value: string };
type PositionedRow = { readonly position: string; readonly value: string };

interface MissingSteamEvidence {
  readonly requirement: typeof REQUIREMENT;
  readonly sourceContentsIncluded: false;
  readonly absolutePathsIncluded: false;
  readonly boundary: {
    readonly target: "desktop/tauri-webdriver";
    readonly platform: "Linux X11";
    readonly dom: "production Tauri WebKit DOM";
    readonly artifactKind: "release-no-bundle";
    readonly packagedApplication: false;
    readonly nativeGui: true;
    readonly e2e: true;
    readonly noApplicationInterceptionOrInjection: true;
    readonly claimsExcluded: readonly string[];
  };
  emptyLocationsVerified?: readonly string[];
  applicationProcessObserved?: boolean;
  viewport?: { readonly width: 1440; readonly height: 900 };
  workspaceReady?: boolean;
  settingsControlActivated?: boolean;
  settingsDialogMatched?: boolean;
  xcom2TabMatched?: boolean;
  headingMatched?: boolean;
  badgeMatched?: boolean;
  detailsRegionMatched?: boolean;
  missingSteamNoteMatched?: boolean;
  aggregateFieldsMatched?: boolean;
  blockersMatched?: boolean;
  productCardsMatched?: boolean;
  productDetailsMatched?: boolean;
  mutationReasonsMatched?: boolean;
  localPathDisclosureExcluded?: boolean;
  windowClosed?: boolean;
  executableExited?: boolean;
  environmentRestored?: boolean;
  scenarioSandboxRemoved?: boolean;
  ownedProcessesRemaining?: number;
  disposed?: boolean;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function requiredAbsoluteEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`Native missing-Steam Settings Story requires absolute ${name}`);
  }
  return path.normalize(value);
}

function requiredPositiveInteger(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Native missing-Steam Settings Story requires positive integer ${name}`);
  }
  return value;
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function freeTcpPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a missing-Steam Settings Story TCP port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function processExists(processId: number): Promise<boolean> {
  try {
    await access(`/proc/${processId}`, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function childProcessIds(processId: number): Promise<number[]> {
  try {
    return (await readFile(`/proc/${processId}/task/${processId}/children`, "utf8"))
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}

async function descendants(processId: number): Promise<number[]> {
  const result: number[] = [];
  const pending = [processId];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const child of await childProcessIds(current)) {
      result.push(child);
      pending.push(child);
    }
  }
  return result;
}

async function findExecutableDescendant(
  processId: number,
  executablePath: string,
): Promise<number | undefined> {
  for (const descendant of await descendants(processId)) {
    try {
      if ((await readlink(`/proc/${descendant}/exe`)) === executablePath) return descendant;
    } catch {
      // A process can exit between discovery and inspection.
    }
  }
  return undefined;
}

async function exactTextElements(
  owner: StoryElement,
  selector: string,
  expectedText: string,
): Promise<StoryElement[]> {
  const matches: StoryElement[] = [];
  for (const element of await owner.$$(selector).getElements()) {
    if (normalizeText(await element.getText()) === expectedText) matches.push(element);
  }
  return matches;
}

async function definitionValue(owner: StoryElement, label: string): Promise<string> {
  const matchingTerms: StoryElement[] = [];
  for (const term of await owner.$$("dt").getElements()) {
    if (normalizeText(await term.getText()).replace(/:\s*$/u, "") === label) {
      matchingTerms.push(term);
    }
  }
  assert.equal(matchingTerms.length, 1, `Expected exactly one definition term ${label}`);
  const parent = await matchingTerms[0]!.$("..");
  return normalizeText(await (await parent.$("dd")).getText());
}

async function labelledEvidence(
  owner: StoryElement,
  label: "Completeness" | "Stability" | "Mutation",
): Promise<{ value: string; evidence: string[] }> {
  const matches: StoryElement[] = [];
  for (const term of await owner.$$("dt").getElements()) {
    if (normalizeText(await term.getText()).startsWith(`${label}: `)) matches.push(term);
  }
  assert.equal(matches.length, 1, `Expected exactly one ${label} definition`);
  const termText = normalizeText(await matches[0]!.getText());
  const parent = await matches[0]!.$("..");
  const evidence = [];
  for (const item of await parent.$$("dd li").getElements()) {
    evidence.push(normalizeText(await item.getText()));
  }
  return { value: termText.slice(label.length + 2), evidence };
}

export class NativeXcom2MachineSettingsMissingSteamSession {
  readonly #runnerSandbox = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SANDBOX_PATH");
  readonly #applicationPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_APPLICATION_PATH");
  readonly #tauriDriverPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH");
  readonly #webKitWebDriverPath = requiredAbsoluteEnvironment(
    "IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH",
  );
  readonly #desiredWidth = requiredPositiveInteger("IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_WIDTH");
  readonly #desiredHeight = requiredPositiveInteger("IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_HEIGHT");
  readonly #evidence: MissingSteamEvidence = {
    requirement: REQUIREMENT,
    sourceContentsIncluded: false,
    absolutePathsIncluded: false,
    boundary: {
      target: "desktop/tauri-webdriver",
      platform: "Linux X11",
      dom: "production Tauri WebKit DOM",
      artifactKind: "release-no-bundle",
      packagedApplication: false,
      nativeGui: true,
      e2e: true,
      noApplicationInterceptionOrInjection: true,
      claimsExcluded: CLAIMS_EXCLUDED,
    },
  };
  #lease?: NativeScenarioEnvironmentLease;
  #driver?: ChildProcess;
  #driverExit?: Promise<DriverExit>;
  #driverDiagnostic = "";
  #browser?: Browser;
  #applicationProcessId?: number;
  #sessionDeleted = false;
  #disposed = false;

  async allocateEmptyScenario(
    rows: readonly { binding: string; location: string }[],
  ): Promise<void> {
    assert.equal(process.env.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
    assert.equal(process.env.GDK_BACKEND, "x11");
    assert.equal(process.env.WAYLAND_DISPLAY, undefined);
    assert.deepEqual(rows, EXPECTED_EMPTY_LOCATIONS);
    assert.equal(this.#lease, undefined, "missing-Steam Settings scenario was already allocated");

    const lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT, {
      workspaceName: WORKSPACE_NAME,
    });
    this.#lease = lease;
    assert.equal(lease.runnerSandbox, this.#runnerSandbox);
    await lease.assertConfiguredPathsConfined();

    const locations = new Map<string, string>([
      ["HOME", lease.paths.home],
      ["XDG_CONFIG_HOME", lease.paths.xdgConfig],
      ["XDG_CACHE_HOME", lease.paths.xdgCache],
      ["XDG_DATA_HOME", lease.paths.xdgData],
      ["XDG_STATE_HOME", lease.paths.xdgState],
      ["XDG_RUNTIME_DIR", lease.paths.xdgRuntime],
      ["IDE_HOME", lease.paths.ideHome],
      ["authorized generic workspace", lease.paths.workspace],
    ]);
    const canonicalRoot = await realpath(lease.paths.root);
    const canonicalLocations: string[] = [];
    for (const expected of EXPECTED_EMPTY_LOCATIONS) {
      const location = locations.get(expected.binding);
      assert.ok(location, `No scenario location is configured for ${expected.binding}`);
      assert.ok(isContained(canonicalRoot, await realpath(location)));
      if (expected.binding === "authorized generic workspace") {
        assert.equal(path.basename(location), expected.location);
      } else {
        assert.equal(path.relative(lease.paths.root, location), expected.location);
      }
      assert.deepEqual(
        await readdir(location),
        [],
        `${expected.binding} was not empty before launch`,
      );
      canonicalLocations.push(await realpath(location));
    }
    assert.equal(new Set(canonicalLocations).size, EXPECTED_EMPTY_LOCATIONS.length);
    assert.equal(process.env.IDE_WORKSPACE_ROOT, lease.paths.workspace);
    this.#evidence.emptyLocationsVerified = EXPECTED_EMPTY_LOCATIONS.map(({ binding }) => binding);
  }

  async launch(): Promise<void> {
    const lease = this.lease();
    assert.deepEqual(
      this.#evidence.emptyLocationsVerified,
      EXPECTED_EMPTY_LOCATIONS.map(({ binding }) => binding),
    );
    assert.equal(process.env.IDE_WORKSPACE_ROOT, lease.paths.workspace);
    assert.equal(this.#driver, undefined, "missing-Steam Settings session was already launched");
    assert.equal(this.#desiredWidth, 1440);
    assert.equal(this.#desiredHeight, 900);
    await Promise.all([
      access(this.#tauriDriverPath, fsConstants.X_OK),
      access(this.#webKitWebDriverPath, fsConstants.X_OK),
      access(this.#applicationPath, fsConstants.X_OK),
    ]);
    assert.equal((await stat(this.#applicationPath)).isFile(), true);

    const [port, nativePort] = await Promise.all([freeTcpPort(), freeTcpPort()]);
    assert.notEqual(port, nativePort);
    const driver = spawn(
      this.#tauriDriverPath,
      [
        "--port",
        String(port),
        "--native-port",
        String(nativePort),
        "--native-host",
        "127.0.0.1",
        "--native-driver",
        this.#webKitWebDriverPath,
      ],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.#driver = driver;
    const capture = (chunk: Buffer): void => {
      this.#driverDiagnostic = `${this.#driverDiagnostic}${chunk.toString("utf8")}`.slice(
        -DIAGNOSTIC_LIMIT,
      );
    };
    driver.stdout?.on("data", capture);
    driver.stderr?.on("data", capture);
    this.#driverExit = new Promise((resolve, reject) => {
      driver.once("error", reject);
      driver.once("exit", (code, signal) => resolve({ code, signal }));
    });

    try {
      await this.waitForDriver(port);
      this.#browser = await bounded(
        remote({
          hostname: "127.0.0.1",
          port,
          path: "/",
          logLevel: "silent",
          connectionRetryCount: 0,
          connectionRetryTimeout: SESSION_START_TIMEOUT_MS,
          capabilities: {
            "tauri:options": { application: this.#applicationPath },
          } as Parameters<typeof remote>[0]["capabilities"],
        }),
        SESSION_START_TIMEOUT_MS,
        "WebdriverIO missing-Steam Settings session start",
      );
      this.#applicationProcessId = await this.waitForApplicationProcess();
      this.#evidence.applicationProcessObserved = true;
      await this.browser().setWindowSize(this.#desiredWidth, this.#desiredHeight);
    } catch (error) {
      await this.dispose();
      throw new Error(`${String(error)}\n${this.redactedDiagnostics()}`);
    }
  }

  async assertViewport(): Promise<void> {
    const html = await this.browser().$("html");
    await this.browser().waitUntil(
      async () => {
        const size = await html.getSize();
        return size.width === 1440 && size.height === 900;
      },
      { timeout: 5_000, interval: 50, timeoutMsg: "WebKit DOM viewport is not exactly 1440x900" },
    );
    assert.deepEqual(await html.getSize(), { width: 1440, height: 900 });
    this.#evidence.viewport = { width: 1440, height: 900 };
  }

  async assertWorkspaceReady(): Promise<void> {
    const explorer = await this.browser().$('[role="tree"][aria-label="File Explorer"]');
    await explorer.waitForDisplayed({ timeout: 15_000, interval: 50 });
    const workspaceExplorer = await this.browser().$(".workspace-explorer");
    if (await workspaceExplorer.isExisting()) {
      await this.browser().waitUntil(
        async () => (await workspaceExplorer.getAttribute("aria-busy")) !== "true",
        { timeout: 15_000, interval: 50, timeoutMsg: "generic workspace remained busy" },
      );
    }
    assert.equal(process.env.IDE_WORKSPACE_ROOT, this.lease().paths.workspace);
    assert.equal(await explorer.getAttribute("role"), "tree");
    assert.equal(await explorer.getComputedLabel(), "File Explorer");
    this.#evidence.workspaceReady = true;
  }

  async activateVisibleControl(name: string): Promise<void> {
    assert.equal(name, "Settings");
    const header = await this.browser().$("#root > div > header");
    const controls = await exactTextElements(header as unknown as StoryElement, "button", name);
    assert.equal(controls.length, 1);
    const control = controls[0]!;
    await control.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await control.getComputedLabel(), name);
    assert.equal(await control.isEnabled(), true);
    await control.click();
    this.#evidence.settingsControlActivated = true;
  }

  async assertSettingsDialog(name: string): Promise<void> {
    assert.equal(name, "Settings");
    const dialog = await this.settingsDialog();
    assert.equal(await dialog.getAttribute("role"), "dialog");
    assert.equal(await dialog.getAttribute("aria-modal"), "true");
    assert.equal(await dialog.getComputedLabel(), name);
    this.#evidence.settingsDialogMatched = true;
  }

  async selectSettingsTab(
    navigationName: string,
    label: string,
    description: string,
  ): Promise<void> {
    assert.deepEqual(
      { navigationName, label, description },
      { navigationName: "Settings sections", label: "XCOM 2", description: "Global machine setup" },
    );
    const dialog = await this.settingsDialog();
    const navigation = await dialog.$('nav[aria-label="Settings sections"]');
    await navigation.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await navigation.getComputedLabel(), navigationName);
    const matches: StoryElement[] = [];
    for (const tab of await navigation.$$('[role="tab"]').getElements()) {
      const spans = await tab.$$("span").getElements();
      if (
        spans.length === 2 &&
        normalizeText(await spans[0]!.getText()) === label &&
        normalizeText(await spans[1]!.getText()) === description
      ) {
        matches.push(tab);
      }
    }
    assert.equal(matches.length, 1);
    await matches[0]!.click();
  }

  async assertTabSelected(label: string): Promise<void> {
    assert.equal(label, "XCOM 2");
    const tab = await this.xcom2Tab();
    await this.browser().waitUntil(
      async () => (await tab.getAttribute("aria-selected")) === "true",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "XCOM 2 Settings tab was not selected",
      },
    );
    assert.equal(await tab.getAttribute("aria-selected"), "true");
    this.#evidence.xcom2TabMatched = true;
  }

  async assertHeading(text: string): Promise<void> {
    assert.equal(text, "XCOM 2 WOTC Setup");
    const dialog = await this.settingsDialog();
    const matches = await exactTextElements(dialog, "h1,h2,h3,h4,h5,h6", text);
    assert.equal(matches.length, 1);
    assert.equal(await matches[0]!.getTagName(), "h2");
    assert.equal(await matches[0]!.getComputedLabel(), text);
    this.#evidence.headingMatched = true;
  }

  async assertBadge(text: string): Promise<void> {
    assert.equal(text, "Built-in · Experimental");
    const matches = await exactTextElements(await this.settingsDialog(), "span", text);
    assert.equal(matches.length, 1);
    await matches[0]!.waitForDisplayed({ timeout: 5_000, interval: 50 });
    this.#evidence.badgeMatched = true;
  }

  async assertFocusableDetailsRegion(name: string): Promise<void> {
    assert.equal(name, "XCOM 2 setup monitor details");
    const details = await this.detailsRegion();
    await details.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await details.getComputedLabel(), name);
    assert.equal(await details.getAttribute("tabindex"), "0");
    this.#evidence.detailsRegionMatched = true;
  }

  async assertExactMissingSteamNote(text: string): Promise<void> {
    assert.equal(text, "Steam products were not found. Install them through Steam, then refresh.");
    const details = await this.detailsRegion();
    const firstNote = await details.$('[role="note"]');
    await firstNote.waitForDisplayed({ timeout: 15_000, interval: 50 });
    const notes = await details.$$('[role="note"]').getElements();
    assert.deepEqual(
      await Promise.all([...notes].map(async (note) => normalizeText(await note.getText()))),
      [text],
      "MISSING_UI_CAPABILITY: native XCOM machine Settings does not present the approved exact missing-Steam note",
    );
    this.#evidence.missingSteamNoteMatched = true;
  }

  async assertAggregateFields(sectionName: string, rows: readonly FieldRow[]): Promise<void> {
    assert.equal(sectionName, "Aggregate setup state");
    const expected = Object.fromEntries(rows.map(({ field, value }) => [field, value]));
    assert.deepEqual(expected, {
      "Overall state": "Not Found",
      Warnings: "No warnings reported",
      "Steam discovery provenance": "Unknown (path redacted)",
    });
    const section = await this.namedSection(sectionName);
    const observed = {
      "Overall state": await definitionValue(section, "Overall state"),
      Warnings: await definitionValue(section, "Warnings"),
      "Steam discovery provenance": await this.exactPrefixedText(
        section,
        "p",
        "Steam discovery provenance:",
      ),
    };
    assert.deepEqual(observed, expected);
    this.#evidence.aggregateFieldsMatched = true;
  }

  async assertOrderedBlockers(rows: readonly PositionedRow[]): Promise<void> {
    assert.deepEqual(
      rows.map(({ position }) => position),
      ["1", "2", "3", "4"],
    );
    const section = await this.namedSection("Aggregate setup state");
    const terms = await exactTextElements(section, "dt", "Setup blockers");
    assert.equal(terms.length, 1);
    const parent = await terms[0]!.$("..");
    const observed: string[] = [];
    for (const item of await parent.$$("dd li").getElements()) {
      observed.push(normalizeText(await item.getText()));
    }
    assert.deepEqual(
      observed,
      rows.map(({ value }) => value),
    );
    this.#evidence.blockersMatched = true;
  }

  async assertProductCards(sectionName: string, rows: readonly ProductRow[]): Promise<void> {
    assert.equal(sectionName, "Monitored Steam products");
    const products = await this.productsRegion();
    const cards = await products.$$("article").getElements();
    assert.equal(cards.length, rows.length);
    for (const [index, expected] of rows.entries()) {
      const card = cards[index]!;
      const headings = await card.$$("h3").getElements();
      assert.equal(headings.length, 1);
      assert.equal(normalizeText(await headings[0]!.getText()), expected.product);
      const headingId = await headings[0]!.getAttribute("id");
      assert.ok(headingId);
      assert.equal(await card.getAttribute("aria-labelledby"), headingId);
      const metadata = await exactTextElements(
        card,
        "header p",
        `Steam AppID ${expected["Steam AppID"]} · ${expected.role}`,
      );
      assert.equal(metadata.length, 1);
      const statuses = await card.$$('[role="status"]').getElements();
      assert.equal(statuses.length, 1);
      assert.equal(normalizeText(await statuses[0]!.getText()), expected["accessible lifecycle"]);
      assert.equal(
        await statuses[0]!.getComputedLabel(),
        `${expected.product} lifecycle: ${expected["accessible lifecycle"]}`,
      );
    }
    this.#evidence.productCardsMatched = true;
  }

  async assertEveryProductDetail(rows: readonly FieldRow[]): Promise<void> {
    const expected = Object.fromEntries(rows.map(({ field, value }) => [field, value]));
    assert.deepEqual(expected, EXPECTED_PRODUCT_DETAILS);
    for (const card of await this.productCards()) {
      const productName = normalizeText(await (await card.$("h3")).getText());
      const download = await card.$(
        `[role="progressbar"][aria-label="${productName} download progress"]`,
      );
      const staging = await card.$(
        `[role="progressbar"][aria-label="${productName} staging progress"]`,
      );
      assert.equal(await download.getAttribute("aria-valuetext"), expected["Download progress"]);
      assert.equal(await download.getAttribute("aria-valuenow"), null);
      assert.equal(await staging.getAttribute("aria-valuetext"), expected["Staging progress"]);
      assert.equal(await staging.getAttribute("aria-valuenow"), null);
      assert.equal((await exactTextElements(card, "p", expected["Download bytes"]!)).length, 1);
      assert.equal((await exactTextElements(card, "p", expected["Staging bytes"]!)).length, 1);

      for (const label of [
        "StateFlags",
        "Size on disk",
        "Install directory present",
        "Download directory present",
        "Last update",
      ] as const) {
        assert.equal(await definitionValue(card, label), expected[label]);
      }
      for (const label of ["Completeness", "Stability", "Mutation"] as const) {
        const observation = await labelledEvidence(card, label);
        assert.equal(observation.value, expected[label]);
        if (label !== "Mutation") {
          assert.deepEqual(observation.evidence, [expected[`${label} evidence`]]);
        }
      }
    }
    this.#evidence.productDetailsMatched = true;
  }

  async assertEveryProductMutationReasons(rows: readonly PositionedRow[]): Promise<void> {
    assert.deepEqual(
      rows.map(({ position }) => position),
      ["1", "2"],
    );
    for (const card of await this.productCards()) {
      assert.deepEqual(
        (await labelledEvidence(card, "Mutation")).evidence,
        rows.map(({ value }) => value),
      );
    }
    this.#evidence.mutationReasonsMatched = true;
  }

  async assertNoLocalPathDisclosure(): Promise<void> {
    const unixPath = /(?:^|[\s("'=])\/(?:[^/\s]+\/)+[^\s<]*/u;
    const windowsPath = /\b[A-Za-z]:\\(?:[^\\\s]+\\)+[^\s<]*/u;
    for (const card of await this.productCards()) {
      const text = normalizeText(await card.getText());
      assert.doesNotMatch(text, unixPath);
      assert.doesNotMatch(text, windowsPath);
      assert.equal(text.includes("file://"), false);
      for (const term of await card.$$("dt").getElements()) {
        assert.notEqual(
          normalizeText(await term.getText()).replace(/:\s*$/u, ""),
          "Manifest provenance",
        );
      }
    }
    this.#evidence.localPathDisclosureExcluded = true;
  }

  async closeNativeWindow(): Promise<void> {
    const browser = this.browser();
    assert.ok((await bounded(browser.getWindowHandles(), 2_000, "window handle query")).length > 0);
    try {
      await bounded(browser.closeWindow(), 5_000, "native window close");
    } catch (error) {
      assert.equal(
        error instanceof Error ? error.message : String(error),
        "All window handles were removed, causing WebdriverIO to close the session.",
      );
    }
    this.#evidence.windowClosed = true;
  }

  async assertExecutableExited(): Promise<void> {
    assert.equal(this.#evidence.windowClosed, true, "native window has not been closed");
    const processId = this.#applicationProcessId;
    assert.ok(processId, "release/no-bundle executable process was not observed");
    const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
    while (await processExists(processId)) {
      if (Date.now() >= deadline) {
        assert.fail(`release/no-bundle executable ${processId} did not exit after window close`);
      }
      await wait(50);
    }
    this.#evidence.executableExited = true;
  }

  async assertScenarioCleanup(): Promise<void> {
    await this.dispose();
    const leaseEvidence = this.lease().evidence();
    assert.equal(this.#evidence.executableExited, true);
    assert.equal(this.#evidence.ownedProcessesRemaining, 0);
    assert.equal(leaseEvidence.environmentRestored, true);
    assert.equal(leaseEvidence.scenarioChildRemoved, true);
    this.#evidence.environmentRestored = true;
    this.#evidence.scenarioSandboxRemoved = true;
  }

  evidence(): Readonly<MissingSteamEvidence> {
    return {
      ...this.#evidence,
      boundary: { ...this.#evidence.boundary, claimsExcluded: [...CLAIMS_EXCLUDED] },
      emptyLocationsVerified: this.#evidence.emptyLocationsVerified
        ? [...this.#evidence.emptyLocationsVerified]
        : undefined,
    };
  }

  redactedDiagnostics(): string {
    let diagnostic = this.#driverDiagnostic;
    if (this.#lease) diagnostic = diagnostic.replaceAll(this.#lease.paths.root, "<SCENARIO>");
    return diagnostic
      .replaceAll(this.#runnerSandbox, "<RUNNER_SANDBOX>")
      .replaceAll(this.#applicationPath, "<APPLICATION>")
      .replace(/\b(password|token|secret)=\S+/giu, "$1=<REDACTED>")
      .replace(/\/(?:[^\s:'"]+\/?)+/gu, "<PATH>")
      .slice(-DIAGNOSTIC_LIMIT);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    try {
      const browser = this.#browser;
      this.#browser = undefined;
      if (browser && !this.#sessionDeleted) {
        try {
          await bounded(browser.deleteSession(), 2_000, "missing-Steam WebDriver cleanup");
          this.#sessionDeleted = true;
        } catch {
          // Continue with owned process cleanup after the native window has closed.
        }
      }

      const driver = this.#driver;
      const driverExit = this.#driverExit;
      this.#driver = undefined;
      this.#driverExit = undefined;
      if (driver && driverExit) {
        if (driver.exitCode === null && driver.signalCode === null) driver.kill("SIGTERM");
        await Promise.race([driverExit.catch(() => undefined), wait(2_000)]);
        if (driver.exitCode === null && driver.signalCode === null) driver.kill("SIGKILL");
        await Promise.race([driverExit.catch(() => undefined), wait(1_000)]);
      }

      const applicationProcessId = this.#applicationProcessId;
      if (applicationProcessId && (await processExists(applicationProcessId))) {
        try {
          process.kill(applicationProcessId, "SIGTERM");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
        while ((await processExists(applicationProcessId)) && Date.now() < deadline) await wait(50);
        if (await processExists(applicationProcessId)) {
          try {
            process.kill(applicationProcessId, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
      }
      let remaining = 0;
      for (const processId of [driver?.pid, applicationProcessId]) {
        if (processId !== undefined && (await processExists(processId))) remaining += 1;
      }
      this.#evidence.ownedProcessesRemaining = remaining;
      assert.equal(remaining, 0, "owned missing-Steam Settings processes survived cleanup");
    } finally {
      const lease = this.#lease;
      if (lease) {
        await lease.restoreEnvironment();
        this.#evidence.environmentRestored = true;
        await lease.dispose();
        this.#evidence.scenarioSandboxRemoved = lease.evidence().scenarioChildRemoved;
      }
      this.#disposed = true;
      this.#evidence.disposed = true;
    }
  }

  private browser(): Browser {
    if (!this.#browser) throw new Error("missing-Steam Settings WebdriverIO is unavailable");
    return this.#browser;
  }

  private lease(): NativeScenarioEnvironmentLease {
    if (!this.#lease) throw new Error("missing-Steam Settings scenario environment is unavailable");
    return this.#lease;
  }

  private async settingsDialog(): Promise<StoryElement> {
    const dialog = await this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000, interval: 50 });
    return dialog as unknown as StoryElement;
  }

  private async xcom2Tab(): Promise<StoryElement> {
    const navigation = await (await this.settingsDialog()).$('nav[aria-label="Settings sections"]');
    const matches: StoryElement[] = [];
    for (const tab of await navigation.$$('[role="tab"]').getElements()) {
      const spans = await tab.$$("span").getElements();
      if (spans.length > 0 && normalizeText(await spans[0]!.getText()) === "XCOM 2") {
        matches.push(tab);
      }
    }
    assert.equal(matches.length, 1);
    return matches[0]!;
  }

  private async detailsRegion(): Promise<StoryElement> {
    return (await this.settingsDialog()).$(
      '[aria-label="XCOM 2 setup monitor details"]',
    ) as unknown as StoryElement;
  }

  private async namedSection(name: string): Promise<StoryElement> {
    const details = await this.detailsRegion();
    const matches: StoryElement[] = [];
    for (const section of await details.$$("section").getElements()) {
      if ((await exactTextElements(section, "h1,h2,h3,h4,h5,h6", name)).length === 1) {
        matches.push(section);
      }
    }
    assert.equal(matches.length, 1, `Expected exactly one section named ${name}`);
    return matches[0]!;
  }

  private async productsRegion(): Promise<StoryElement> {
    const products = await (
      await this.detailsRegion()
    ).$('[aria-label="Monitored Steam products"]');
    await products.waitForDisplayed({ timeout: 15_000, interval: 50 });
    assert.equal(await products.getComputedLabel(), "Monitored Steam products");
    return products as unknown as StoryElement;
  }

  private async productCards(): Promise<StoryElement[]> {
    const cards = await (await this.productsRegion()).$$("article").getElements();
    assert.equal(cards.length, 3);
    return [...cards];
  }

  private async exactPrefixedText(
    owner: StoryElement,
    selector: string,
    prefix: string,
  ): Promise<string> {
    const matches: string[] = [];
    for (const element of await owner.$$(selector).getElements()) {
      const text = normalizeText(await element.getText());
      if (text.startsWith(`${prefix} `)) matches.push(text.slice(prefix.length + 1));
    }
    assert.equal(matches.length, 1, `Expected exactly one ${prefix} presentation`);
    return matches[0]!;
  }

  private async waitForDriver(port: number): Promise<void> {
    const deadline = Date.now() + DRIVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const exited = this.#driverExit
        ? await Promise.race([
            this.#driverExit.then((result) => result),
            wait(0).then(() => undefined),
          ])
        : undefined;
      if (exited)
        throw new Error(`tauri-driver exited before readiness: ${JSON.stringify(exited)}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/status`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) return;
      } catch {
        // Retry only the external tauri-driver readiness endpoint within the bounded deadline.
      }
      await wait(50);
    }
    throw new Error(`tauri-driver did not become ready within ${DRIVER_START_TIMEOUT_MS}ms`);
  }

  private async waitForApplicationProcess(): Promise<number> {
    const driverProcessId = this.#driver?.pid;
    assert.ok(driverProcessId, "tauri-driver process ID is unavailable");
    const deadline = Date.now() + SESSION_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const processId = await findExecutableDescendant(driverProcessId, this.#applicationPath);
      if (processId !== undefined) return processId;
      await wait(50);
    }
    throw new Error("release/no-bundle executable process was not observed under tauri-driver");
  }
}
