import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { NativeEditorCheckpointJournal } = await tsImport(
  "../story/support/native-editor-checkpoint-journal.ts",
  import.meta.url,
);

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "native-journal-evidence-"));
  try {
    const workspace = path.join(root, "workspace"),
      ideHome = path.join(root, "private");
    await mkdir(workspace);
    await mkdir(ideHome);
    const workspaceKey = createHash("sha256").update(workspace).digest("hex");
    const directory = path.join(ideHome, "editor-recovery", workspaceKey);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "journal.json");
    const entry = {
      id: "a".repeat(32),
      owner: "b".repeat(32),
      filePath: "proof.txt",
      content: "Checkpoint café",
      kind: "draft",
    };
    const data = { version: 1, workspaceKey, entries: [entry] };
    await writeFile(file, JSON.stringify(data), { mode: 0o600 });
    await run({
      reader: new NativeEditorCheckpointJournal({ paths: { workspace, ideHome } }),
      file,
      data,
      entry,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("journal evidence inspection reads UTF-8 entries without mutating private storage", async () => {
  await fixture(async ({ reader, file, entry }) => {
    const before = await readFile(file);
    assert.deepEqual(await reader.entries(), [entry]);
    assert.deepEqual(await readFile(file), before);
  });
});

test("journal evidence rejects entries bound to another workspace", async () => {
  await fixture(async ({ reader, file, data }) => {
    await writeFile(file, JSON.stringify({ ...data, workspaceKey: "f".repeat(64) }));
    await assert.rejects(reader.entries());
  });
});

test("journal evidence rejects oversized fixtures before parsing and malformed issued identities", async () => {
  await fixture(async ({ reader, file, data }) => {
    await writeFile(file, Buffer.alloc(128 * 1024 + 1));
    await assert.rejects(reader.entries(), /fixture journal exceeded its bound/);
    await writeFile(
      file,
      JSON.stringify({ ...data, entries: [{ ...data.entries[0], id: "unissued" }] }),
    );
    await assert.rejects(reader.entries());
  });
});
