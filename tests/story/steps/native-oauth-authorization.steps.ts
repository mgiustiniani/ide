import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeOAuthAuthorizationSession } from "../support/native-oauth-authorization.js";
import type { StoryWorld } from "../support/world.js";
const sessions = new WeakMap<StoryWorld, NativeOAuthAuthorizationSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("Native OAuth fixture is unavailable");
  return value;
}
Given<StoryWorld>(
  "the native OAuth tool has an isolated workspace and authorization service",
  { timeout: 15000 },
  async function () {
    const value = new NativeOAuthAuthorizationSession();
    sessions.set(this, value);
    await value.prepare();
  },
);
When<StoryWorld>(
  "the person approves OAuth consent in the external browser and sends a protected request",
  { timeout: 90000 },
  async function () {
    try {
      await session(this).approve();
    } catch (error) {
      session(this).setFailure(error);
      await session(this).captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "the native OAuth exchange preserves PKCE and requires explicit token use",
  function () {
    const value = session(this).evidence();
    for (const key of [
      "externalBrowserOpened",
      "consentWasExplicit",
      "verifierStayedNative",
      "stateForgeryRefused",
      "publicCodeExchangePassed",
      "consentDelayExcludedFromExpiry",
      "protectedRequestExplicit",
      "callbackReplayRefused",
      "credentialsNotStored",
    ] as const)
      if (!value[key]) throw new Error(`OAuth native proof missing: ${key}`);
  },
);
When<StoryWorld>(
  "the person cancels browser sign-in and rejects denied or mismatched issuer responses",
  { timeout: 90000 },
  async function () {
    try {
      await session(this).refuseAndCancel();
    } catch (error) {
      session(this).setFailure(error);
      await session(this).captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>("refused OAuth responses do not exchange or use another token", function () {
  const value = session(this).evidence();
  if (
    !value.issuerMismatchRefused ||
    !value.denialRefused ||
    !value.cancellationClosedListener ||
    value.tokenRequests !== 1 ||
    value.apiRequests !== 1
  )
    throw new Error("Refused OAuth attempts changed token or API authority");
});
When<StoryWorld>("the person closes the OAuth IDE window", { timeout: 20000 }, async function () {
  try {
    await session(this).close();
  } catch (error) {
    session(this).setFailure(error);
    await session(this).captureFailure();
    throw error;
  }
});
Then<StoryWorld>(
  "the OAuth IDE and owned browser fixture exit cleanly without changing workspace files",
  function () {
    const value = session(this).evidence();
    if (!value.cleanExit || !value.workspaceUnchanged || !value.browserRemainedIndependent)
      throw new Error(
        "OAuth native fixture did not preserve browser ownership and workspace contents",
      );
  },
);
After<StoryWorld>({ tags: "@http-oauth-browser" }, async function () {
  await sessions.get(this)?.dispose();
});
