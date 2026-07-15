import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readManifest(relativePath) {
  return JSON.parse(await readFile(path.join(workspaceRoot, relativePath), "utf8"));
}

async function workspaceManifestPaths() {
  const paths = ["package.json"];
  for (const root of ["apps", "packages"]) {
    for (const entry of await readdir(path.join(workspaceRoot, root), { withFileTypes: true })) {
      if (entry.isDirectory()) paths.push(path.join(root, entry.name, "package.json"));
    }
  }
  return paths.sort();
}

function e2eScripts(manifest) {
  return Object.entries(manifest.scripts ?? {}).filter(([name]) => /^test:e2e(?::|$)/.test(name));
}

test("E2E commands route only to implemented browser and native profiles", async () => {
  const root = await readManifest("package.json");

  assert.equal(
    root.scripts["test:e2e:web"],
    "node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile implementedWeb",
  );
  assert.equal(
    root.scripts["test:e2e:desktop:native"],
    "node scripts/run-native-desktop-story.mjs --profile implementedDesktopTauriWebdriver",
  );
  assert.equal(root.scripts["test:e2e"], "pnpm test:e2e:web && pnpm test:e2e:desktop:native");
  assert.doesNotMatch(root.scripts["test:e2e"], /tauri-harness/i);

  for (const manifestPath of await workspaceManifestPaths()) {
    const manifest = await readManifest(manifestPath);
    for (const [name, command] of e2eScripts(manifest)) {
      assert.doesNotMatch(
        command,
        /\b(?:vitest|jsdom|passWithNoTests)\b/i,
        `${manifestPath} ${name} must not use a unit-test or zero-test route`,
      );
      assert.doesNotMatch(
        command,
        /(?:^|[\s"'=])(?:\/(?:home|Users|workspace)\/|[A-Za-z]:[\\/])/,
        `${manifestPath} ${name} must not contain a hard-coded workspace path`,
      );
    }
  }
});

test("the obsolete web Vitest E2E route stays removed", async () => {
  const web = await readManifest("apps/web/package.json");
  assert.equal(web.scripts?.["test:e2e"], undefined);
  await assert.rejects(access(path.join(workspaceRoot, "apps/web/vitest.e2e.config.ts")), {
    code: "ENOENT",
  });
});

test("the V8 coverage provider remains exact and development-only", async () => {
  const root = await readManifest("package.json");
  assert.equal(root.devDependencies?.["@vitest/coverage-v8"], "3.2.7");

  for (const manifestPath of await workspaceManifestPaths()) {
    const manifest = await readManifest(manifestPath);
    assert.equal(
      manifest.dependencies?.["@vitest/coverage-v8"],
      undefined,
      `${manifestPath} must not expose the coverage provider as a runtime dependency`,
    );
  }
});
