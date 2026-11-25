import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pasteNativeText } from "./native-text-input.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export const JAVA_DATABASE_REQUIREMENT = "REQ-IDE-JAVA-DATABASE-001";

async function snapshotWorkspace(root: string): Promise<string> {
  const entries: string[] = [];
  async function visit(directory: string): Promise<void> {
    const children = (await readdir(directory)).sort((left, right) => left.localeCompare(right));
    for (const name of children) {
      const filePath = path.join(directory, name);
      const relativePath = path.relative(root, filePath);
      const metadata = await lstat(filePath);
      if (metadata.isSymbolicLink())
        entries.push(`link:${relativePath}:${await readlink(filePath)}`);
      else if (metadata.isDirectory()) {
        entries.push(`directory:${relativePath}`);
        await visit(filePath);
      } else if (metadata.isFile()) {
        entries.push(
          `file:${relativePath}:${createHash("sha256")
            .update(await readFile(filePath))
            .digest("hex")}`,
        );
      } else entries.push(`other:${relativePath}:${metadata.mode}`);
    }
  }
  await visit(root);
  return JSON.stringify(entries);
}

export class NativeJavaDatabaseSession {
  #lease?: NativeScenarioEnvironmentLease;
  #application?: NativeDesktopApplication;
  #databasePath?: string;
  #workspaceSnapshot?: string;
  #failure?: unknown;
  #schemaSuggestionsCase = false;
  #planCase = false;
  #primaryId = "";
  #secondaryId = "";
  #secondaryPath = "";
  readonly #proof = {
    nativeGui: true,
    estimatedPlanShown: false,
    boundPlanPreserved: false,
    estimatedPlanExported: false,
    multiplePlanStatementsRefused: false,
    analyzePlanRefused: false,
    planDidNotApplyChanges: false,
    planRetainedTransaction: false,
    planRefusalRecovered: false,
    schemaColumnInserted: false,
    schemaTableInserted: false,
    schemaShortcutWorked: false,
    schemaInsertionDidNotExecute: false,
    quotedSchemaQueryPassed: false,
    schemaCancelPreservedDraft: false,
    noConnectionBeforeClick: false,
    connectedAfterClick: false,
    emptySchemaShown: false,
    explicitSqlResultsShown: false,
    schemaRefreshed: false,
    selectedRowShown: false,
    boundStringPreserved: false,
    boundIntegerPreserved: false,
    bindingErrorRecovered: false,
    boundValuesNotInterpolated: false,
    manualTransactionVisible: false,
    pendingCloseRefused: false,
    pendingWorkspaceSwitchRefused: false,
    cleanWorkspaceSwitchAccepted: false,
    queryEnteredDriver: false,
    stopConfirmed: false,
    stopReportsUnknownOutcome: false,
    stoppedWorkerGone: false,
    queryDraftRetainedAfterStop: false,
    reconnectAfterStop: false,
    sessionSurvivesPanelSwitch: false,
    rollbackConfirmed: false,
    commitConfirmed: false,
    explicitDisconnectRollsBack: false,
    committedDataSurvivesReconnect: false,
    capturedResultCsvExported: false,
    capturedResultJsonExported: false,
    resultExportCancelled: false,
    resultExportOverwriteRefused: false,
    resultExportDidNotExecuteSql: false,
    cleanExit: false,
    workspaceUnchanged: false,
    workspace: "",
  };

  evidence() {
    return { ...this.#proof };
  }

  setFailure(error: unknown): void {
    this.#failure = error;
  }

  async prepare(profile: { driver: string; packagedApplication: boolean }): Promise<void> {
    assert.equal(profile.driver, "tauri-webdriver");
    assert.equal(profile.packagedApplication, false);
    const sourceDriver = process.env.IDE_STORY_JAVA_DATABASE_DRIVER_PATH;
    assert.ok(
      sourceDriver && path.isAbsolute(sourceDriver),
      "set IDE_STORY_JAVA_DATABASE_DRIVER_PATH to an absolute H2 driver JAR",
    );
    assert.equal(path.extname(sourceDriver).toLowerCase(), ".jar");
    const sourceMetadata = await stat(sourceDriver);
    assert.ok(
      sourceMetadata.isFile() &&
        sourceMetadata.size > 0 &&
        sourceMetadata.size <= 128 * 1024 * 1024,
    );

    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_DATABASE_REQUIREMENT);
    this.#proof.workspace = this.#lease.paths.workspace;
    const driverDirectory = path.join(this.#lease.paths.workspace, "drivers");
    await mkdir(driverDirectory, { recursive: true });
    await copyFile(await realpath(sourceDriver), path.join(driverDirectory, "h2.jar"));
    this.#databasePath = path.join(this.#lease.paths.root, "h2-database");
    this.#secondaryPath = path.join(this.#lease.paths.root, "database-secondary");
    const timestamp = "2026-01-01T00:00:00Z";
    const workspaces = [];
    for (const [index, root] of [this.#lease.paths.workspace, this.#secondaryPath].entries()) {
      await mkdir(path.join(root, ".ide"), { recursive: true });
      const canonical = await realpath(root);
      const id = `ws-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
      if (index === 0) this.#primaryId = id;
      else this.#secondaryId = id;
      const name = path.basename(root);
      await writeFile(
        path.join(root, ".ide/workspace.json"),
        JSON.stringify({ id, name, path: canonical, createdAt: timestamp, updatedAt: timestamp }),
        { flag: "wx" },
      );
      workspaces.push({
        id,
        name,
        rootPath: canonical,
        markerFolder: ".ide",
        createdAt: timestamp,
        lastOpenedAt: timestamp,
      });
    }
    await writeFile(
      path.join(this.#lease.paths.ideHome, "workspaces.json"),
      JSON.stringify({ version: 1, workspaces, currentWorkspaceId: this.#primaryId }),
      { flag: "wx" },
    );
    await writeFile(
      path.join(this.#secondaryPath, "sentinel.txt"),
      "Untouched database destination",
      { flag: "wx" },
    );
    await this.#lease.assertConfiguredPathsConfined();
  }

  async connectAndInspect(): Promise<void> {
    assert.ok(this.#lease && this.#databasePath);
    this.#application = new NativeDesktopApplication();
    await this.#application.launch();
    await this.#application.waitForFileExplorer();
    this.#workspaceSnapshot = await snapshotWorkspace(this.#lease.paths.workspace);
    const browser = this.#application.browser();
    await browser.$("button=Database").waitForEnabled({ timeout: 5_000 });
    await browser.$("button=Database").click();
    await browser.$('[aria-label="Java database"]').waitForDisplayed({ timeout: 5_000 });
    assert.equal(await browser.$('[aria-label="Database schema"]').isExisting(), false);
    assert.equal(await browser.$('[aria-label="SQL results"]').isExisting(), false);
    await assert.rejects(stat(this.#databasePath + ".mv.db"));
    this.#proof.noConnectionBeforeClick = true;

    await browser.$('[aria-label="JDBC driver JAR"]').setValue("drivers/h2.jar");
    await browser.$('[aria-label="JDBC URL"]').setValue(`jdbc:h2:file:${this.#databasePath}`);
    await browser.$('[aria-label="Database username"]').setValue("sa");
    await browser.$('[aria-label="Trust JDBC driver and database operations"]').click();
    await browser.$("button=Connect and inspect schema").click();
    await browser.$("h3*=H2 2.4.240").waitForDisplayed({ timeout: 15_000 });
    assert.equal(await browser.$('[aria-label="SQL results"]').isExisting(), false);
    assert.ok((await stat(this.#databasePath + ".mv.db")).isFile());
    this.#proof.connectedAfterClick = true;
    this.#proof.emptySchemaShown = (
      await browser.$('[aria-label="Database schema"]').getText()
    ).includes("No user tables or views were found.");
    assert.equal(this.#proof.emptySchemaShown, true);
  }

  async changeAndQuery(): Promise<void> {
    const browser = this.#application?.browser();
    assert.ok(browser);
    const createResult = await this.runSql(browser, "CREATE TABLE greeting (name VARCHAR(40))");
    assert.match(createResult, /Rows affected: 0\./u);
    await browser.$("button=Refresh schema").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Database schema"]').getText()).includes("GREETING"),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: `refreshed schema did not include GREETING; schema: ${await browser.$('[aria-label="Database schema"]').getText()}${(await browser.$('[aria-label="Database error"]').isExisting()) ? `; error: ${await browser.$('[aria-label="Database error"]').getText()}` : ""}`,
      },
    );
    this.#proof.schemaRefreshed = true;

    await this.runSql(browser, "INSERT INTO greeting VALUES ('Ada')");
    assert.match(await browser.$('[aria-label="SQL result"]').getText(), /Rows affected: 1\./u);
    await this.runSql(browser, "SELECT name FROM greeting");
    await browser.$("td=Ada").waitForDisplayed({ timeout: 10_000 });
    this.#proof.selectedRowShown = true;
    this.#proof.explicitSqlResultsShown = true;
    await this.exportCapturedResult();
  }

  private async exportCapturedResult(): Promise<void> {
    const browser = this.#application!.browser();
    const literal = 'é,"Ada"=1+1';
    await this.runSql(
      browser,
      `SELECT '${literal}' AS "same", '9007199254740993' AS "same", CAST(NULL AS VARCHAR) AS "nil", '' AS "empty"`,
    );
    const resultId = await browser.$('[aria-label="SQL result"]').getAttribute("data-request-id");
    const capturedSql = await browser.$('[aria-label="SQL statement"]').getValue();
    const directory = path.join(this.#lease!.paths.root, "result-exports");
    await mkdir(directory);
    const button = () => browser.$("button=Export captured result as…");
    const status = () => browser.$('[aria-label="SQL result export status"]');
    await button().click();
    await this.#application!.chooseSqlResultExport(null);
    await browser.waitUntil(async () => (await status().getText()).includes("cancelled"), {
      timeout: 5000,
    });
    assert.deepEqual(await readdir(directory), []);
    this.#proof.resultExportCancelled = true;
    const csv = path.join(directory, "résultat.csv");
    await button().click();
    await this.#application!.chooseSqlResultExport(csv);
    await browser.waitUntil(
      async () => (await status().getText()).includes("Exported 1 captured rows"),
      { timeout: 5000 },
    );
    assert.equal(
      await readFile(csv, "utf8"),
      `"'same","'same","'nil","'empty"\r\n"'é,""Ada""=1+1","'9007199254740993",,"'"\r\n`,
    );
    assert.equal((await stat(csv)).mode & 0o777, 0o600);
    this.#proof.capturedResultCsvExported = true;
    await button().click();
    await this.#application!.chooseSqlResultExport(csv, true);
    await browser.waitUntil(async () => (await status().getText()).includes("failed"), {
      timeout: 5000,
    });
    assert.equal(
      await readFile(csv, "utf8"),
      `"'same","'same","'nil","'empty"\r\n"'é,""Ada""=1+1","'9007199254740993",,"'"\r\n`,
    );
    this.#proof.resultExportOverwriteRefused = true;
    await browser.$('[aria-label="Result export format"]').selectByAttribute("value", "json");
    const jsonPath = path.join(directory, "résultat.json");
    await button().click();
    await this.#application!.chooseSqlResultExport(jsonPath);
    await browser.waitUntil(
      async () => (await status().getText()).includes("Exported 1 captured rows"),
      { timeout: 5000 },
    );
    const json = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.deepEqual(json.rows, [[literal, "9007199254740993", null, ""]]);
    assert.deepEqual(
      json.columns.map((c: { name: string }) => c.name),
      ["same", "same", "nil", "empty"],
    );
    assert.equal(json.rowsTruncated, false);
    assert.equal(json.rowCount, 1);
    assert.equal(json.kind, "jdbc-result");
    assert.equal(json.version, 1);
    assert.deepEqual(Object.keys(json).sort(), [
      "columns",
      "kind",
      "rowCount",
      "rows",
      "rowsTruncated",
      "updateCount",
      "version",
    ]);
    assert.deepEqual((await readdir(directory)).sort(), ["résultat.csv", "résultat.json"]);
    this.#proof.capturedResultJsonExported = true;
    assert.equal(
      await browser.$('[aria-label="SQL result"]').getAttribute("data-request-id"),
      resultId,
    );
    assert.equal(await browser.$('[aria-label="SQL statement"]').getValue(), capturedSql);
    this.#proof.resultExportDidNotExecuteSql = true;
  }

  async useSchemaSuggestions(): Promise<void> {
    this.#schemaSuggestionsCase = true;
    const browser = this.#application!.browser();
    await this.runSql(browser, 'CREATE TABLE "Order ""Items""" ("select" VARCHAR(40))');
    await this.runSql(browser, 'INSERT INTO "Order ""Items""" VALUES (\'Quoted Ada\')');
    await browser.$("button=Refresh schema").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Database schema"]').getText()).includes('Order "Items"'),
      { timeout: 10000 },
    );
    const priorResult = async () =>
      (await browser.$('[aria-label="SQL result"]').isExisting())
        ? await browser.$('[aria-label="SQL result"]').getAttribute("data-request-id")
        : "absent";
    const before = await priorResult();
    const statement = browser.$('textarea[aria-label="SQL statement"]');
    await statement.setValue("SELECT ");
    await browser.$("button=Schema suggestions").click();
    const dialog = () => browser.$('[role="dialog"][aria-label="SQL schema suggestions"]');
    await dialog().waitForDisplayed({ timeout: 5000 });
    await dialog().$('input[aria-label="Search database schema"]').setValue('Order "Items".select');
    await browser.keys("Enter");
    await dialog().waitForExist({ reverse: true, timeout: 5000 });
    assert.equal(await statement.getValue(), 'SELECT "select"');
    this.#proof.schemaColumnInserted = true;
    await statement.addValue(" FROM ");
    await browser.keys(["Control", " "]);
    await dialog().waitForDisplayed({ timeout: 5000 });
    this.#proof.schemaShortcutWorked = true;
    await dialog().$('input[aria-label="Search database schema"]').setValue('Order "Items" table');
    await browser.keys("Enter");
    await dialog().waitForExist({ reverse: true, timeout: 5000 });
    const expected = 'SELECT "select" FROM "PUBLIC"."Order ""Items"""';
    assert.equal(await statement.getValue(), expected);
    this.#proof.schemaTableInserted = true;
    assert.equal(await priorResult(), before);
    this.#proof.schemaInsertionDidNotExecute = true;
    await browser.$("button=Run SQL").click();
    await browser.$("td=Quoted Ada").waitForDisplayed({ timeout: 10000 });
    this.#proof.quotedSchemaQueryPassed = true;
    const selected = await priorResult();
    await browser.$("button=Schema suggestions").click();
    await dialog().waitForDisplayed({ timeout: 5000 });
    await browser.keys("Escape");
    await dialog().waitForExist({ reverse: true, timeout: 5000 });
    assert.equal(await statement.getValue(), expected);
    assert.equal(await priorResult(), selected);
    this.#proof.schemaCancelPreservedDraft = true;
  }

  private async runSql(
    browser: ReturnType<NativeDesktopApplication["browser"]>,
    sql: string,
  ): Promise<string> {
    const statement = browser.$('[aria-label="SQL statement"]');
    if ([...sql].some((character) => character.codePointAt(0)! > 127)) {
      await pasteNativeText(this.#application!, statement, sql);
    } else {
      await statement.setValue(sql);
    }
    assert.equal(await statement.getValue(), sql, "native SQL input must match before execution");
    const priorId = (await browser.$('[aria-label="SQL result"]').isExisting())
      ? await browser.$('[aria-label="SQL result"]').getAttribute("data-request-id")
      : "";
    await browser.$("button=Run SQL").click();
    await browser.waitUntil(
      async () => {
        const result = browser.$('[aria-label="SQL result"]');
        return (
          (await result.isExisting()) && (await result.getAttribute("data-request-id")) !== priorId
        );
      },
      { timeout: 15_000, interval: 100, timeoutMsg: `SQL result was not shown for ${sql}` },
    );
    this.#proof.explicitSqlResultsShown = true;
    return browser.$('[aria-label="SQL result"]').getText();
  }

  async runBoundQueries(): Promise<void> {
    const browser = this.#application?.browser();
    assert.ok(browser);
    const literal = "Ada'); DROP TABLE greeting; --";
    await browser.$('[aria-label="Use bound SQL parameters"]').click();
    await browser.$("button=Add SQL parameter").click();
    await browser.$('[aria-label="SQL parameter 1 value"]').waitForDisplayed({ timeout: 5_000 });
    await browser.$('[aria-label="SQL parameter 1 value"]').setValue(literal);
    assert.match(
      await this.runSql(browser, "INSERT INTO greeting VALUES (?)"),
      /Rows affected: 1/u,
    );
    await this.runSql(browser, "SELECT name FROM greeting WHERE name = ?");
    await browser.$(`td=${literal}`).waitForDisplayed({ timeout: 5_000 });
    this.#proof.boundStringPreserved = true;
    await browser.$("button=Add SQL parameter").click();
    await browser.$('[aria-label="SQL parameter 2 type"]').waitForDisplayed({ timeout: 5_000 });
    await browser.$('[aria-label="SQL parameter 2 type"]').selectByAttribute("value", "integer");
    await browser.$('[aria-label="SQL parameter 2 value"]').setValue("9223372036854775807");
    const query = "SELECT CAST(? AS VARCHAR) AS name, CAST(? AS BIGINT) AS exact_id";
    await this.runSql(browser, query);
    await browser.$("td=9223372036854775807").waitForDisplayed({ timeout: 5_000 });
    await browser.$(`td=${literal}`).waitForDisplayed({ timeout: 5_000 });
    assert.equal(await browser.$('[aria-label="SQL statement"]').getValue(), query);
    assert.equal(await browser.$('[aria-label="SQL parameter 1 value"]').getValue(), literal);
    this.#proof.boundIntegerPreserved = true;
    this.#proof.boundValuesNotInterpolated = true;
    await browser.$('[aria-label="SQL statement"]').setValue("SELECT name FROM greeting");
    await browser.$("button=Run SQL").click();
    await browser.$('[aria-label="Database error"]').waitForDisplayed({ timeout: 10_000 });
    const error = await browser.$('[aria-label="Database error"]').getText();
    assert.ok(error.includes("expects 0 parameters"), error);
    assert.equal(await browser.$('[aria-label="SQL result"]').isExisting(), false);
    assert.equal(await browser.$('[aria-label="SQL parameter 1 value"]').getValue(), literal);
    await browser.$('[aria-label="Remove SQL parameter 2"]').click();
    await this.runSql(browser, "SELECT name FROM greeting WHERE name = ?");
    await browser.$(`td=${literal}`).waitForDisplayed({ timeout: 5_000 });
    assert.equal(await browser.$('[aria-label="Database error"]').isExisting(), false);
    this.#proof.bindingErrorRecovered = true;
    await browser.$('[aria-label="Use bound SQL parameters"]').click();
    await this.runSql(browser, "SELECT COUNT(*) FROM greeting");
    await browser.$("td=2").waitForDisplayed({ timeout: 5_000 });
  }
  async transactAndReconnect(): Promise<void> {
    const browser = this.#application?.browser();
    assert.ok(browser && this.#application && this.#databasePath);
    await this.runSql(browser, "CREATE TABLE notes (name VARCHAR(40))");
    await browser.$("button=Begin transaction").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Database transaction"]').getText()).includes(
          "Auto-commit off",
        ),
      { timeout: 5_000 },
    );
    this.#proof.manualTransactionVisible = true;
    await this.runSql(browser, "INSERT INTO notes VALUES ('pending')");
    await this.runSql(browser, "SELECT name FROM notes");
    await browser.$("td=pending").waitForDisplayed({ timeout: 5_000 });
    assert.equal(await browser.$("button=Enable auto-commit").isEnabled(), false);
    await browser.$("button=Terminal").click();
    await browser.$("button=Database").click();
    await browser.$("td=pending").waitForDisplayed({ timeout: 5_000 });
    assert.equal(
      await browser.$('[aria-label="SQL statement"]').getValue(),
      "SELECT name FROM notes",
    );
    this.#proof.sessionSurvivesPanelSwitch = true;
    await this.#application.requestNativeWindowClose();
    await browser.waitUntil(
      async () =>
        (await browser.$("body").getText()).includes(
          "Commit, roll back, or explicitly disconnect the database before closing the IDE",
        ),
      { timeout: 5_000 },
    );
    await this.#application.assertRunning();
    await browser.$("td=pending").waitForDisplayed({ timeout: 5_000 });
    this.#proof.pendingCloseRefused = true;
    const secondary = browser.$('button[role="option"][title^="database-secondary"]');
    await secondary.click();
    await browser.waitUntil(
      async () =>
        (await browser.$("body").getText()).includes(
          "Commit, roll back, or explicitly disconnect the database",
        ),
      { timeout: 5_000 },
    );
    assert.equal(
      JSON.parse(await readFile(path.join(this.#lease!.paths.ideHome, "workspaces.json"), "utf8"))
        .currentWorkspaceId,
      this.#primaryId,
    );
    assert.equal(await secondary.getAttribute("aria-selected"), "false");
    await browser.$("td=pending").waitForDisplayed({ timeout: 5_000 });
    this.#proof.pendingWorkspaceSwitchRefused = true;
    await this.runSql(browser, "SELECT name FROM notes");
    await browser.$("td=pending").waitForDisplayed({ timeout: 5_000 });
    await browser.$("button=Rollback").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Database transaction outcome"]').getText()).includes(
          "Rollback confirmed",
        ),
      { timeout: 5_000 },
    );
    this.#proof.rollbackConfirmed = true;
    await this.runSql(browser, "SELECT COUNT(*) FROM notes");
    await browser.$("td=0").waitForDisplayed({ timeout: 5_000 });
    await this.runSql(browser, "INSERT INTO notes VALUES ('committed')");
    await browser.$("button=Commit").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Database transaction outcome"]').getText()).includes(
          "Commit confirmed",
        ),
      { timeout: 5_000 },
    );
    this.#proof.commitConfirmed = true;
    await this.runSql(browser, "INSERT INTO notes VALUES ('discarded')");
    await browser.$("button=Rollback and disconnect").click();
    await browser.$("button=Connect and inspect schema").waitForDisplayed({ timeout: 5_000 });
    assert.equal(await browser.$('[aria-label="Database error"]').isExisting(), false);
    this.#proof.explicitDisconnectRollsBack = true;
    await browser.$('[aria-label="JDBC driver JAR"]').setValue("drivers/h2.jar");
    await browser.$('[aria-label="JDBC URL"]').setValue(`jdbc:h2:file:${this.#databasePath}`);
    await browser.$('[aria-label="Database username"]').setValue("sa");
    await browser.$('[aria-label="Trust JDBC driver and database operations"]').click();
    await browser.$("button=Connect and inspect schema").click();
    await browser.$("h3*=H2 2.4.240").waitForDisplayed({ timeout: 15_000 });
    await this.runSql(browser, "SELECT name FROM notes");
    const rows = await browser.$$('[aria-label="SQL results"] tbody tr');
    assert.equal(rows.length, 1);
    assert.equal(await rows[0].getText(), "committed");
    this.#proof.committedDataSurvivesReconnect = true;
    await secondary.click();
    await browser.waitUntil(
      async () => (await secondary.getAttribute("aria-selected")) === "true",
      { timeout: 15_000 },
    );
    assert.equal(
      JSON.parse(await readFile(path.join(this.#lease!.paths.ideHome, "workspaces.json"), "utf8"))
        .currentWorkspaceId,
      this.#secondaryId,
    );
    await browser
      .$('[role="treeitem"][data-path="sentinel.txt"]')
      .waitForDisplayed({ timeout: 10_000 });
    await browser.$("button=Database").click();
    assert.equal(await browser.$('[aria-label="Database schema"]').isExisting(), false);
    assert.equal(await browser.$('[aria-label="Database password"]').getValue(), "");
    assert.equal(
      await readFile(path.join(this.#secondaryPath, "sentinel.txt"), "utf8"),
      "Untouched database destination",
    );
    this.#proof.cleanWorkspaceSwitchAccepted = true;
  }

  async stopRunningQuery(): Promise<void> {
    const browser = this.#application?.browser();
    assert.ok(browser && this.#application && this.#lease && this.#databasePath);
    await this.runSql(
      browser,
      "CREATE ALIAS IDE_PAUSE AS $$ void pause(String file) throws Exception { java.nio.file.Files.writeString(java.nio.file.Path.of(file), Long.toString(ProcessHandle.current().pid())); Thread.sleep(60000); } $$",
    );
    const marker = path.join(this.#lease.paths.root, "query-running");
    await browser.$('[aria-label="Use bound SQL parameters"]').click();
    await browser.$("button=Add SQL parameter").click();
    await browser.$('[aria-label="SQL parameter 1 value"]').setValue(marker);
    const statement = "CALL IDE_PAUSE(?)";
    await browser.$('[aria-label="SQL statement"]').setValue(statement);
    await browser.$("button=Run SQL").click();
    await browser.waitUntil(
      async () => {
        try {
          return Number(await readFile(marker, "utf8")) > 0;
        } catch {
          return false;
        }
      },
      { timeout: 10_000 },
    );
    const workerPid = Number(await readFile(marker, "utf8"));
    assert.ok(Number.isSafeInteger(workerPid) && workerPid > 0);
    const workerCommand = (await readFile(`/proc/${workerPid}/cmdline`, "utf8")).split("\0");
    assert.ok(workerCommand.includes("IdeDatabaseBridge") && workerCommand.includes("session"));
    this.#proof.queryEnteredDriver = true;
    await browser.$("button=Stop and disconnect").waitForEnabled({ timeout: 5_000 });
    await browser.$("button=Stop and disconnect").click();
    await browser.$("button=Connect and inspect schema").waitForDisplayed({ timeout: 5_000 });
    const error = await browser.$('[aria-label="Database error"]').getText();
    assert.ok(error.includes("JDBC worker has stopped"), error);
    assert.ok(error.includes("database outcome is not confirmed"), error);
    this.#proof.stopConfirmed = true;
    this.#proof.stopReportsUnknownOutcome = true;
    await assert.rejects(stat(`/proc/${workerPid}`));
    this.#proof.stoppedWorkerGone = true;
    assert.equal(await browser.$('[aria-label="SQL statement"]').getValue(), statement);
    assert.equal(await browser.$('[aria-label="SQL parameter 1 value"]').getValue(), marker);
    assert.equal(await browser.$('[aria-label="Database password"]').getValue(), "");
    this.#proof.queryDraftRetainedAfterStop = true;
    await browser.$('[aria-label="JDBC driver JAR"]').setValue("drivers/h2.jar");
    await browser.$('[aria-label="JDBC URL"]').setValue(`jdbc:h2:file:${this.#databasePath}`);
    await browser.$('[aria-label="Database username"]').setValue("sa");
    await browser.$('[aria-label="Trust JDBC driver and database operations"]').click();
    await browser.$("button=Connect and inspect schema").click();
    await browser.$("h3*=H2 2.4.240").waitForDisplayed({ timeout: 15_000 });
    await browser.$('[aria-label="Use bound SQL parameters"]').click();
    await this.runSql(browser, "SELECT 1");
    await browser.$("td=1").waitForDisplayed({ timeout: 5_000 });
    this.#proof.reconnectAfterStop = true;
  }

  async estimateQueryPlans(): Promise<void> {
    this.#planCase = true;
    const browser = this.#application?.browser();
    assert.ok(browser && this.#application && this.#lease);
    await this.runSql(
      browser,
      "CREATE TABLE plan_notes(id INTEGER PRIMARY KEY, name VARCHAR(100))",
    );
    await this.runSql(browser, "INSERT INTO plan_notes VALUES(1, 'original')");
    await browser.$("button=Begin transaction").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Database transaction"]').getText()).includes(
          "Auto-commit off",
        ),
      { timeout: 5000 },
    );
    await this.runSql(browser, "INSERT INTO plan_notes VALUES(2, 'pending')");
    const statement = browser.$('[aria-label="SQL statement"]');
    const estimate = async (sql: string) => {
      const previous = (await browser.$('[aria-label="SQL result"]').isExisting())
        ? await browser.$('[aria-label="SQL result"]').getAttribute("data-request-id")
        : null;
      await statement.setValue(sql);
      await browser.$("button=Estimate plan").waitForEnabled({ timeout: 5000 });
      await browser.$("button=Estimate plan").click();
      await browser.waitUntil(
        async () => {
          const error = browser.$('[aria-label="Database error"]');
          if (await error.isExisting()) throw new Error(await error.getText());
          const plan = browser.$('[aria-label="Estimated SQL plan"]');
          return (
            (await plan.isExisting()) &&
            (await browser.$('[aria-label="SQL result"]').getAttribute("data-request-id")) !==
              previous
          );
        },
        { timeout: 15000, timeoutMsg: "The real JDBC estimated plan was not displayed" },
      );
      assert.equal(await statement.getValue(), sql);
      return browser.$('[aria-label="Estimated SQL plan"]').getText();
    };
    assert.match(await estimate("SELECT name FROM plan_notes WHERE id=1"), /PRIMARY_KEY/);
    this.#proof.estimatedPlanShown = true;
    await browser.$('[aria-label="Use bound SQL parameters"]').click();
    await browser.$("button=Add SQL parameter").click();
    await browser.$('[aria-label="SQL parameter 1 type"]').selectByAttribute("value", "integer");
    await browser.$('[aria-label="SQL parameter 1 value"]').setValue("2");
    assert.match(await estimate("SELECT name FROM plan_notes WHERE id=?"), /PRIMARY_KEY/);
    assert.equal(await browser.$('[aria-label="SQL parameter 1 value"]').getValue(), "2");
    this.#proof.boundPlanPreserved = true;
    assert.match(await estimate("DELETE FROM plan_notes WHERE id=?"), /DELETE/);
    const destination = path.join(this.#lease.paths.root, "estimated-plan.json");
    await browser.$('[aria-label="Result export format"]').selectByAttribute("value", "json");
    await browser.$("button=Export captured result as…").click();
    await this.#application.chooseSqlResultExport(destination);
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="SQL result export status"]').getText()).includes(
          "Exported 1 captured rows",
        ),
      { timeout: 5000 },
    );
    const exported = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(exported.columns[0].name, "PLAN");
    assert.match(exported.rows[0][0], /DELETE/);
    this.#proof.estimatedPlanExported = true;
    await browser.$('[aria-label="Use bound SQL parameters"]').click();
    for (const [sql, expected] of [
      ["SELECT 1; DELETE FROM plan_notes", "one SQL statement"],
      ["ANALYZE DELETE FROM plan_notes", "do not include EXPLAIN or ANALYZE"],
    ]) {
      await statement.setValue(sql);
      await browser.$("button=Estimate plan").click();
      await browser.waitUntil(
        async () =>
          (await browser.$('[aria-label="Database error"]').isExisting()) &&
          (await browser.$('[aria-label="Database error"]').getText()).includes(expected),
        { timeout: 10000 },
      );
      assert.equal(await browser.$('[aria-label="Estimated SQL plan"]').isExisting(), false);
      assert.equal(await statement.getValue(), sql);
    }
    this.#proof.multiplePlanStatementsRefused = true;
    this.#proof.analyzePlanRefused = true;
    await this.runSql(browser, "SELECT id, name FROM plan_notes ORDER BY id");
    await browser.$("td=original").waitForDisplayed({ timeout: 5000 });
    await browser.$("td=pending").waitForDisplayed({ timeout: 5000 });
    assert.equal((await browser.$('[aria-label="SQL results"]').$$("tbody tr")).length, 2);
    this.#proof.planDidNotApplyChanges = true;
    assert.match(
      await browser.$('[aria-label="Database transaction"]').getText(),
      /Auto-commit off/,
    );
    this.#proof.planRetainedTransaction = true;
    await browser.$("button=Rollback").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Database transaction outcome"]').getText()).includes(
          "Rollback confirmed",
        ),
      { timeout: 5000 },
    );
    await this.runSql(browser, "SELECT id, name FROM plan_notes ORDER BY id");
    await browser.$("td=original").waitForDisplayed({ timeout: 5000 });
    assert.equal((await browser.$('[aria-label="SQL results"]').$$("tbody tr")).length, 1);
    this.#proof.planRefusalRecovered = true;
    await browser.$("button=Rollback and disconnect").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Java database"]').getText()).includes(
          "Database disconnected.",
        ),
      { timeout: 5000 },
    );
  }

  async captureFailure(): Promise<void> {
    if (!this.#lease || !this.#application) return;
    try {
      await this.#application
        .browser()
        .saveScreenshot(path.join(this.#lease.runnerArtifactPath, "jdbc-parameters-failure.png"));
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "jdbc-parameters-failure.html"),
        await this.#application.browser().$('[aria-label="Java database"]').getHTML(),
      );
    } catch {
      /* Keep the original assertion when the window already exited. */
    }
  }

  async closeNormally(): Promise<void> {
    assert.ok(this.#application && this.#lease && this.#workspaceSnapshot !== undefined);
    await this.#application.closeWindow();
    this.#proof.cleanExit = true;
    assert.equal(await snapshotWorkspace(this.#lease.paths.workspace), this.#workspaceSnapshot);
    this.#proof.workspaceUnchanged = true;
  }

  async dispose(): Promise<void> {
    let cleanupError: unknown;
    try {
      if (this.#application && !this.#proof.cleanExit) {
        const browser = this.#application.browser();
        const disconnect = browser.$("button=Rollback and disconnect");
        if ((await disconnect.isExisting()) && (await disconnect.isEnabled())) {
          await disconnect.click();
          await browser.$("button=Connect and inspect schema").waitForDisplayed({ timeout: 5_000 });
        }
        await this.#application.closeWindow();
      }
    } catch (error) {
      cleanupError = error;
    }
    try {
      await this.#application?.dispose();
    } catch (error) {
      cleanupError ??= error;
    }
    const evidencePath = this.#lease?.runnerArtifactPath;
    try {
      await this.#lease?.dispose();
      if (evidencePath) {
        await writeFile(
          path.join(
            evidencePath,
            this.#planCase
              ? "java-database-plans-native-evidence.json"
              : this.#schemaSuggestionsCase
                ? "java-database-schema-suggestions-native-evidence.json"
                : this.#proof.queryEnteredDriver
                  ? "java-database-stop-native-evidence.json"
                  : this.#proof.manualTransactionVisible
                    ? "java-database-transactions-native-evidence.json"
                    : this.#proof.boundStringPreserved
                      ? "java-database-parameters-native-evidence.json"
                      : "java-database-native-evidence.json",
          ),
          `${JSON.stringify({ ...this.#proof, failure: this.#failure ? String(this.#failure) : null }, null, 2)}\n`,
          "utf8",
        );
      }
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  }
}
