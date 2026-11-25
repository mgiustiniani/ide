import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

const REQUIREMENT = "REQ-IDE-JAVA-LANGUAGE-001";
const execFileAsync = promisify(execFile);
type JavaPreviewFixture = {
  readonly release: 26 | 27;
  readonly name: string;
  readonly jdkVariable: "IDE_JAVA_26_HOME" | "IDE_JAVA_27_HOME";
  readonly maven: boolean;
  readonly sourcePath: string;
  readonly source: string;
  readonly brokenPath: string;
  readonly brokenSource: string;
  readonly hover: RegExp;
  readonly classpath?: string;
  readonly compilerSettings?: string;
};

const java27Preview: JavaPreviewFixture = {
  release: 27,
  name: "java27-preview-import",
  jdkVariable: "IDE_JAVA_27_HOME",
  maven: true,
  sourcePath: "src/main/java/example/PreviewFixture.java",
  source: `package example;

public final class PreviewFixture {
  static int classify(int value) {
    return switch (value) {
      case int matched -> matched;
    };
  }

  static boolean positive(Object value) {
    return value instanceof int candidate && candidate > 0;
  }
}
`,
  brokenPath: "src/main/java/example/Broken.java",
  brokenSource: `package example;

final class Broken {
  private UnknownJava27FixtureType value;
}
`,
  hover: /matched[\s\S]*int|int[\s\S]*matched/u,
};

const java26Preview: JavaPreviewFixture = {
  release: 26,
  name: "java26-preview-project",
  jdkVariable: "IDE_JAVA_26_HOME",
  maven: false,
  sourcePath: "src/main/java/example/PrimitivePatternFixture.java",
  source: `package example;

public final class PrimitivePatternFixture {
  static int classify(Object value) {
    if (value instanceof int matched) return matched;
    return switch (value) {
      case int matched -> matched;
      default -> -1;
    };
  }
}
`,
  brokenPath: "src/main/java/example/Broken.java",
  brokenSource: `package example;

final class Broken {
  private UnknownJava26FixtureType value;
}
`,
  hover: /matched[\s\S]*int|int[\s\S]*matched/u,
  classpath: `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
  <classpathentry kind="src" path="src/main/java"/>
  <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>
  <classpathentry kind="output" path="bin"/>
</classpath>
`,
  compilerSettings: `eclipse.preferences.version=1
org.eclipse.jdt.core.compiler.source=26
org.eclipse.jdt.core.compiler.compliance=26
org.eclipse.jdt.core.compiler.codegen.targetPlatform=26
org.eclipse.jdt.core.compiler.problem.enablePreviewFeatures=enabled
org.eclipse.jdt.core.compiler.problem.reportPreviewFeatures=ignore
`,
};

