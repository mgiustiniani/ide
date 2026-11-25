import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeJavaDatabaseSession } from "../support/native-java-database.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeJavaDatabaseSession>();

function session(world: StoryWorld): NativeJavaDatabaseSession {
  const value = sessions.get(world);
  if (!value) throw new Error("native Java database scenario was not prepared");
  return value;
}

Given<StoryWorld>(
  "the native Java database tool has an isolated workspace and H2 driver",
  { timeout: 15_000 },
  async function () {
    const value = new NativeJavaDatabaseSession();
    sessions.set(this, value);
    await value.prepare({
      driver: this.targetProfile.driver,
      packagedApplication: this.targetEvidence?.packagedApplication ?? true,
    });
  },
);

When<StoryWorld>(
  "the person connects to the empty H2 database and inspects its schema",
  { timeout: 60_000 },
  async function () {
    const value = session(this);
    try {
      await value.connectAndInspect();
    } catch (error) {
      value.setFailure(error);
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the database connection is explicit and the workspace remains unchanged",
  async function () {
    const proof = session(this).evidence();
    if (!proof.noConnectionBeforeClick || !proof.connectedAfterClick || !proof.emptySchemaShown)
      throw new Error("The native database connection did not follow the explicit-connect flow");
  },
);

When<StoryWorld>(
  "the person creates a table, inserts a row, refreshes the schema, and selects the row",
  { timeout: 60_000 },
  async function () {
    const value = session(this);
    try {
      await value.changeAndQuery();
    } catch (error) {
      value.setFailure(error);
      throw error;
    }
  },
);

Then<StoryWorld>("the IDE shows the updated table and returned row", async function () {
  const proof = session(this).evidence();
  if (!proof.explicitSqlResultsShown || !proof.schemaRefreshed || !proof.selectedRowShown)
    throw new Error("The native database query flow did not show the expected SQL results");
});

When<StoryWorld>(
  "the person runs typed bound SQL queries and recovers from an incorrect parameter count",
  { timeout: 90_000 },
  async function () {
    const value = session(this);
    try {
      await value.runBoundQueries();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "the bound values are returned literally and the database console recovers",
  async function () {
    const proof = session(this).evidence();
    if (
      !proof.boundStringPreserved ||
      !proof.boundIntegerPreserved ||
      !proof.bindingErrorRecovered ||
      !proof.boundValuesNotInterpolated
    )
      throw new Error(
        "The native bound SQL query did not preserve values and recover after refusal",
      );
  },
);

When<StoryWorld>(
  "the person closes the database IDE window",
  { timeout: 20_000 },
  async function () {
    const value = session(this);
    try {
      await value.closeNormally();
    } catch (error) {
      value.setFailure(error);
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the database IDE exits cleanly and the workspace remains unchanged",
  async function () {
    const value = session(this);
    await value.dispose();
    const proof = value.evidence();
    if (!proof.cleanExit || !proof.workspaceUnchanged)
      throw new Error(
        "The native database scenario changed workspace files or did not close cleanly",
      );
  },
);

After<StoryWorld>({ tags: "@REQ-IDE-JAVA-DATABASE-001" }, async function () {
  await sessions.get(this)?.dispose();
});

When<StoryWorld>(
  "the person commits and rolls back on the same connection with protected pending work",
  { timeout: 90_000 },
  async function () {
    const value = session(this);
    try {
      await value.transactAndReconnect();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "committed data survives reconnection and explicitly discarded data is absent",
  async function () {
    const proof = session(this).evidence();
    if (
      !proof.manualTransactionVisible ||
      !proof.pendingCloseRefused ||
      !proof.pendingWorkspaceSwitchRefused ||
      !proof.cleanWorkspaceSwitchAccepted ||
      !proof.sessionSurvivesPanelSwitch ||
      !proof.rollbackConfirmed ||
      !proof.commitConfirmed ||
      !proof.explicitDisconnectRollsBack ||
      !proof.committedDataSurvivesReconnect
    )
      throw new Error(
        "The native transaction workflow did not confirm every operation and pending-work guard",
      );
  },
);

When<StoryWorld>(
  "the person stops a running JDBC query and reconnects explicitly",
  { timeout: 90_000 },
  async function () {
    const value = session(this);
    try {
      await value.stopRunningQuery();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "the query worker exits with an unknown database outcome and the SQL draft remains reviewable",
  async function () {
    const proof = session(this).evidence();
    if (
      !proof.queryEnteredDriver ||
      !proof.stopConfirmed ||
      !proof.stopReportsUnknownOutcome ||
      !proof.stoppedWorkerGone ||
      !proof.queryDraftRetainedAfterStop ||
      !proof.reconnectAfterStop
    )
      throw new Error(
        "The native JDBC stop flow did not confirm worker termination, outcome uncertainty, draft preservation and reconnection",
      );
  },
);

When<StoryWorld>(
  "the person composes and runs a quoted SQL query using schema suggestions",
  { timeout: 60000 },
  async function () {
    const value = session(this);
    try {
      await value.useSchemaSuggestions();
    } catch (error) {
      value.setFailure(error);
      throw error;
    }
  },
);
Then<StoryWorld>(
  "schema insertion preserves explicit execution and the quoted query returns the expected row",
  async function () {
    const proof = session(this).evidence();
    if (
      !proof.schemaColumnInserted ||
      !proof.schemaTableInserted ||
      !proof.schemaShortcutWorked ||
      !proof.schemaInsertionDidNotExecute ||
      !proof.quotedSchemaQueryPassed ||
      !proof.schemaCancelPreservedDraft
    )
      throw new Error("SQL schema insertion has incomplete native evidence");
  },
);

When<StoryWorld>(
  "the person estimates bound SQL plans and refuses execution forms on the same JDBC transaction",
  { timeout: 90000 },
  async function () {
    const value = session(this);
    try {
      await value.estimateQueryPlans();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "estimated plans preserve data and bindings, export the captured plan, and retain transaction control",
  async function () {
    const p = session(this).evidence();
    if (
      !p.estimatedPlanShown ||
      !p.boundPlanPreserved ||
      !p.estimatedPlanExported ||
      !p.multiplePlanStatementsRefused ||
      !p.analyzePlanRefused ||
      !p.planDidNotApplyChanges ||
      !p.planRetainedTransaction ||
      !p.planRefusalRecovered
    )
      throw new Error("Estimated JDBC plan acceptance is incomplete");
  },
);
