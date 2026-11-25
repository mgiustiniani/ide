#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";

function documents(root) {
  const top = readdirSync(root)
    .filter((name) => /\.(md|adoc)$/.test(name))
    .map((name) => resolve(root, name));
  function walk(directory) {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? walk(path) : /\.(md|adoc)$/.test(entry.name) ? [path] : [];
    });
  }
  return [...top, ...walk(resolve(root, "docs"))];
}
function anchors(text) {
  return new Set(
    text
      .split("\n")
      .filter((line) => /^#{1,6} /.test(line))
      .map((line) =>
        line
          .replace(/^#+ /, "")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, "")
          .replace(/\s/g, "-"),
      ),
  );
}
export function validateDocumentation(root) {
  root = realpathSync(root);
  const failures = [];
  for (const file of documents(root)) {
    const text = readFileSync(file, "utf8");
    const name = relative(root, file);
    if (/\b[a-fA-F0-9]{40,64}\b/.test(text))
      failures.push(`${name}: redundant commit/checksum value in human documentation`);
    const links = [...text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)].map(
      (match) => match[1],
    );
    links.push(...[...text.matchAll(/\blink:([^\s[]+)\[/g)].map((match) => match[1]));
    for (const link of links) {
      if (/^https?:\/\//i.test(link)) {
        if (/\/commit\/[a-f0-9]+/i.test(link))
          failures.push(`${name}: individual commit link ${link}`);
        continue;
      }
      if (/^(?:[a-z]+:|\/|[A-Za-z]:\\)/i.test(link)) {
        failures.push(`${name}: non-repository document link ${link}`);
        continue;
      }
      const [path, fragment] = link.split("#");
      const target = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
      const location = relative(root, target);
      if (location.startsWith("..") || !existsSync(target)) {
        failures.push(`${name}: missing or outside-repository link ${link}`);
        continue;
      }
      if (relative(root, realpathSync(target)).startsWith("..")) {
        failures.push(`${name}: link resolves outside repository ${link}`);
        continue;
      }
      if (
        fragment &&
        extname(target) === ".md" &&
        !anchors(readFileSync(target, "utf8")).has(fragment)
      )
        failures.push(`${name}: missing heading ${link}`);
    }
  }
  const arc = resolve(root, "ARC42.md");
  if (existsSync(arc)) {
    const text = readFileSync(arc, "utf8");
    const chapter = text.split("## Section 9:")[1]?.split("## Section 10:")[0] ?? "";
    const adr = resolve(root, "ADR.md");
    if (existsSync(adr))
      for (const match of readFileSync(adr, "utf8").matchAll(/^## ADR (\d+)/gm)) {
        if (!chapter.includes(`[${match[1]}]`))
          failures.push(`ARC42.md: ADR ${match[1]} is not indexed in chapter 9`);
      }
  }
  return failures;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = validateDocumentation(resolve(process.argv[2] ?? "."));
  for (const failure of failures) console.error(failure);
  console.log(`Documentation policy: ${failures.length ? "FAIL" : "PASS"}`);
  process.exitCode = failures.length ? 1 : 0;
}
