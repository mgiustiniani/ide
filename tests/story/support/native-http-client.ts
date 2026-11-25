import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { lstat, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { pasteNativeText } from "./native-text-input.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export const HTTP_CLIENT_REQUIREMENT = "REQ-IDE-HTTP-CLIENT-001";

export async function snapshotWorkspace(
  root: string,
  ignoreMarker = false,
  ignoreFile?: string,
): Promise<string> {
  const entries: string[] = [];
  async function visit(directory: string): Promise<void> {
    const children = (await readdir(directory)).sort((left, right) => left.localeCompare(right));
    for (const name of children) {
      const filePath = path.join(directory, name);
      const relativePath = path.relative(root, filePath);
      if (ignoreMarker && relativePath.replaceAll("\\", "/") === ".ide/workspace.json") continue;
      if (relativePath.replaceAll("\\", "/") === ignoreFile) continue;
      const metadata = await lstat(filePath);
      if (metadata.isSymbolicLink()) {
        entries.push(`link:${relativePath}:${await readlink(filePath)}`);
      } else if (metadata.isDirectory()) {
        entries.push(`directory:${relativePath}`);
        await visit(filePath);
      } else if (metadata.isFile()) {
        const digest = createHash("sha256")
          .update(await readFile(filePath))
          .digest("hex");
        entries.push(`file:${relativePath}:${digest}`);
      } else {
        entries.push(`other:${relativePath}:${metadata.mode}`);
      }
    }
  }
  await visit(root);
  return JSON.stringify(entries);
}

interface CapturedRequest {
  method: string | undefined;
  path: string | undefined;
  contentType: string | undefined;
  body: string;
  httpVersion: string;
  variableHeader?: string | string[];
  authorization?: string;
  parameterHeader?: string | string[];
}

export class NativeHttpClientSession {
  #lease?: NativeScenarioEnvironmentLease;
  #server?: Server;
  #application?: NativeDesktopApplication;
  #url?: string;
  #captured?: CapturedRequest;
  #requestCount = 0;
  #workspaceSnapshot?: string;
  #failure?: unknown;
  readonly #proof = {
    nativeGui: true,
    oauthExplicitAcquisition: false,
    oauthTokenSelectedWithoutSend: false,
    oauthProtectedRequestPassed: false,
    oauthBodyAuthenticationPassed: false,
    oauthScopeErrorRedacted: false,
    oauthExpiryRefused: false,
    oauthExpiredSendRefused: false,
    oauthCredentialsNotPersisted: false,
    oauthClearedOnLoad: false,
    authenticationVerified: false,
    authenticationNotPersisted: false,
    authenticationClearedOnLoad: false,
    editorBufferSent: false,
    staleFileSelectionRetired: false,
    unsupportedFileRequestRefused: false,
    savedRequestRestored: false,
    collectionJsonExported: false,
    collectionFileExported: false,
    externalCollectionFileExported: false,
    externalCollectionFileRefused: false,
    externalCollectionCancelVerified: false,
    existingExportFileRefused: false,
    workspacePreservedApartFromExport: false,
    collectionFileLoadedForReview: false,
    oversizedCollectionFileRefused: false,
    invalidUtf8CollectionFileRefused: false,
    collectionImportReviewed: false,
    collectionImportKeptMatchingEntries: false,
    importedEntriesPersistedAfterRestart: false,
    savedEnvironmentRestored: false,
    templatesPreserved: false,
    responsesNotStored: false,
    restartVerified: false,
    requestSentOnlyAfterClick: false,
    localReferencesImported: false,
    openApiParametersPrepared: false,
    openApiParameterRefusalVerified: false,
    openApiParameterEditRequiredPreparation: false,
    openApiParametersReceived: false,
    localFileImported: false,
    oversizedFileRefused: false,
    invalidUtf8FileRefused: false,
    invalidReferenceImportRefused: false,
    requestReachedLocalService: false,
    responsePresented: false,
    workspaceUnchanged: false,
    cleanExit: false,
    serviceClosed: false,
    workspace: "",
  };

  evidence() {
    return { ...this.#proof, requestCount: this.#requestCount };
  }

  capturedRequest(): CapturedRequest | undefined {
    return this.#captured;
  }

  setFailure(error: unknown): void {
    this.#failure = error;
  }

  async prepare(profile: { driver: string; packagedApplication: boolean }): Promise<void> {
    assert.equal(profile.driver, "tauri-webdriver");
    assert.equal(profile.packagedApplication, false);
    this.#lease = await NativeScenarioEnvironmentLease.acquire(HTTP_CLIENT_REQUIREMENT);
    this.#proof.workspace = this.#lease.paths.workspace;
    this.#server = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request)
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString("utf8");
        this.#requestCount += 1;
        this.#captured = {
          httpVersion: request.httpVersion,
          method: request.method,
          path: request.url,
          contentType: request.headers["content-type"],
          variableHeader: request.headers["x-fixture"],
          parameterHeader: request.headers["x-trace"],
          ...(request.headers.authorization === undefined
            ? {}
            : { authorization: request.headers.authorization }),
          body,
        };
        if (request.url?.startsWith("/oauth/token")) {
          const params = new URLSearchParams(body);
          const expectedBasic = "Basic " + Buffer.from("native%3A%C3%A9+%2B:fixture%3A%C2%A3+%2B%26").toString("base64");
          const valid = request.method === "POST" && request.headers["content-type"] === "application/x-www-form-urlencoded" &&
            params.get("grant_type") === "client_credentials" &&
            ((request.headers.authorization === expectedBasic && !params.has("client_secret") && !params.has("client_id")) ||
             (request.headers.authorization === undefined && params.get("client_id") === "native:é +" && params.get("client_secret") === "fixture:£ +&"));
          response.setHeader("Content-Type", "application/json"); response.setHeader("Cache-Control", "no-store");
          response.setHeader("Pragma", "no-cache"); response.setHeader("Connection", "close");
          response.statusCode = valid && params.get("scope") !== "deny" ? 200 : 400;
          response.end(JSON.stringify(response.statusCode === 200 ? {access_token:"oauth-native-token",token_type:"Bearer",expires_in:request.url.includes("expired=true") ? 0 : request.url.includes("short=true") ? 2 : 3600,scope:"read"} : {error:"invalid_scope",error_description:"private native fixture secret"}));
          return;
        }
        const expected =
          request.url === "/api/auth/basic"
            ? "Basic dGVzdDoxMjPCow=="
            : request.url === "/api/auth/oauth"
              ? "Bearer oauth-native-token"
            : request.url === "/api/auth/bearer"
              ? "Bearer native-fixture-token"
              : undefined;
        response.statusCode = expected && request.headers.authorization !== expected ? 401 : 201;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("connection", "close");
        response.end(JSON.stringify({ message: "Hello, IDE" }));
      } catch (error) {
        this.#failure = error;
        response.statusCode = 500;
        response.end("fixture failed");
      }
    });
    this.#server.keepAliveTimeout = 1;
    await new Promise<void>((resolve, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.#server.address();
    assert.ok(address && typeof address !== "string");
    this.#url = `http://127.0.0.1:${address.port}/api/hello`;
    await this.#lease.assertConfiguredPathsConfined();
  }

  async sendRequest(): Promise<void> {
    assert.ok(this.#lease && this.#url);
    this.#application = new NativeDesktopApplication();
    await this.#application.launch();
    await this.#application.waitForFileExplorer();
    this.#workspaceSnapshot = await snapshotWorkspace(this.#lease.paths.workspace);
    const browser = this.#application.browser();

    const tab = browser.$("button=HTTP Client");
    await tab.waitForEnabled({ timeout: 5_000 });
    await tab.click();
    await browser.$('[aria-label="HTTP client"]').waitForDisplayed({ timeout: 5_000 });
    assert.equal(this.#captured, undefined, "opening the HTTP client must not send a request");

    await browser.$('[aria-label="HTTP method"]').selectByAttribute("value", "POST");
    await browser.$('[aria-label="Request URL"]').setValue(this.#url);
    await browser.$("button=Add header").click();
    await browser.$('[aria-label="Header 1 name"]').setValue("Content-Type");
    await browser.$('[aria-label="Header 1 value"]').setValue("application/json");
    await browser.$('[aria-label="Request body"]').setValue('{"name":"IDE"}');

    await browser.$("button=Send").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="HTTP response"]').getText()).includes("201 Created") &&
        (await browser.$('[aria-label="HTTP response"]').getText()).includes("Hello, IDE"),
      { timeout: 10_000, interval: 100, timeoutMsg: "HTTP response was not shown in the IDE" },
    );

    const captured = this.capturedRequest();
    assert.ok(captured, "the local service did not receive the submitted request");
    assert.equal(captured.method, "POST");
    assert.equal(captured.path, "/api/hello");
    assert.equal(captured.contentType, "application/json");
    assert.equal(captured.body, '{"name":"IDE"}');
    this.#proof.requestSentOnlyAfterClick = true;
    this.#proof.requestReachedLocalService = true;
    this.#proof.responsePresented = true;
  }

  async sendAuthenticatedRequests(): Promise<void> {
    await this.sendRequest();
    assert.ok(this.#application && this.#lease && this.#url);
    const application = this.#application,
      browser = application.browser();
    const input = async (label: string, value: string) =>
      pasteNativeText(application, browser.$(`[aria-label="${label}"]`), value);
    const submit = async (count: number) => {
      await browser.$("button=Send").click();
      await browser.waitUntil(
        async () =>
          this.#requestCount === count &&
          (await browser.$('[aria-label="HTTP response"]').getText()).includes("201 Created"),
        { timeout: 10000 },
      );
    };
    await input("Request URL", `${new URL(this.#url).origin}/api/auth/basic`);
    await browser.$('[aria-label="Authentication"]').selectByAttribute("value", "basic");
    await input("Basic username", "test");
    await input("Basic password", "123£");
    assert.equal(await browser.$('[aria-label="Basic password"]').getAttribute("type"), "password");
    assert.equal(this.#requestCount, 1);
    await submit(2);
    assert.equal(this.#captured?.authorization, "Basic dGVzdDoxMjPCow==");
    await input("Request URL", `${new URL(this.#url).origin}/api/auth/bearer`);
    await browser.$('[aria-label="Authentication"]').selectByAttribute("value", "bearer");
    await input("Bearer token", "native-fixture-token");
    assert.equal(this.#requestCount, 2);
    await submit(3);
    assert.equal(this.#captured?.authorization, "Bearer native-fixture-token");
    await browser.$("summary=Saved requests and environments").click();
    await browser.$('[aria-label="HTTP request name"]').setValue("Protected");
    await browser.$("button=Save request").waitForEnabled({ timeout: 5000 });
    await browser.$("button=Save request").click();
    await browser.$("button=Reload collections").waitForEnabled({ timeout: 5000 });
    const storage = path.join(this.#lease.paths.ideHome, "http-client");
    const files = (await readdir(storage)).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 1);
    const stored = await readFile(path.join(storage, files[0]!), "utf8");
    for (const secret of ["native-fixture-token", "123£", "dGVzdDoxMjPCow=="])
      assert.ok(!stored.includes(secret));
    assert.equal(this.#requestCount, 3);
    const selected = browser.$('[aria-label="Saved HTTP request"]');
    await selected.click();
    await browser.keys("Home");
    await browser.keys("Enter");
    await selected.click();
    await browser.keys("Home");
    await browser.keys("ArrowDown");
    await browser.keys("Enter");
    assert.equal(await browser.$('[aria-label="Authentication"]').getValue(), "none");
    assert.equal(await browser.$('[aria-label="Bearer token"]').isExisting(), false);
    await input("Request URL", this.#url);
    await submit(4);
    assert.equal(this.#captured?.authorization, undefined);
    this.#proof.authenticationVerified = true;
    this.#proof.authenticationNotPersisted = true;
    this.#proof.authenticationClearedOnLoad = true;
    await this.exerciseOAuthClientCredentials();
  }

  private async exerciseOAuthClientCredentials(): Promise<void> {
    const application=this.#application!, browser=application.browser(), origin=new URL(this.#url!).origin;
    const input=async(label:string,value:string)=>pasteNativeText(application,browser.$(`[aria-label="${label}"]`),value);
    await browser.$("summary=OAuth 2.0 Client Credentials").click();
    await input("OAuth token endpoint",`${origin}/oauth/token`);
    await input("OAuth client ID","native:é +"); await input("OAuth client secret","fixture:£ +&");
    await input("OAuth scopes","read write");
    assert.equal(await browser.$('[aria-label="OAuth client secret"]').getAttribute("type"),"password");
    const before=this.#requestCount;
    const get=()=>browser.$("button=Get OAuth token");
    const status=()=>browser.$('[aria-label="OAuth status"]');
    await get().click();
    await browser.waitUntil(async()=>(await status().getText()).includes("failed"),{timeout:5000});
    assert.equal(this.#requestCount,before,"HTTP requires the explicit numeric loopback development exception");
    await browser.$('label*=Allow HTTP for a numeric loopback development endpoint').click();
    await get().click();
    await browser.$('[aria-label="OAuth token metadata"]').waitForDisplayed({timeout:5000});
    assert.equal(this.#requestCount,before+1);
    assert.equal(this.#captured?.path,"/oauth/token");
    assert.equal(this.#captured?.body,"grant_type=client_credentials&scope=read+write");
    assert.equal(this.#captured?.authorization,"Basic "+Buffer.from("native%3A%C3%A9+%2B:fixture%3A%C2%A3+%2B%26").toString("base64"));
    assert.ok(!(await browser.$('[aria-label="OAuth token metadata"]').getText()).includes("oauth-native-token"));
    this.#proof.oauthExplicitAcquisition=true;
    await input("Request URL",`${origin}/api/auth/oauth`);
    await browser.$("button=Use OAuth token").click();
    assert.equal(this.#requestCount,before+1); assert.equal(await browser.$('[aria-label="Authentication"]').getValue(),"bearer");
    assert.equal(await browser.$('[aria-label="Bearer token"]').getValue(),"oauth-native-token");
    this.#proof.oauthTokenSelectedWithoutSend=true;
    await browser.$("button=Send").click();
    await browser.waitUntil(async()=>this.#requestCount===before+2 && (await browser.$('[aria-label="HTTP response"]').getText()).includes("201 Created"),{timeout:5000});
    assert.equal(this.#captured?.path,"/api/auth/oauth");assert.equal(this.#captured?.authorization,"Bearer oauth-native-token");
    this.#proof.oauthProtectedRequestPassed=true;
    await browser.$('[aria-label="HTTP request name"]').setValue("OAuth protected");
    await browser.$("button=Save request").waitForEnabled({timeout:5000});await browser.$("button=Save request").click();
    await browser.$("button=Reload collections").waitForEnabled({timeout:5000});
    const storage=path.join(this.#lease!.paths.ideHome,"http-client");
    for(const file of await readdir(storage)) if(file.endsWith(".json")) {
      const value=await readFile(path.join(storage,file),"utf8");
      for(const secret of ["oauth-native-token","fixture:£ +&","native:é +","/oauth/token"])assert.ok(!value.includes(secret));
    }
    this.#proof.oauthCredentialsNotPersisted=true;
    await browser.$('[aria-label="OAuth client authentication"]').selectByAttribute("value","body");
    await get().click();await browser.$('[aria-label="OAuth token metadata"]').waitForDisplayed({timeout:5000});
    assert.equal(this.#requestCount,before+3); assert.equal(this.#captured?.authorization,undefined);
    const params=new URLSearchParams(this.#captured!.body);assert.equal(params.get("client_id"),"native:é +");assert.equal(params.get("client_secret"),"fixture:£ +&");
    this.#proof.oauthBodyAuthenticationPassed=true;
    await input("OAuth token endpoint",`${origin}/oauth/token?short=true`);await get().click();
    await browser.$('[aria-label="OAuth token metadata"]').waitForDisplayed({timeout:5000});
    await browser.$("button=Use OAuth token").click();
    assert.equal(this.#requestCount,before+4);
    const afterExpiry=Date.now()+2200;
    await browser.waitUntil(async()=>Date.now()>=afterExpiry,{timeout:4000,interval:100});
    await browser.$("button=Send").click();
    await browser.waitUntil(async()=>(await browser.$('[aria-label="HTTP response"]').getText()).includes("The OAuth token has expired"),{timeout:5000});
    assert.equal(this.#requestCount,before+4);this.#proof.oauthExpiredSendRefused=true;
    await input("OAuth token endpoint",`${origin}/oauth/token`);
    await input("OAuth scopes","deny");await get().click();
    await browser.waitUntil(async()=>(await status().getText()).includes("failed"),{timeout:5000});
    assert.equal(this.#requestCount,before+5);assert.ok(!(await status().getText()).includes("private native fixture secret"));
    assert.equal(await browser.$('[aria-label="OAuth token metadata"]').isExisting(),false);this.#proof.oauthScopeErrorRedacted=true;
    await input("OAuth scopes","read");await input("OAuth token endpoint",`${origin}/oauth/token?expired=true`);await get().click();
    await browser.$("p=Token expired. Acquire a new token.").waitForDisplayed({timeout:5000});
    assert.equal(this.#requestCount,before+6);assert.equal(await browser.$("button=Use OAuth token").isEnabled(),false);this.#proof.oauthExpiryRefused=true;
    const selected=browser.$('[aria-label="Saved HTTP request"]');
    await selected.click();await browser.keys("Home");await browser.keys("Enter");
    await selected.click();await browser.keys("Home");await browser.keys("ArrowDown");await browser.keys("Enter");
    assert.equal(await browser.$('[aria-label="Authentication"]').getValue(),"none");
    await browser.$("summary=OAuth 2.0 Client Credentials").click();
    assert.equal(await browser.$('[aria-label="OAuth client secret"]').getValue(),"");
    assert.equal(await browser.$('[aria-label="OAuth client ID"]').getValue(),"");
    assert.equal(await browser.$('[aria-label="OAuth token metadata"]').isExisting(),false);
    assert.equal(this.#requestCount,before+6);this.#proof.oauthClearedOnLoad=true;
  }

  async sendEditorFileRequest(): Promise<void> {
    assert.ok(this.#lease && this.#url);
    const file = "requests.http";
    const saved = `@host = ${new URL(this.#url).origin}
@base = {{host}}/api
@name = disk
### Create greeting
POST {{base}}/hello?source=file HTTP/1.1
Content-Type: application/json
X-Fixture: {{name}}

{"name":"{{name}}"}
### Health
GET {{host}}/health
### Script
POST {{host}}/api/hello
Content-Type: application/json

> {% code() %}
`;
    const edited = saved.replace("@name = disk", "@name = buffer");
    await writeFile(path.join(this.#lease.paths.workspace, file), saved);
    this.#application = new NativeDesktopApplication();
    await this.#application.launch();
    await this.#application.waitForFileExplorer();
    this.#workspaceSnapshot = await snapshotWorkspace(this.#lease.paths.workspace);
    const browser = this.#application.browser();
    const editor = new NativeEditorSurface(this.#application);
    await editor.open(file, saved);
    await browser.$("button=HTTP Client").click();
    await browser.$("summary=Requests from editor").click();
    await browser.$('[aria-label="HTTP file request"]').click();
    await browser.keys(["Home"]);
    await browser.keys(["ArrowDown"]);
    await browser.keys(["Enter"]);
    await browser
      .$('[aria-label="HTTP file request preview"]')
      .waitForDisplayed({ timeout: 5_000 });
    assert.equal(this.#requestCount, 0);
    await editor.replaceText(file, "@name = disk", "@name = buffer", edited);
    await browser.waitUntil(
      async () => (await browser.$('[aria-label="HTTP file request"]').getValue()) === "",
      { timeout: 5_000 },
    );
    assert.equal(await browser.$("button=Send file request").isEnabled(), false);
    this.#proof.staleFileSelectionRetired = true;
    await browser.$('[aria-label="HTTP file request"]').click();
    await browser.keys(["Home"]);
    await browser.keys(["ArrowDown"]);
    await browser.keys(["Enter"]);
    await browser
      .$('[aria-label="HTTP file request preview"]')
      .waitForDisplayed({ timeout: 5_000 });
    await browser
      .$('[aria-label="HTTP file request preview"]')
      .waitForDisplayed({ timeout: 5_000 });
    assert.ok(
      (await browser.$('[aria-label="HTTP file request preview"]').getText()).includes(
        '{"name":"buffer"}',
      ),
    );
    assert.equal(this.#requestCount, 0);
    await browser.$("button=Send file request").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="HTTP response"]').getText()).includes("201 Created"),
      { timeout: 10_000 },
    );
    assert.equal(this.#requestCount, 1);
    assert.deepEqual(this.#captured, {
      httpVersion: "1.1",
      method: "POST",
      path: "/api/hello?source=file",
      contentType: "application/json",
      variableHeader: "buffer",
      body: '{"name":"buffer"}\n',
    });
    assert.ok(
      (await browser.$('[aria-label="HTTP request source"]').getText()).includes("requests.http:5"),
    );
    await browser.$('[aria-label="HTTP file request"]').selectByAttribute("value", "2");
    await browser.$('[aria-label="HTTP file request error"]').waitForDisplayed({ timeout: 5_000 });
    assert.equal(await browser.$("button=Send file request").isEnabled(), false);
    assert.equal(this.#requestCount, 1);
    await editor.assertBuffer(file, edited);
    await editor.assertDirty(file, true);
    assert.equal(await readFile(path.join(this.#lease.paths.workspace, file), "utf8"), saved);
    this.#proof.editorBufferSent = true;
    this.#proof.unsupportedFileRequestRefused = true;
    this.#proof.requestSentOnlyAfterClick = true;
    this.#proof.requestReachedLocalService = true;
    this.#proof.responsePresented = true;
    await editor.discardUsingDisk(file, saved, { expectedBuffer: edited });
  }

  async sendOpenApiRequest(): Promise<void> {
    assert.ok(this.#lease && this.#url);
    this.#application = new NativeDesktopApplication();
    await this.#application.launch();
    await this.#application.waitForFileExplorer();
    this.#workspaceSnapshot = await snapshotWorkspace(this.#lease.paths.workspace);
    const browser = this.#application.browser();

    const tab = browser.$("button=HTTP Client");
    await tab.waitForEnabled({ timeout: 5_000 });
    await tab.click();
    await browser.$('[aria-label="HTTP client"]').waitForDisplayed({ timeout: 5_000 });
    assert.equal(this.#captured, undefined, "opening the HTTP client must not send a request");

    await browser.$("summary=OpenAPI routes").click();
    const specification = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Local API", version: "1.0.0" },
      servers: [{ url: new URL(this.#url).origin }],
      paths: { "/api/hello/{personId}": { $ref: "#/components/pathItems/Greeting" } },
      components: {
        pathItems: {
          Greeting: {
            parameters: [
              { name: "personId", in: "path", required: true, schema: { type: "string" } },
              { name: "tag", in: "query", schema: { type: "array" }, example: ["inherited"] },
            ],
            post: {
              parameters: [
                { $ref: "#/components/parameters/Tags" },
                { $ref: "#/components/parameters/Trace" },
              ],
              summary: "Greet a person",
              requestBody: { $ref: "#/components/requestBodies/Greeting" },
              responses: { "201": { description: "Created" } },
            },
          },
        },
        parameters: {
          Tags: { name: "tag", in: "query", schema: { type: "array" }, example: ["blue", "black"] },
          Trace: {
            name: "X-Trace",
            in: "header",
            content: { "text/plain": { example: "trace value" } },
          },
        },
        requestBodies: {
          Greeting: {
            content: {
              "application/json": {
                examples: { greeting: { $ref: "#/components/examples/Greeting" } },
              },
            },
          },
        },
        examples: { Greeting: { value: { name: "IDE" } } },
      },
    });
    const specificationField = browser.$('[aria-label="OpenAPI specification"]');
    await specificationField.setValue(
      specification.replace("#/components/pathItems/Greeting", "#/components/pathItems/Missing"),
    );
    await browser.$("button=Load OpenAPI").click();
    const refusedReference = browser.$('[aria-label="OpenAPI import error"]');
    await refusedReference.waitForDisplayed({ timeout: 5_000 });
    assert.ok((await refusedReference.getText()).includes("not found"));
    assert.equal(this.#captured, undefined, "a refused reference import must not send a request");
    assert.equal(await browser.$('[aria-label="Request URL"]').getValue(), "");
    this.#proof.invalidReferenceImportRefused = true;
    const fileInput = browser.$('[aria-label="Import OpenAPI file"]');
    const oversized = path.join(this.#lease.paths.evidence, "oversized-openapi.json");
    const invalidUtf8 = path.join(this.#lease.paths.evidence, "invalid-openapi.yaml");
    const documentFile = path.join(this.#lease.paths.evidence, "local-openapi.json");
    await writeFile(oversized, "x".repeat(1024 * 1024 + 1), { flag: "wx" });
    await writeFile(invalidUtf8, Buffer.from([0xc3, 0x28]), { flag: "wx" });
    await writeFile(documentFile, specification, { flag: "wx" });
    const beforeFile = await specificationField.getValue();
    await fileInput.setValue(oversized);
    const fileError = browser.$('[aria-label="OpenAPI file error"]');
    await browser.waitUntil(
      async () => (await fileError.isExisting()) && (await fileError.getText()).includes("1 MiB"),
      { timeout: 5_000, interval: 100 },
    );
    assert.equal(await specificationField.getValue(), beforeFile);
    assert.equal(this.#captured, undefined);
    this.#proof.oversizedFileRefused = true;
    await fileInput.setValue(invalidUtf8);
    await browser.waitUntil(
      async () => (await fileError.isExisting()) && (await fileError.getText()).includes("UTF-8"),
      { timeout: 5_000, interval: 100 },
    );
    assert.equal(await specificationField.getValue(), beforeFile);
    assert.equal(this.#captured, undefined);
    this.#proof.invalidUtf8FileRefused = true;
    await fileInput.setValue(documentFile);
    await browser.waitUntil(async () => (await specificationField.getValue()) === specification, {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: "The selected local OpenAPI file was not imported exactly",
    });
    assert.ok(
      (await browser.$('[aria-label="HTTP client"]').getText()).includes(
        "Loaded OpenAPI file: local-openapi.json",
      ),
    );
    assert.equal(await fileError.isExisting(), false);
    assert.equal(this.#captured, undefined, "importing a local file must not send it");
    this.#proof.localFileImported = true;
    const operationPicker = browser.$('[aria-label="OpenAPI operation"]');
    const importError = browser.$('[aria-label="OpenAPI import error"]');
    await browser.waitUntil(
      async () => (await operationPicker.isExisting()) || (await importError.isExisting()),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: "OpenAPI loading produced neither an operation nor an import error",
      },
    );
    if (await importError.isExisting()) {
      throw new Error(`OpenAPI import failed: ${await importError.getText()}`);
    }
    await browser.$('[aria-label="Request URL"]').setValue(this.#url);
    await operationPicker.selectByAttribute("value", "post:/api/hello/{personId}");
    assert.equal(await browser.$("button=Send").isEnabled(), false);
    await browser.$("button=Prepare request").click();
    assert.match(
      await browser.$('[aria-label="OpenAPI parameter error"]').getText(),
      /required path parameter personId/,
    );
    assert.equal(await browser.$('[aria-label="Request URL"]').getValue(), this.#url);
    assert.equal(this.#requestCount, 0);
    this.#proof.openApiParameterRefusalVerified = true;
    await pasteNativeText(
      this.#application,
      browser.$('[aria-label="OpenAPI value path personId"]'),
      "caffè/a",
    );
    await browser.$("button=Prepare request").click();
    assert.equal(
      await browser.$('[aria-label="Request URL"]').getValue(),
      `${this.#url}/caff%C3%A8%2Fa?tag=blue&tag=black`,
    );
    this.#proof.openApiParametersPrepared = true;
    await browser.$('[aria-label="OpenAPI value query tag"]').setValue('["blue","a/b & c"]');
    assert.equal(await browser.$("button=Send").isEnabled(), false);
    assert.equal(this.#requestCount, 0);
    this.#proof.openApiParameterEditRequiredPreparation = true;
    await browser.$("button=Prepare request").click();
    const preparedUrl = `${this.#url}/caff%C3%A8%2Fa?tag=blue&tag=a%2Fb%20%26%20c`;
    assert.equal(await browser.$('[aria-label="HTTP method"]').getValue(), "POST");
    assert.equal(await browser.$('[aria-label="Request URL"]').getValue(), preparedUrl);
    assert.equal(await browser.$('[aria-label="Header 1 name"]').getValue(), "X-Trace");
    assert.equal(await browser.$('[aria-label="Header 1 value"]').getValue(), "trace value");
    assert.equal(await browser.$('[aria-label="Header 2 value"]').getValue(), "application/json");
    assert.equal(
      await browser.$('[aria-label="Request body"]').getValue(),
      '{\n  "name": "IDE"\n}',
    );
    assert.equal(
      this.#captured,
      undefined,
      "loading or selecting an operation must not send a request",
    );

    await browser.$("button=Send").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="HTTP response"]').getText()).includes("201 Created") &&
        (await browser.$('[aria-label="HTTP response"]').getText()).includes("Hello, IDE"),
      { timeout: 10_000, interval: 100, timeoutMsg: "HTTP response was not shown in the IDE" },
    );

    const captured = this.capturedRequest();
    assert.ok(captured, "the local service did not receive the OpenAPI request");
    assert.equal(captured.method, "POST");
    assert.equal(captured.path, "/api/hello/caff%C3%A8%2Fa?tag=blue&tag=a%2Fb%20%26%20c");
    assert.equal(captured.parameterHeader, "trace value");
    this.#proof.openApiParametersReceived = true;
    assert.equal(captured.contentType, "application/json");
    assert.equal(captured.body, '{\n  "name": "IDE"\n}');
    this.#proof.localReferencesImported = true;
    this.#proof.requestSentOnlyAfterClick = true;
    this.#proof.requestReachedLocalService = true;
    this.#proof.responsePresented = true;
  }

  async saveReopenAndSendRequest(): Promise<void> {
    assert.ok(this.#lease && this.#url);
    this.#application = new NativeDesktopApplication();
    await this.#application.launch();
    await this.#application.waitForFileExplorer();
    this.#workspaceSnapshot = await snapshotWorkspace(this.#lease.paths.workspace);
    let withoutMarker = await snapshotWorkspace(this.#lease.paths.workspace, true);
    const markerPath = path.join(this.#lease.paths.workspace, ".ide/workspace.json");
    const originalMarker = JSON.parse(await readFile(markerPath, "utf8")) as Record<
      string,
      unknown
    >;
    let browser = this.#application.browser();
    await browser.$("button=HTTP Client").click();
    await browser.$("summary=Saved requests and environments").click();
    await browser.$("button=Reload collections").waitForEnabled({ timeout: 5_000 });
    assert.equal(this.#requestCount, 0);
    await browser.$('[aria-label="HTTP method"]').selectByAttribute("value", "POST");
    await browser.$('[aria-label="Request URL"]').setValue("{{baseUrl}}/api/hello");
    await browser.$('[aria-label="Request body"]').setValue('{"name":"{{name}}"}');
    await browser.$("button=Add header").click();
    await browser.$('[aria-label="Header 1 name"]').waitForDisplayed({ timeout: 5_000 });
    await browser.$('[aria-label="Header 1 name"]').setValue("Content-Type");
    await browser.$('[aria-label="Header 1 value"]').setValue("application/json");
    await browser.$("button=Add header").click();
    await browser.$('[aria-label="Header 2 name"]').waitForDisplayed({ timeout: 5_000 });
    await browser.$('[aria-label="Header 2 name"]').setValue("X-Fixture");
    await browser.$('[aria-label="Header 2 value"]').setValue("{{name}}");
    await browser.$('[aria-label="HTTP collection name"]').setValue("Local API");
    await browser.$('[aria-label="HTTP request name"]').setValue("Greeting");
    await browser.$("button=Save request").waitForEnabled({ timeout: 5_000 });
    await browser.$("button=Save request").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Saved HTTP request"]').getValue()) ===
        JSON.stringify(["Local API", "Greeting"]),
      { timeout: 5_000 },
    );
    await browser.$("summary=Edit environments").click();
    await browser.$('[aria-label="HTTP environment name"]').setValue("Local");
    await browser
      .$('[aria-label="HTTP environment variables"]')
      .setValue(JSON.stringify({ baseUrl: new URL(this.#url).origin, name: "IDE" }));
    await browser.$("button=Save environment").click();
    await browser.$("button=Reload collections").waitForEnabled({ timeout: 5_000 });
    await browser.waitUntil(
      async () => (await browser.$('[aria-label="HTTP environment"]').getValue()) === "Local",
      { timeout: 5_000 },
    );
    assert.equal(this.#requestCount, 0, "saving a request or environment must not send traffic");
    const storage = path.join(this.#lease.paths.ideHome, "http-client");
    const files = (await readdir(storage)).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 1);
    const storedPath = path.join(storage, files[0]!);
    let stored = await readFile(storedPath, "utf8");
    const data = JSON.parse(stored) as {
      requests: { url: string; body: string }[];
      environments: { name: string }[];
    };
    assert.equal(data.requests[0]?.url, "{{baseUrl}}/api/hello");
    assert.equal(data.requests[0]?.body, '{"name":"{{name}}"}');
    assert.equal(data.environments[0]?.name, "Local");
    await browser.$("summary=Import and export collections").click();
    await browser.$("button=Export collections JSON").click();
    const exported = await browser
      .$('[aria-label="HTTP client"]')
      .$("label=Exported HTTP collections JSON")
      .$("textarea")
      .getValue();
    assert.deepEqual(JSON.parse(exported), JSON.parse(stored));
    this.#proof.collectionJsonExported = true;
    const incoming = JSON.parse(exported);
    incoming.requests[0].body = "imported replacement must be skipped";
    incoming.environments[0].variables.name = "replacement must be skipped";
    incoming.requests.push({
      ...incoming.requests[0],
      name: "Imported greeting",
      body: "imported template",
    });
    incoming.environments.push({ name: "Imported environment", variables: { sample: "literal" } });
    const collectionText = browser.$("label=HTTP collections JSON to import").$("textarea");
    await collectionText.setValue(exported);
    const collectionFile = path.join(this.#lease.paths.evidence, "shared-http-collections.json");
    const oversizedCollection = path.join(
      this.#lease.paths.evidence,
      "oversized-http-collections.json",
    );
    const invalidCollection = path.join(
      this.#lease.paths.evidence,
      "invalid-utf8-http-collections.json",
    );
    await writeFile(collectionFile, JSON.stringify(incoming), { flag: "wx" });
    await writeFile(oversizedCollection, "x".repeat(2 * 1024 * 1024 + 1), { flag: "wx" });
    await writeFile(invalidCollection, Buffer.from([0xc3, 0x28]), { flag: "wx" });
    const collectionFileInput = browser.$('[aria-label="Load HTTP collections file"]');
    const collectionFileError = browser.$('[aria-label="HTTP collection file error"]');
    await collectionFileInput.setValue(oversizedCollection);
    await browser.waitUntil(
      async () =>
        (await collectionFileError.isExisting()) &&
        (await collectionFileError.getText()).includes("2 MiB"),
      { timeout: 5_000 },
    );
    assert.equal(await collectionText.getValue(), exported);
    this.#proof.oversizedCollectionFileRefused = true;
    await collectionFileInput.setValue(invalidCollection);
    await browser.waitUntil(
      async () =>
        (await collectionFileError.isExisting()) &&
        (await collectionFileError.getText()).includes("UTF-8"),
      { timeout: 5_000 },
    );
    assert.equal(await collectionText.getValue(), exported);
    this.#proof.invalidUtf8CollectionFileRefused = true;
    await collectionFileInput.setValue(collectionFile);
    await browser.waitUntil(
      async () => (await collectionText.getValue()) === JSON.stringify(incoming),
      { timeout: 5_000 },
    );
    assert.equal(await browser.$("button=Import reviewed collections").isEnabled(), false);
    assert.equal(await readFile(storedPath, "utf8"), stored);
    assert.equal(
      this.#requestCount,
      0,
      "loading a collection file must not persist or send anything",
    );
    this.#proof.collectionFileLoadedForReview = true;
    await browser.$("button=Review collection import").click();
    const importReview = browser.$('[aria-label="HTTP collection import review"]');
    await importReview.waitForDisplayed({ timeout: 5_000 });
    assert.match(await importReview.getText(), /1 new requests; 1 new environments/);
    assert.match(
      await importReview.getText(),
      /1 matching requests and 1 matching environments will be kept/,
    );
    assert.equal(
      await readFile(storedPath, "utf8"),
      stored,
      "review must not save collection data",
    );
    assert.equal(this.#requestCount, 0);
    this.#proof.collectionImportReviewed = true;
    await browser.$("button=Import reviewed collections").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="HTTP client"]').getText()).includes(
          "HTTP collections imported.",
        ),
      { timeout: 5_000 },
    );
    const merged = JSON.parse(await readFile(storedPath, "utf8"));
    assert.equal(merged.requests.length, 2);
    assert.equal(merged.environments.length, 2);
    assert.equal(merged.requests[0].body, '{"name":"{{name}}"}');
    assert.equal(merged.environments[0].variables.name, "IDE");
    assert.equal(await browser.$('[aria-label="Request body"]').getValue(), '{"name":"{{name}}"}');
    assert.equal(await browser.$('[aria-label="HTTP environment"]').getValue(), "Local");
    assert.equal(this.#requestCount, 0, "export, review and import must not send traffic");
    this.#proof.collectionImportKeptMatchingEntries = true;
    stored = await readFile(storedPath, "utf8");
    const exportedPath = "http-collections-export.json";
    await browser.$("label=New collection export path").$("input").setValue(exportedPath);
    await browser.$("button=Export new collection file").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="HTTP client"]').getText()).includes(
          `HTTP collections exported to ${exportedPath}`,
        ),
      { timeout: 5_000 },
    );
    const exportedBytes = await readFile(
      path.join(this.#lease.paths.workspace, exportedPath),
      "utf8",
    );
    assert.deepEqual(JSON.parse(exportedBytes), JSON.parse(stored));
    assert.equal(
      (await lstat(path.join(this.#lease.paths.workspace, exportedPath))).mode & 0o077,
      0,
    );
    assert.equal(
      await snapshotWorkspace(this.#lease.paths.workspace, false, exportedPath),
      this.#workspaceSnapshot,
    );
    this.#proof.collectionFileExported = true;
    this.#workspaceSnapshot = await snapshotWorkspace(this.#lease.paths.workspace);
    withoutMarker = await snapshotWorkspace(this.#lease.paths.workspace, true);
    await browser.$("button=Export new collection file").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="HTTP collection transfer error"]').getText()).includes(
          "already exists",
        ),
      { timeout: 5_000 },
    );
    assert.equal(
      await readFile(path.join(this.#lease.paths.workspace, exportedPath), "utf8"),
      exportedBytes,
    );
    assert.equal(await readFile(storedPath, "utf8"), stored);
    assert.equal(this.#requestCount, 0);
    this.#proof.existingExportFileRefused = true;
    const exportDraftUrl = await browser.$('[aria-label="Request URL"]').getValue();
    const exportDraftBody = await browser.$('[aria-label="Request body"]').getValue();
    await browser.$("button=Export collections as…").click();
    await this.#application.chooseHttpCollectionExport(null);
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="HTTP client"]').getText()).includes(
          "Collection export cancelled. No file was created.",
        ),
      { timeout: 5000 },
    );
    assert.equal(await readFile(storedPath, "utf8"), stored);
    assert.equal(await snapshotWorkspace(this.#lease.paths.workspace), this.#workspaceSnapshot);
    assert.equal(this.#requestCount, 0);
    this.#proof.externalCollectionCancelVerified = true;
    const externalExport = path.join(
      this.#lease.runnerArtifactPath,
      "shared collections caffè.json",
    );
    await browser.$("button=Export collections as…").click();
    await this.#application.chooseHttpCollectionExport(externalExport);
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="HTTP client"]').getText()).includes(
          `HTTP collections exported to ${externalExport}`,
        ),
      { timeout: 5000 },
    );
    assert.equal(await readFile(externalExport, "utf8"), exportedBytes);
    assert.equal((await lstat(externalExport)).mode & 0o077, 0);
    assert.equal(await readFile(storedPath, "utf8"), stored);
    assert.equal(await snapshotWorkspace(this.#lease.paths.workspace), this.#workspaceSnapshot);
    assert.equal(await browser.$('[aria-label="Request URL"]').getValue(), exportDraftUrl);
    assert.equal(await browser.$('[aria-label="Request body"]').getValue(), exportDraftBody);
    assert.equal(this.#requestCount, 0);
    this.#proof.externalCollectionFileExported = true;
    await browser.$("button=Export collections as…").click();
    await this.#application.chooseHttpCollectionExport(externalExport, true);
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="HTTP collection transfer error"]').getText()).includes(
          "already exists",
        ),
      { timeout: 5000 },
    );
    assert.equal(await readFile(externalExport, "utf8"), exportedBytes);
    assert.equal(this.#requestCount, 0);
    this.#proof.externalCollectionFileRefused = true;

    assert.equal((await lstat(storedPath)).mode & 0o077, 0);
    assert.equal(await snapshotWorkspace(this.#lease.paths.workspace), this.#workspaceSnapshot);
    await this.#application.closeWindow();
    await this.#application.dispose();
    this.#application = new NativeDesktopApplication();
    await this.#application.launch();
    await this.#application.waitForFileExplorer();
    // Workspace registration refreshes only the marker's lifecycle timestamp on startup.
    const reopenedMarker = JSON.parse(await readFile(markerPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete originalMarker.updatedAt;
    delete reopenedMarker.updatedAt;
    assert.deepEqual(reopenedMarker, originalMarker);
    assert.equal(await snapshotWorkspace(this.#lease.paths.workspace, true), withoutMarker);
    this.#workspaceSnapshot = await snapshotWorkspace(this.#lease.paths.workspace);
    browser = this.#application.browser();
    await browser.$("button=HTTP Client").click();
    await browser.$("summary=Saved requests and environments").click();
    await browser.$("button=Reload collections").waitForEnabled({ timeout: 5_000 });
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Saved HTTP request"]').getText()).includes(
          "Local API / Greeting",
        ),
      { timeout: 5_000 },
    );
    assert.match(
      await browser.$('[aria-label="Saved HTTP request"]').getText(),
      /Imported greeting/,
    );
    assert.match(
      await browser.$('[aria-label="HTTP environment"]').getText(),
      /Imported environment/,
    );
    this.#proof.importedEntriesPersistedAfterRestart = true;
    await browser
      .$('[aria-label="Saved HTTP request"]')
      .selectByVisibleText("Local API / Greeting");
    assert.equal(await browser.$('[aria-label="Request URL"]').getValue(), "{{baseUrl}}/api/hello");
    assert.equal(await browser.$('[aria-label="Request body"]').getValue(), '{"name":"{{name}}"}');
    await browser.$('[aria-label="HTTP environment"]').selectByVisibleText("Local");
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="Resolved request URL"]').getText()).includes(this.#url!),
      { timeout: 5_000 },
    );
    assert.equal(
      this.#requestCount,
      0,
      "restart, selecting a saved request and selecting its environment must not send traffic",
    );
    await browser.$("button=Send").click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[aria-label="HTTP response"]').getText()).includes("201 Created"),
      { timeout: 10_000 },
    );
    assert.equal(this.#requestCount, 1);
    assert.equal(this.#captured?.path, "/api/hello");
    assert.equal(this.#captured?.method, "POST");
    assert.equal(this.#captured?.body, '{"name":"IDE"}');
    assert.equal(this.#captured?.variableHeader, "IDE");
    assert.equal(this.#captured?.contentType, "application/json");
    assert.equal(
      await readFile(storedPath, "utf8"),
      stored,
      "sending and receiving must not persist resolved values or response data",
    );
    this.#proof.savedRequestRestored = true;
    this.#proof.savedEnvironmentRestored = true;
    this.#proof.templatesPreserved = true;
    this.#proof.responsesNotStored = true;
    this.#proof.restartVerified = true;
    this.#proof.requestSentOnlyAfterClick = true;
    this.#proof.requestReachedLocalService = true;
    this.#proof.responsePresented = true;
  }

  async captureFailure(): Promise<void> {
    if (!this.#lease || !this.#application) return;
    try {
      await this.#application
        .browser()
        .saveScreenshot(
          path.join(this.#lease.runnerArtifactPath, "http-client-collections-failure.png"),
        );
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "http-client-collections-failure.html"),
        await this.#application.browser().$('[aria-label="HTTP client"]').getHTML(),
      );
    } catch {
      /* Keep the original assertion if the window already exited. */
    }
  }

  async closeNormally(): Promise<void> {
    assert.ok(this.#application);
    await this.#application.closeWindow();
    this.#proof.cleanExit = true;
    assert.ok(this.#lease && this.#workspaceSnapshot !== undefined);
    assert.equal(
      await snapshotWorkspace(this.#lease.paths.workspace),
      this.#workspaceSnapshot,
      "Only the explicitly exported collection file may change workspace files",
    );
    this.#proof.workspaceUnchanged = !this.#proof.collectionFileExported;
    this.#proof.workspacePreservedApartFromExport = this.#proof.collectionFileExported;
  }

  async dispose(): Promise<void> {
    let cleanupError: unknown;
    try {
      if (this.#application && !this.#proof.cleanExit) await this.#application.closeWindow();
    } catch (error) {
      cleanupError = error;
    }
    try {
      await this.#application?.dispose();
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      if (this.#server?.listening) {
        await new Promise<void>((resolve, reject) =>
          this.#server!.close((error) => (error ? reject(error) : resolve())),
        );
      }
      this.#proof.serviceClosed = true;
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
            this.#proof.authenticationVerified
              ? "http-authentication-native-evidence.json"
              : this.#proof.restartVerified
                ? "http-client-collections-native-evidence.json"
                : "http-client-native-evidence.json",
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
