import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeHttpClientSession, HTTP_CLIENT_REQUIREMENT } from "../support/native-http-client.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeHttpClientSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native HTTP client scenario was not prepared");
  return value;
}

Given<StoryWorld>(
  "the native HTTP client has an isolated workspace and local API service",
  { timeout: 15_000 },
  async function () {
    const value = new NativeHttpClientSession();
    sessions.set(this, value);
    await value.prepare({
      driver: this.targetProfile.driver,
      packagedApplication: this.targetEvidence?.packagedApplication ?? true,
    });
  },
);

When<StoryWorld>(
  "the person sends a JSON request to the local API service",
  { timeout: 45_000 },
  async function () {
    const value = session(this);
    try {
      await value.sendRequest();
    } catch (error) {
      value.setFailure(error);
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person sends Basic and Bearer requests and reloads a saved request without credentials",
  { timeout: 45000 },
  async function () {
    const value = session(this);
    try {
      await value.sendAuthenticatedRequests();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person loads an OpenAPI route and sends the selected request",
  { timeout: 45_000 },
  async function () {
    const value = session(this);
    try {
      await value.sendOpenApiRequest();
    } catch (error) {
      value.setFailure(error);
      throw error;
    }
  },
);

When<StoryWorld>(
  "the person saves a request and environment, restarts the IDE and sends the restored template",
  { timeout: 90_000 },
  async function () {
    const value = session(this);
    try {
      await value.saveReopenAndSendRequest();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>("the IDE shows the service response", async function () {
  const evidence = session(this).evidence();
  if (
    !evidence.requestSentOnlyAfterClick ||
    !evidence.requestReachedLocalService ||
    !evidence.responsePresented ||
    (evidence.localFileImported &&
      (!evidence.openApiParametersPrepared ||
        !evidence.openApiParameterRefusalVerified ||
        !evidence.openApiParameterEditRequiredPreparation ||
        !evidence.openApiParametersReceived))
  )
    throw new Error("The HTTP client did not complete the expected local request flow");
});

When<StoryWorld>(
  "the person closes the HTTP client IDE window",
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
  "the HTTP client and local service exit cleanly and the workspace remains unchanged",
  async function () {
    const value = session(this);
    await value.dispose();
    const evidence = value.evidence();
    if (!evidence.cleanExit || !evidence.serviceClosed || !evidence.workspaceUnchanged)
      throw new Error("The native HTTP client fixture did not finish without workspace changes");
  },
);

Then<StoryWorld>(
  "the HTTP client and local service exit cleanly with only the explicitly exported collection file changed",
  async function () {
    const value = session(this);
    await value.dispose();
    const evidence = value.evidence();
    if (
      !evidence.cleanExit ||
      !evidence.serviceClosed ||
      !evidence.collectionFileExported ||
      !evidence.existingExportFileRefused ||
      !evidence.externalCollectionFileExported ||
      !evidence.externalCollectionFileRefused ||
      !evidence.externalCollectionCancelVerified ||
      !evidence.workspacePreservedApartFromExport ||
      evidence.workspaceUnchanged
    )
      throw new Error(
        "The native HTTP fixture did not preserve the workspace apart from its explicitly exported collection",
      );
  },
);

After<StoryWorld>({ tags: `@${HTTP_CLIENT_REQUIREMENT}` }, async function () {
  await sessions.get(this)?.dispose();
});

When<StoryWorld>(
  "the person edits an HTTP file and explicitly sends its buffer request",
  { timeout: 90_000 },
  async function () {
    const value = session(this);
    try {
      await value.sendEditorFileRequest();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
