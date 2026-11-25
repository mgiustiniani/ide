import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { copyFile, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";
import { snapshotWorkspace } from "./native-http-client.js";
interface Grant {
  state: string;
  redirect: string;
  challenge: string;
  client: string;
  used: boolean;
}

export class NativeOAuthAuthorizationSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #server?: Server;
  #browser?: Browser;
  #browserIdentity?: { pid: number; startTime: string };
  #origin = "";
  #browserRoot = "";
  #browserBinary = "";
  #browserTemp = "";
  #snapshot = "";
  #failure?: unknown;
  #authorizationCount = 0;
  #tokenCount = 0;
  #apiCount = 0;
  #grants = new Map<string, Grant>();
  #codes = new Map<string, Grant>();
  #latest?: Grant;
  readonly #proof = {
    nativeGui: true,
    externalBrowserOpened: false,
    consentWasExplicit: false,
    verifierStayedNative: false,
    stateForgeryRefused: false,
    publicCodeExchangePassed: false,
    consentDelayExcludedFromExpiry: false,
    protectedRequestExplicit: false,
    issuerMismatchRefused: false,
    denialRefused: false,
    cancellationClosedListener: false,
    callbackReplayRefused: false,
    credentialsNotStored: false,
    browserRemainedIndependent: false,
    workspaceUnchanged: false,
    cleanExit: false,
    serviceClosed: false,
  };
  evidence() {
    return {
      ...this.#proof,
      authorizationRequests: this.#authorizationCount,
      tokenRequests: this.#tokenCount,
      apiRequests: this.#apiCount,
    };
  }
  setFailure(value: unknown) {
    this.#failure ??= value;
  }
  async prepare() {
    const binary = process.env.IDE_STORY_OAUTH_BROWSER_BINARY;
    assert.ok(
      binary && path.isAbsolute(binary),
      "set IDE_STORY_OAUTH_BROWSER_BINARY to the absolute fixture Chromium executable",
    );
    assert.ok((await stat(binary)).isFile());
    this.#browserBinary = binary;
    // Chromium's Unix singleton socket needs a short pathname. Keep only its
    // scratch data here; the browser profile and diagnostics stay in the lease.
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    this.#browserTemp = await mkdtemp("/tmp/ide-oauth-browser-");
    await writeFile(
      path.join(this.#browserTemp, "owner.json"),
      JSON.stringify({ browserBinary: binary }),
      { flag: "wx", mode: 0o600 },
    );
    this.#lease = await NativeScenarioEnvironmentLease.acquire("REQ-IDE-HTTP-CLIENT-001");
    this.#server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url!, this.#origin || "http://127.0.0.1");
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        response.setHeader("Connection", "close");
        response.setHeader("Cache-Control", "no-store");
        if (url.pathname === "/authorize") {
          this.#authorizationCount += 1;
          assert.equal(url.searchParams.get("response_type"), "code");
          assert.equal(url.searchParams.get("code_challenge_method"), "S256");
          assert.equal(url.searchParams.has("code_verifier"), false);
          assert.equal(url.searchParams.has("client_secret"), false);
          const grant = {
            state: url.searchParams.get("state")!,
            redirect: url.searchParams.get("redirect_uri")!,
            challenge: url.searchParams.get("code_challenge")!,
            client: url.searchParams.get("client_id")!,
            used: false,
          };
          assert.match(grant.state, /^[A-Za-z0-9_-]{43}$/u);
          assert.match(grant.challenge, /^[A-Za-z0-9_-]{43}$/u);
          assert.equal(grant.client, "native-pkce-client");
          assert.equal(new URL(grant.redirect).pathname, "/oauth/callback");
          this.#grants.set(grant.state, grant);
          this.#latest = grant;
          response.setHeader(
            "Set-Cookie",
            "fixture-consent=browser-only; HttpOnly; SameSite=Lax; Path=/",
          );
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(
            `<!doctype html><title>Native OAuth fixture consent</title><h1>Fixture service access</h1><form method="post" action="/consent"><input type="hidden" name="state" value="${grant.state}"><button name="decision" value="allow">Approve service access</button><button name="decision" value="deny">Deny service access</button><button name="decision" value="wrong-issuer">Return a wrong issuer</button></form>`,
          );
          return;
        }
        if (url.pathname === "/consent") {
          assert.equal(request.headers.cookie, "fixture-consent=browser-only");
          const grant = this.#grants.get(form.get("state")!);
          assert.ok(grant);
          const target = new URL(grant.redirect);
          target.searchParams.set("state", grant.state);
          target.searchParams.set(
            "iss",
            `${this.#origin}/${form.get("decision") === "wrong-issuer" ? "wrong-issuer" : "issuer"}`,
          );
          if (form.get("decision") === "deny") {
            target.searchParams.set("error", "access_denied");
            target.searchParams.set("error_description", "private denied fixture");
          } else {
            const code = randomUUID();
            this.#codes.set(code, grant);
            target.searchParams.set("code", code);
          }
          response.statusCode = 303;
          response.setHeader("Location", target.href);
          response.end();
          return;
        }
        if (url.pathname === "/token") {
          this.#tokenCount += 1;
          const code = form.get("code")!,
            grant = this.#codes.get(code);
          assert.ok(grant);
          assert.equal(grant.used, false);
          grant.used = true;
          this.#codes.delete(code);
          assert.equal(form.get("grant_type"), "authorization_code");
          assert.equal(form.get("redirect_uri"), grant.redirect);
          assert.equal(form.get("client_id"), grant.client);
          assert.equal(request.headers.authorization, undefined);
          assert.equal(request.headers.cookie, undefined);
          assert.equal(form.has("client_secret"), false);
          const verifier = form.get("code_verifier")!;
          assert.match(verifier, /^[A-Za-z0-9_-]{43}$/u);
          assert.notEqual(verifier, grant.challenge);
          assert.equal(createHash("sha256").update(verifier).digest("base64url"), grant.challenge);
          this.#proof.verifierStayedNative = true;
          this.#proof.publicCodeExchangePassed = true;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              access_token: "pkce-fixture-access-token",
              token_type: "Bearer",
              expires_in: 5,
              scope: "read",
              refresh_token: "ignored-pkce-refresh",
            }),
          );
          return;
        }
        if (url.pathname === "/api") {
          this.#apiCount += 1;
          assert.equal(request.headers.authorization, "Bearer pkce-fixture-access-token");
          assert.equal(request.headers.cookie, undefined);
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ message: "Protected PKCE fixture" }));
          return;
        }
        response.statusCode = 404;
        response.end();
      } catch (error) {
        this.#failure = error;
        response.statusCode = 500;
        response.end("OAuth fixture failed");
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(0, "127.0.0.1", resolve);
    });
    const address = this.#server.address();
    assert.ok(address && typeof address !== "string");
    this.#origin = `http://127.0.0.1:${address.port}`;
    this.#browserRoot = path.join(this.#lease.paths.root, "external-browser");
    await mkdir(this.#browserRoot, { mode: 0o700 });
    await copyFile(
      fileURLToPath(new URL("./native-oauth-browser.py", import.meta.url)),
      path.join(this.#browserRoot, "launch-browser"),
    );
    const { chmod } = await import("node:fs/promises");
    await chmod(path.join(this.#browserRoot, "launch-browser"), 0o700);
    const launcher = path.join(this.#browserRoot, "launch-browser");
    assert.ok(
      !/[\s"\\]/u.test(launcher),
      "the isolated desktop launcher path must use literal Exec arguments",
    );
    const applications = path.join(this.#lease.paths.xdgData, "applications");
    await mkdir(applications, { recursive: true });
    await writeFile(
      path.join(applications, "ide-oauth-fixture.desktop"),
      `[Desktop Entry]\nType=Application\nName=Native OAuth fixture browser\nExec=${launcher} %u\nTerminal=false\nNoDisplay=true\nMimeType=x-scheme-handler/http;x-scheme-handler/https;\n`,
      { flag: "wx", mode: 0o600 },
    );
    const associations =
      "[Default Applications]\nx-scheme-handler/http=ide-oauth-fixture.desktop\nx-scheme-handler/https=ide-oauth-fixture.desktop\n";
    await writeFile(path.join(this.#lease.paths.xdgConfig, "mimeapps.list"), associations, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(path.join(applications, "mimeapps.list"), associations, {
      flag: "wx",
      mode: 0o600,
    });
  }
  private async open() {
    assert.ok(this.#lease);
    this.#app = new NativeDesktopApplication();
    await this.#app.launch({
      BROWSER: path.join(this.#browserRoot, "launch-browser"),
      XDG_CURRENT_DESKTOP: "X-Generic",
      IDE_STORY_OAUTH_BROWSER_ROOT: this.#browserRoot,
      IDE_STORY_OAUTH_AUTHORIZATION_ORIGIN: this.#origin,
      IDE_STORY_OAUTH_BROWSER_BINARY: this.#browserBinary,
      IDE_STORY_OAUTH_BROWSER_TMP: this.#browserTemp,
    });
    await this.#app.waitForFileExplorer();
    this.#snapshot = await snapshotWorkspace(this.#lease.paths.workspace);
    const browser = this.#app.browser();
    await browser.$("button=HTTP Client").click();
    await browser.$('[aria-label="HTTP client"]').waitForDisplayed({ timeout: 5000 });
    await browser.$("summary=OAuth 2.0 browser sign-in (PKCE)").click();
    for (const [label, value] of [
      ["OAuth authorization endpoint", `${this.#origin}/authorize`],
      ["OAuth sign-in token endpoint", `${this.#origin}/token`],
      ["OAuth expected issuer", `${this.#origin}/issuer`],
      ["OAuth sign-in client ID", "native-pkce-client"],
      ["OAuth sign-in scopes", "read"],
    ])
      await pasteNativeText(this.#app, browser.$(`[aria-label="${label}"]`), value!);
    await browser.$("label*=Allow HTTP for numeric loopback development endpoints").click();
    assert.equal(this.#authorizationCount, 0);
    assert.equal(this.#tokenCount, 0);
    assert.equal(this.#apiCount, 0);
  }
  private async externalPage(state: string): Promise<Page> {
    const native = this.#app!.browser();
    if (!this.#browser) {
      const file = path.join(this.#browserRoot, "profile/DevToolsActivePort");
      await native.waitUntil(
        async () => {
          try {
            return Number((await readFile(file, "utf8")).split("\n")[0]) > 0;
          } catch {
            return false;
          }
        },
        { timeout: 10000 },
      );
      const port = Number((await readFile(file, "utf8")).split("\n")[0]);
      this.#browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      // Keep a fixture-owned blank tab so closing one consent page does not exit
      // the browser before the following cancellation and refusal attempts.
      await this.#browser.contexts()[0]!.newPage();
      const launch = JSON.parse(
        await readFile(path.join(this.#browserRoot, "launch-identity.json"), "utf8"),
      );
      assert.equal(launch.scope, this.#browserRoot);
      assert.equal(await realpath(launch.executable), await realpath(this.#browserBinary));
      assert.equal(
        await realpath(launch.profile),
        await realpath(path.join(this.#browserRoot, "profile")),
      );
      const control = await this.#browser.newBrowserCDPSession();
      const { arguments: command } = await control.send("Browser.getBrowserCommandLine");
      const profile = command
        .find((value: string) => value.startsWith("--user-data-dir="))
        ?.slice("--user-data-dir=".length);
      assert.ok(profile);
      assert.equal(await realpath(profile), await realpath(launch.profile));
      const { processInfo } = await control.send("SystemInfo.getProcessInfo");
      assert.equal(
        processInfo.find((value: { type: string }) => value.type === "browser")?.id,
        launch.pid,
      );
      await control.detach();
      const owned: Array<{ pid: number; startTime: string }> = [];
      for (const pid of new Set<number>([launch.pid, ...launch.namespacePids])) {
        try {
          const value = await readFile(`/proc/${pid}/stat`, "utf8");
          const fields = value
            .slice(value.lastIndexOf(")") + 2)
            .trim()
            .split(/\s+/u);
          if (fields[19] === launch.startTime && fields[0] !== "Z" && fields[0] !== "X")
            owned.push({ pid, startTime: launch.startTime });
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      assert.equal(
        owned.length,
        1,
        "the private browser launch and DevTools identity must resolve to one live owned process",
      );
      this.#browserIdentity = owned[0];
    }
    let found: Page | undefined;
    await native.waitUntil(
      async () => {
        found = this.#browser!.contexts()
          .flatMap((context) => context.pages())
          .find((page) => {
            try {
              return new URL(page.url()).searchParams.get("state") === state;
            } catch {
              return false;
            }
          });
        return !!found;
      },
      { timeout: 10000 },
    );
    assert.ok(found);
    await found.getByRole("button", { name: "Approve service access" }).waitFor();
    return found;
  }
  private async begin(): Promise<{ grant: Grant; page: Page }> {
    const browser = this.#app!.browser(),
      before = this.#authorizationCount;
    await browser.$("button=Sign in with system browser").waitForEnabled({ timeout: 5000 });
    await browser.$("button=Sign in with system browser").click();
    await browser.waitUntil(async () => this.#authorizationCount === before + 1, {
      timeout: 10000,
    });
    await browser.$('[aria-label="OAuth redirect URI"]').waitForDisplayed({ timeout: 5000 });
    const grant = this.#latest!;
    return { grant, page: await this.externalPage(grant.state) };
  }
  async approve() {
    await this.open();
    const browser = this.#app!.browser();
    const { grant, page } = await this.begin();
    this.#proof.externalBrowserOpened = true;
    assert.equal(this.#tokenCount, 0);
    assert.equal(this.#apiCount, 0);
    this.#proof.consentWasExplicit = true;
    const forged = new URL(grant.redirect);
    forged.searchParams.set("state", "wrong-state");
    forged.searchParams.set("iss", `${this.#origin}/issuer`);
    forged.searchParams.set("code", "untrusted");
    const response = await fetch(forged, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 400);
    assert.equal(this.#tokenCount, 0);
    this.#proof.stateForgeryRefused = true;
    const consentAfter = Date.now() + 6000;
    await browser.waitUntil(async () => Date.now() >= consentAfter, {
      timeout: 8000,
      interval: 100,
    });
    assert.equal(this.#tokenCount, 0);
    await page.getByRole("button", { name: "Approve service access" }).click();
    await browser
      .$('[aria-label="OAuth sign-in token metadata"]')
      .waitForDisplayed({ timeout: 10000 });
    assert.equal(this.#tokenCount, 1);
    assert.equal(this.#apiCount, 0);
    await page.getByText("Sign-in response received.", { exact: false }).waitFor();
    await assert.rejects(fetch(grant.redirect, { signal: AbortSignal.timeout(2000) }));
    this.#proof.callbackReplayRefused = true;
    assert.equal(await browser.$("button=Use sign-in token").isEnabled(), true);
    this.#proof.consentDelayExcludedFromExpiry = true;
    await browser.$("button=Use sign-in token").click();
    assert.equal(this.#apiCount, 0);
    await pasteNativeText(
      this.#app!,
      browser.$('[aria-label="Request URL"]'),
      `${this.#origin}/api`,
    );
    await browser.$("button=Send").click();
    await browser.waitUntil(
      async () =>
        this.#apiCount === 1 &&
        (await browser.$('[aria-label="HTTP response"]').getText()).includes(
          "Protected PKCE fixture",
        ),
      { timeout: 5000 },
    );
    this.#proof.protectedRequestExplicit = true;
    await browser.$("summary=Saved requests and environments").click();
    await browser.$('[aria-label="HTTP request name"]').setValue("PKCE protected");
    await browser.$("button=Save request").waitForEnabled({ timeout: 5000 });
    await browser.$("button=Save request").click();
    await browser.$("button=Reload collections").waitForEnabled({ timeout: 5000 });
    const directory = path.join(this.#lease!.paths.ideHome, "http-client");
    for (const file of await readdir(directory))
      if (file.endsWith(".json")) {
        const content = await readFile(path.join(directory, file), "utf8");
        for (const secret of [
          "pkce-fixture-access-token",
          "ignored-pkce-refresh",
          "native-pkce-client",
          grant.state,
          grant.challenge,
        ])
          assert.ok(!content.includes(secret));
      }
    this.#proof.credentialsNotStored = true;
    await page.close();
  }
  async refuseAndCancel() {
    const browser = this.#app!.browser();
    let active = await this.begin();
    await browser.$("button=Cancel browser sign-in").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="OAuth browser status"]').getText()).includes(
          "cancelled locally",
        ),
      { timeout: 5000 },
    );
    await assert.rejects(fetch(active.grant.redirect, { signal: AbortSignal.timeout(2000) }));
    assert.equal(this.#tokenCount, 1);
    this.#proof.cancellationClosedListener = true;
    await active.page.close();
    active = await this.begin();
    await active.page.getByRole("button", { name: "Deny service access" }).click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="OAuth browser status"]').getText()).includes(
          "did not complete",
        ),
      { timeout: 5000 },
    );
    assert.equal(this.#tokenCount, 1);
    assert.equal(
      await browser.$('[aria-label="OAuth sign-in token metadata"]').isExisting(),
      false,
    );
    this.#proof.denialRefused = true;
    await active.page.close();
    active = await this.begin();
    await active.page.getByRole("button", { name: "Return a wrong issuer" }).click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="OAuth browser status"]').getText()).includes(
          "did not complete",
        ),
      { timeout: 5000 },
    );
    assert.equal(this.#tokenCount, 1);
    assert.equal(this.#apiCount, 1);
    this.#proof.issuerMismatchRefused = true;
    await active.page.close();
  }
  async captureFailure() {
    if (!this.#lease) return;
    const data: Record<string, unknown> = {};
    for (const file of [
      "browser.pid",
      "launch-identity.json",
      "profile/DevToolsActivePort",
      "browser-stderr.log",
    ]) {
      try {
        data[file] = (await readFile(path.join(this.#browserRoot, file), "utf8")).slice(-16000);
      } catch (error) {
        data[file] = String(error);
      }
    }
    try {
      data.files = await readdir(this.#browserRoot);
    } catch {
      /* Preserve primary failure. */
    }
    if (this.#app)
      for (const name of [
        "BROWSER",
        "XDG_CURRENT_DESKTOP",
        "IDE_STORY_OAUTH_BROWSER_ROOT",
      ] as const) {
        try {
          data[name] = await this.#app.environmentValue(name);
        } catch {
          /* Application may have exited. */
        }
      }
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path.join(this.#lease.runnerArtifactPath, "oauth-browser-failure-diagnostics.json"),
      JSON.stringify(data, null, 2) + "\n",
    );
  }
  async close() {
    await this.#app!.closeWindow();
    this.#proof.cleanExit = true;
    assert.ok(this.#browser?.isConnected());
    assert.ok(this.#browserIdentity);
    assert.ok((await stat(`/proc/${this.#browserIdentity.pid}`)).isDirectory());
    await this.#browser!.contexts()[0]!.pages()[0]!.title();
    this.#proof.browserRemainedIndependent = true;
    await this.stopBrowser();
    assert.equal(await snapshotWorkspace(this.#lease!.paths.workspace), this.#snapshot);
    this.#proof.workspaceUnchanged = true;
  }
  private async stopBrowser() {
    const identity = this.#browserIdentity;
    // An unavailable control connection can be an ordinary consequence of exit.
    // Process identity and state, rather than empty cmdline during exit, decide cleanup.
    try {
      if (this.#browser?.isConnected()) await this.#browser.close();
    } catch {
      /* The owned process check below still has to prove termination. */
    }
    if (!identity) return;
    const live = async () => {
      try {
        const value = await readFile(`/proc/${identity.pid}/stat`, "utf8");
        const fields = value
          .slice(value.lastIndexOf(")") + 2)
          .trim()
          .split(/\s+/u);
        return fields[19] === identity.startTime && fields[0] !== "Z" && fields[0] !== "X";
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
      }
    };
    const wait = async () => {
      const until = Date.now() + 2000;
      while (await live()) {
        if (Date.now() >= until) return false;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return true;
    };
    if (await wait()) return;
    if (await live()) process.kill(identity.pid, "SIGTERM");
    assert.equal(await wait(), true, "the owned external browser fixture did not terminate");
  }
  async dispose() {
    let cleanupError: unknown;
    for (const action of [
      async () => {
        if (!this.#proof.cleanExit) await this.#app?.closeWindow();
      },
      async () => this.stopBrowser(),
      async () => this.#app?.dispose(),
      async () => {
        if (this.#server?.listening)
          await new Promise<void>((resolve, reject) =>
            this.#server!.close((error) => (error ? reject(error) : resolve())),
          );
        this.#proof.serviceClosed = true;
      },
    ]) {
      try {
        await action();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    const artifact = this.#lease?.runnerArtifactPath;
    try {
      if (this.#browserTemp) {
        assert.equal(path.dirname(this.#browserTemp), "/tmp");
        assert.match(path.basename(this.#browserTemp), /^ide-oauth-browser-[A-Za-z0-9]+$/u);
        const owner = JSON.parse(
          await readFile(path.join(this.#browserTemp, "owner.json"), "utf8"),
        );
        assert.equal(owner.browserBinary, this.#browserBinary);
        const { rm } = await import("node:fs/promises");
        await rm(this.#browserTemp, { recursive: true, force: true });
        this.#browserTemp = "";
      }
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      await this.#lease?.dispose();
    } catch (error) {
      cleanupError ??= error;
    }
    if (artifact) {
      const { writeFile } = await import("node:fs/promises");
      const failure = this.#failure ?? cleanupError;
      await writeFile(
        path.join(artifact, "oauth-browser-native-evidence.json"),
        JSON.stringify({ ...this.evidence(), failure: failure ? String(failure) : null }, null, 2) +
          "\n",
      );
    }
    if (cleanupError) throw cleanupError;
  }
}