function project(name: string, maven: boolean) {
  const mavenProject = maven
    ? "<buildCommand><name>org.eclipse.m2e.core.maven2Builder</name><arguments></arguments></buildCommand>"
    : "";
  const mavenNature = maven ? "<nature>org.eclipse.m2e.core.maven2Nature</nature>" : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
  <name>${name}</name>
  <comment></comment>
  <projects></projects>
  <buildSpec>
    <buildCommand><name>org.eclipse.jdt.core.javabuilder</name><arguments></arguments></buildCommand>
    ${mavenProject}
  </buildSpec>
  <natures>
    <nature>org.eclipse.jdt.core.javanature</nature>
    ${mavenNature}
  </natures>
</projectDescription>
`;
}

function pom(release: 26 | 27, name: string) {
  return `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example</groupId><artifactId>${name}</artifactId><version>1.0.0</version>
  <properties><maven.compiler.release>${release}</maven.compiler.release></properties>
  <build><plugins><plugin>
    <groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version>
    <configuration><release>${release}</release><enablePreview>true</enablePreview></configuration>
  </plugin></plugins></build>
</project>
`;
}

class NativeJavaPreviewImportSession {
  constructor(private readonly fixture: JavaPreviewFixture) {}

  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #jdtls = "";
  #jdk = "";
  #mavenRepository = "";
  #failure: unknown;
  #originalEnvironment = new Map<string, string | undefined>();
  #proof = {
    requirement: REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    java26ProjectOpened: false,
    mavenPreviewProjectOpened: false,
    unrelatedDiagnosticPresented: false,
    previewDiagnosticUnavailabilityPresented: false,
    diagnosticUnavailableReason: null as string | null,
    configurationChangeRecoveredDiagnostics: false,
    configurationChangePreservedUnsavedJava: false,
    java27PatternHoverPresented: false,
    java27InstanceofPatternHoverPresented: false,
    java26PrimitivePatternHoverPresented: false,
    previewSourceHasNoErrors: false,
    fixtureSourcesUnchanged: false,
    cleanExit: false,
  };

  async prepare() {
    const configuredJdtls = process.env.IDE_JDTLS_HOME;
    const configuredJdk = process.env[this.fixture.jdkVariable];
    assert.ok(
      configuredJdtls && path.isAbsolute(configuredJdtls),
      "Set IDE_JDTLS_HOME to the installed Eclipse JDT LS directory.",
    );
    assert.ok(
      configuredJdk && path.isAbsolute(configuredJdk),
      `Set ${this.fixture.jdkVariable} to a full JDK ${this.fixture.release} directory.`,
    );
    this.#jdtls = await realpath(configuredJdtls);
    this.#jdk = await realpath(configuredJdk);
    if (this.fixture.maven) {
      const repository = process.env.IDE_JAVA_CONTEXT_MAVEN_REPOSITORY;
      assert.ok(
        repository && path.isAbsolute(repository),
        "Set IDE_JAVA_CONTEXT_MAVEN_REPOSITORY to a populated Maven cache for native Maven import.",
      );
      this.#mavenRepository = await realpath(repository);
    }
    await Promise.all([
      access(path.join(this.#jdtls, "config_linux", "config.ini")),
      access(path.join(this.#jdk, "bin", "java"), constants.X_OK),
      access(path.join(this.#jdk, "bin", "javac"), constants.X_OK),
    ]);
    const { stderr: version } = await execFileAsync(path.join(this.#jdk, "bin", "java"), [
      "-version",
    ]);
    assert.match(
      version,
      new RegExp(`\\b${this.fixture.release}(?:\\b|[.+-])`, "u"),
      `${this.fixture.jdkVariable} must point to JDK ${this.fixture.release}`,
    );

    this.#lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT);
    await Promise.all(
      [
        path.dirname(this.file(this.fixture.sourcePath)),
        ...(this.fixture.compilerSettings ? [this.file(".settings")] : []),
      ].map((directory) => mkdir(directory, { recursive: true })),
    );
    const files = [
      writeFile(this.file(".project"), project(this.fixture.name, this.fixture.maven), {
        flag: "wx",
      }),
      writeFile(this.file(this.fixture.sourcePath), this.fixture.source, { flag: "wx" }),
      writeFile(this.file(this.fixture.brokenPath), this.fixture.brokenSource, { flag: "wx" }),
    ];
    if (this.fixture.maven)
      files.push(
        writeFile(this.file("pom.xml"), pom(this.fixture.release, this.fixture.name), {
          flag: "wx",
        }),
      );
    if (this.fixture.classpath)
      files.push(writeFile(this.file(".classpath"), this.fixture.classpath, { flag: "wx" }));
    if (this.fixture.compilerSettings)
      files.push(
        writeFile(
          this.file(".settings/org.eclipse.jdt.core.prefs"),
          this.fixture.compilerSettings,
          { flag: "wx" },
        ),
      );
    await Promise.all(files);
    for (const variable of ["IDE_JDTLS_HOME", "IDE_JAVA_HOME"])
      this.#originalEnvironment.set(variable, process.env[variable]);
    process.env.IDE_JDTLS_HOME = this.#jdtls;
    process.env.IDE_JAVA_HOME = this.#jdk;
    await this.#lease.assertConfiguredPathsConfined();
  }

  async startAndInspectPreview(expectUnavailable = false) {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.browser().$('input[placeholder="Full JDK directory"]').setValue(this.#jdk);
    if (this.fixture.maven) {
      const mavenSettings = this.browser().$("//details[summary='Maven settings']");
      if ((await mavenSettings.getAttribute("open")) === null)
        await mavenSettings.$("summary").click();
      await this.browser()
        .$('input[placeholder="Engine default local repository"]')
        .setValue(this.#mavenRepository);
    }
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const actions = this.browser().$(
      '[role="group"][aria-label="Eclipse JDT LS lifecycle actions"]',
    );
    await actions.$("button=Start").waitForEnabled({ timeout: 10_000 });
    await actions.$("button=Start").click();
    const status = this.browser().$('[aria-label="Eclipse JDT LS lifecycle status"]');
    await this.browser().waitUntil(
      async () =>
        ["ready", "indexing", "degraded"].includes((await status.getText()).toLowerCase()),
      {
        timeout: 60_000,
        interval: 250,
        timeoutMsg: `JDT LS did not initialize for Java ${this.fixture.release}`,
      },
    );
    const languagePanel = this.browser().$('[aria-label="Java intelligence"]');
    assert.ok((await languagePanel.getText()).includes(`Project JDK: ${this.#jdk}`));

    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    for (const directory of ["src", "src/main", "src/main/java", "src/main/java/example"]) {
      const item = this.browser().$(`[role="treeitem"][data-path="${directory}"]`);
      await item.waitForDisplayed({ timeout: 10_000 });
      if ((await item.getAttribute("aria-expanded")) === "false") await item.click();
    }
    await this.surface().open(this.fixture.brokenPath, this.fixture.brokenSource);
    if (expectUnavailable) {
      await this.browser().$('[role="tab"][aria-label^="Problems"]').click();
      const notice = this.browser().$('[aria-label="Problems"] [role="alert"]');
      await this.browser().waitUntil(async () =>
        /Java 26 preview features[\s\S]*Java 27 only/u.test(await notice.getText().catch(() => "")),
        { timeout: 30_000, interval: 100, timeoutMsg: "Problems did not explain the incompatible Java preview compiler" },
      );
      assert.ok((await this.browser().$('[role="tab"][aria-label^="Problems"]').getText()).includes("incomplete"));
      assert.ok(!(await this.browser().$('[aria-label="Problems"]').getText()).includes("No problems detected"));
      assert.equal(await readFile(this.file(this.fixture.brokenPath), "utf8"), this.fixture.brokenSource);
      this.#proof.previewDiagnosticUnavailabilityPresented = true;
      this.#proof.diagnosticUnavailableReason = await notice.getText();
      this.#proof.fixtureSourcesUnchanged = true;
      return;
    }
    if (this.fixture.maven || this.fixture.release === 26) {
      const problems = this.browser().$('[role="tab"][aria-label^="Problems"]');
      await this.browser().waitUntil(
        async () => {
          const label = await problems.getAttribute("aria-label");
          return label !== null && !/\b0 problems?\b/u.test(label);
        },
        {
          timeout: 60_000,
          interval: 250,
          timeoutMsg: "The preview project did not publish the unrelated unresolved-type diagnostic",
        },
      );
      await problems.click();
      const fixtureDiagnostic = this.browser().$(
        '[role="treeitem"][aria-label*="cannot be resolved"][aria-label*="Broken.java"]',
      );
      await fixtureDiagnostic.waitForDisplayed({ timeout: 10_000 });
      if (this.fixture.maven) this.#proof.mavenPreviewProjectOpened = true;
      this.#proof.unrelatedDiagnosticPresented = true;
    }
    if (this.fixture.release === 26) this.#proof.java26ProjectOpened = true;

    await this.surface().open(this.fixture.sourcePath, this.fixture.source);
    await this.surface().focus(this.fixture.sourcePath);
    await this.browser().keys(["Control", "f"]);
    const find = this.browser().$('[aria-label="Find"]');
    await find.waitForDisplayed({ timeout: 5_000 });
    await find.waitForClickable({ timeout: 5_000 });
    await find.setValue("matched");
    assert.equal(await find.getValue(), "matched");
    await this.browser().keys(["Escape"]);
    await this.browser().keys(["Control", "k"]);
    await this.browser().keys(["Control", "i"]);
    await this.waitForHover(this.fixture.hover);
    if (this.fixture.release === 27) this.#proof.java27PatternHoverPresented = true;
    else this.#proof.java26PrimitivePatternHoverPresented = true;
    if (this.fixture.release === 27) {
      await this.browser().keys(["Control", "f"]);
      const findCandidate = this.browser().$('[aria-label="Find"]');
      await findCandidate.waitForDisplayed({ timeout: 5_000 });
      await findCandidate.waitForClickable({ timeout: 5_000 });
      await findCandidate.setValue("candidate");
      assert.equal(await findCandidate.getValue(), "candidate");
      await this.browser().keys(["Escape"]);
      await this.browser().keys(["Control", "k"]);
      await this.browser().keys(["Control", "i"]);
      await this.waitForHover(/candidate[\s\S]*int|int[\s\S]*candidate/u);
      this.#proof.java27InstanceofPatternHoverPresented = true;
      await this.browser().keys(["Escape"]);
      await this.surface().focus(this.fixture.sourcePath);
    }
    const errorMarkers = await this.browser().execute((file: string) => {
      const input = Array.from(
        document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
      ).find((element) => element.getAttribute("aria-label") === `Code editor for ${file}`);
      const host = input?.closest(".monaco-code-editor-host");
      return host?.querySelectorAll(".squiggly-error").length ?? 0;
    }, this.fixture.sourcePath);
    assert.equal(
      errorMarkers,
      0,
      `Java ${this.fixture.release} preview source must not have editor error markers`,
    );
    assert.equal(await readFile(this.file(this.fixture.sourcePath), "utf8"), this.fixture.source);
    assert.equal(
      await readFile(this.file(this.fixture.brokenPath), "utf8"),
      this.fixture.brokenSource,
    );
    this.#proof.previewSourceHasNoErrors = true;
    this.#proof.fixtureSourcesUnchanged = true;
  }

  async saveCompatibleOptionsAndRefresh() {
    assert.equal(this.fixture.release, 26);
    assert.ok(this.#proof.previewDiagnosticUnavailabilityPresented);
    const generation = async () => this.browser().executeAsync((done) => {
      const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<{generation:number}> } }).__TAURI_INTERNALS__.invoke;
      void invoke("get_java_language_service_status").then((status) => done(status.generation), () => done(-1));
    });
    const initialGeneration = await generation();
    assert.ok(Number(initialGeneration) > 0);
    const draft = this.fixture.brokenSource + "// unsaved Java draft survives configuration refresh\n";
    await this.surface().replace(this.fixture.brokenPath, draft);
    const metadata = ".settings/org.eclipse.jdt.core.prefs";
    const original = this.fixture.compilerSettings!;
    const compatible = original.replace("enablePreviewFeatures=enabled", "enablePreviewFeatures=disabled");
    assert.notEqual(compatible, original);
    const folder = this.browser().$('[role="treeitem"][data-path=".settings"]');
    if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
    await this.surface().open(metadata, original);
    await this.surface().replace(metadata, compatible);
    await this.surface().save(metadata);
    assert.equal(await readFile(this.file(metadata), "utf8"), compatible);
    await this.surface().tab(this.fixture.brokenPath).click();
    await this.surface().assertBuffer(this.fixture.brokenPath, draft);
    await this.surface().assertDirty(this.fixture.brokenPath, true);
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    await this.browser().$('[aria-label="Java intelligence"]').$("button=Refresh").click();
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.browser().$('[role="tab"][aria-label^="Problems"]').click();
    await this.browser().waitUntil(async () =>
      (await this.browser().$('[aria-label="Problems list"]').getText().catch(() => "")).includes("UnknownJava26FixtureType cannot be resolved"),
      { timeout: 30_000, interval: 100, timeoutMsg: "The saved compiler configuration did not restore real diagnostics without restarting JDT LS" },
    );
    assert.equal(await generation(), initialGeneration);
    assert.ok(!(await this.browser().$('[role="tab"][aria-label^="Problems"]').getText()).includes("incomplete"));
    await this.surface().assertBuffer(this.fixture.brokenPath, draft);
    await this.surface().assertDirty(this.fixture.brokenPath, true);
    assert.equal(await readFile(this.file(this.fixture.brokenPath), "utf8"), this.fixture.brokenSource);
    this.#proof.configurationChangePreservedUnsavedJava = true;
    await this.surface().replace(this.fixture.brokenPath, this.fixture.brokenSource, false);
    await this.surface().tab(metadata).click();
    await this.surface().replace(metadata, original);
    await this.surface().save(metadata);
    assert.equal(await readFile(this.file(metadata), "utf8"), original);
    this.#proof.configurationChangeRecoveredDiagnostics = true;
  }

  async restoreAndClose() {
    await this.browser().keys(["Escape"]);
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const status = this.browser().$('[aria-label="Eclipse JDT LS lifecycle status"]');
    if ((await status.getText()).toLowerCase() !== "stopped") {
      const actions = this.browser().$(
        '[role="group"][aria-label="Eclipse JDT LS lifecycle actions"]',
      );
      await actions.$("button=Stop").click();
      await this.browser().waitUntil(
        async () => (await status.getText()).toLowerCase() === "stopped",
        { timeout: 20_000, interval: 100, timeoutMsg: "JDT LS did not stop after preview import" },
      );
    }
    const projectMetadata = await readFile(this.file(".project"), "utf8");
    assert.match(projectMetadata, new RegExp(`<name>${this.fixture.name}</name>`, "u"));
    assert.match(projectMetadata, /org\.eclipse\.jdt\.core\.javanature/u);
    if (this.fixture.maven) {
      assert.match(projectMetadata, /org\.eclipse\.m2e\.core\.maven2Nature/u);
      assert.equal(
        await readFile(this.file("pom.xml"), "utf8"),
        pom(this.fixture.release, this.fixture.name),
      );
    } else {
      assert.doesNotMatch(projectMetadata, /org\.eclipse\.m2e\.core\.maven2Nature/u);
      assert.equal(await readFile(this.file(".classpath"), "utf8"), this.fixture.classpath);
      assert.equal(
        await readFile(this.file(".settings/org.eclipse.jdt.core.prefs"), "utf8"),
        this.fixture.compilerSettings,
      );
    }
    assert.equal(await readFile(this.file(this.fixture.sourcePath), "utf8"), this.fixture.source);
    assert.equal(
      await readFile(this.file(this.fixture.brokenPath), "utf8"),
      this.fixture.brokenSource,
    );
    await this.app().closeNativeWindow();
    await this.app().assertExited();
    this.#proof.cleanExit = true;
  }

  evidence() {
    return { ...this.#proof, jdtls: this.#jdtls, jdk: this.#jdk, failure: this.#failure };
  }

  setFailure(error: unknown) {
    this.#failure = error instanceof Error ? error.message : String(error);
  }

  async captureFailure() {
    if (!this.#app || !this.#lease) return;
    try {
      const observation = await this.browser().execute(() => {
        const problems = document.querySelector<HTMLElement>(
          '[role="tab"][aria-label^="Problems"]',
        );
        return {
          problems: problems?.getAttribute("aria-label") ?? problems?.innerText ?? null,
          text: document.body.innerText.slice(-6_000),
        };
      });
      await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
      const servicePanel = this.browser().$('[aria-label="Java intelligence"]');
      await servicePanel.waitForDisplayed({ timeout: 3_000 });
      const javaIntelligence = (await servicePanel.getText()).slice(0, 4_000);
      const lifecycle = await this.browser()
        .$('[aria-label="Eclipse JDT LS lifecycle status"]')
        .getText();
      this.#failure = {
        message: this.#failure,
        observation: { ...observation, javaIntelligence, lifecycle },
      };
      await this.browser().saveScreenshot(
        path.join(this.#lease.runnerArtifactPath, `${this.fixture.name}-failure.png`),
      );
    } catch {
      /* Keep the original scenario failure. */
    }
  }

  async dispose() {
    const errors: unknown[] = [];
    try {
      await this.#app?.dispose();
    } catch (error) {
      errors.push(error);
    }
    for (const [variable, value] of this.#originalEnvironment) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
    try {
      await this.#lease?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (this.#lease) {
        await writeFile(
          path.join(this.#lease.runnerArtifactPath, `${this.fixture.name}-native-evidence.json`),
          JSON.stringify(
            {
              ...this.#proof,
              jdtls: this.#jdtls,
              jdk: this.#jdk,
              application: this.#app?.evidence(),
              environment: this.#lease.evidence(),
              failure: this.#failure,
            },
            null,
            2,
          ),
        );
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, "native Java 27 preview import cleanup failed");
  }

  private async waitForHover(expected: RegExp) {
    await this.browser().waitUntil(
      async () =>
        expected.test(
          await this.browser().execute(() => {
            const roots: Array<Document | ShadowRoot> = [document];
            while (roots.length) {
              const root = roots.pop()!;
              for (const widget of root.querySelectorAll<HTMLElement>(".monaco-hover"))
                if (widget.getClientRects().length)
                  return widget.innerText ?? widget.textContent ?? "";
              for (const element of root.querySelectorAll<HTMLElement>("*"))
                if (element.shadowRoot) roots.push(element.shadowRoot);
            }
            return "";
          }),
        ),
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: `JDT LS did not resolve the Java ${this.fixture.release} preview pattern variable`,
      },
    );
  }

  private browser() {
    assert.ok(this.#app);
    return this.#app.browser();
  }

  private app() {
    assert.ok(this.#app);
    return this.#app;
  }

  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }

  private file(relative: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, relative);
  }
}

export class NativeJava27PreviewImportSession extends NativeJavaPreviewImportSession {
  constructor() {
    super(java27Preview);
  }
}

export class NativeJava26PreviewImportSession extends NativeJavaPreviewImportSession {
  constructor() {
    super(java26Preview);
  }
}
