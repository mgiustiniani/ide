import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReadOnlyGitDiffSource } from "./workspace-root";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ide-node-git-review-")); roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "--quiet"); git("config", "user.name", "IDE Fixture"); git("config", "user.email", "fixture@example.invalid"); git("config", "commit.gpgsign", "false"); git("config", "core.hooksPath", "/dev/null");
  const file = (name: string, content = "class Before {}\n") => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), content); };
  const commit = (...names: string[]) => { git("--literal-pathspecs", "add", "--", ...names); git("commit", "--quiet", "-m", "Fixture baseline"); };
  return { root, git, file, commit, source: createReadOnlyGitDiffSource(root) };
}
describe("read-only Git against real private repositories", () => {
  it("retains Unicode and literal arrows without quoting or trimming paths", () => {
    const f = fixture(); const names = ["caffè name.java", "arrow -> name.java", " leading.java ", "line\nbreak.java"];
    for (const name of names) f.file(name); f.commit(...names); for (const name of names) f.file(name, "class After {}\n");
    expect([...f.source.listModifiedFiles()].sort()).toEqual([...names].sort());
    for (const name of names) expect(f.source.produceDiff(name).kind).toBe("ok");
  });
  it("limits a literal magic-looking filename to its own diff", () => {
    const f = fixture(); const name = ":(glob)*.java";
    f.file(name); f.file("Sibling.java"); f.commit(name, "Sibling.java");
    f.file(name, "class Selected {}\n"); f.file("Sibling.java", "class Unrelated {}\n");
    const result = f.source.produceDiff(name); expect(result.kind).toBe("ok"); expect(JSON.stringify(result)).not.toContain("Unrelated");
  });
  it("maps a nested workspace to only its relative paths", () => {
    const f = fixture(); f.file("Top.java"); f.file("module/Main.java"); f.commit("Top.java", "module/Main.java");
    f.file("Top.java", "class After {}\n"); f.file("module/Main.java", "class After {}\n");
    const source = createReadOnlyGitDiffSource(path.join(f.root, "module"));
    expect(source.listModifiedFiles()).toEqual(["Main.java"]); expect(source.produceDiff("Main.java").kind).toBe("ok"); expect(source.produceDiff("../Top.java").kind).toBe("unavailable");
  });
  it("reports non-repositories instead of claiming an empty changes list", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ide-no-git-")); roots.push(root);
    const source = createReadOnlyGitDiffSource(root); expect(() => source.listModifiedFiles()).toThrow(); expect(source.produceDiff("Main.java").kind).toBe("unavailable");
  });
  it("does not execute a configured monitor or refresh index bytes", () => {
    const f = fixture(); f.file("Main.java"); f.commit("Main.java");
    const index = readFileSync(path.join(f.root, ".git/index")); const monitor = path.join(f.root, "monitor.sh"); writeFileSync(monitor, "#!/bin/sh\nprintf ran > monitor-ran\n"); chmodSync(monitor, 0o700);
    f.git("config", "core.fsmonitor", monitor); utimesSync(path.join(f.root, "Main.java"), new Date(1000), new Date(1000));
    f.source.listModifiedFiles(); expect(existsSync(path.join(f.root, "monitor-ran"))).toBe(false); expect(readFileSync(path.join(f.root, ".git/index"))).toEqual(index);
  });
  it("does not execute a configured text converter", () => {
    const f = fixture(); f.file("Main.java"); f.file(".gitattributes", "*.java diff=fixture\n"); f.commit("Main.java", ".gitattributes");
    const converter = path.join(f.root, "converter.sh"); writeFileSync(converter, '#!/bin/sh\nprintf ran > converter-ran\ncat "$1"\n'); chmodSync(converter, 0o700); f.git("config", "diff.fixture.textconv", converter);
    f.file("Main.java", "class After {}\n"); expect(f.source.produceDiff("Main.java").kind).toBe("ok"); expect(existsSync(path.join(f.root, "converter-ran"))).toBe(false);
  });
});
