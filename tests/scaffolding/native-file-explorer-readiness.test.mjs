import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { nativeFileExplorerDisplayed } = await tsImport(
  "../story/support/native-file-explorer-readiness.ts", import.meta.url,
);
const stale = () => Object.assign(new Error("The node was replaced"), { name: "stale element reference" });

test("readiness reacquires the replaced tree instead of retaining a stale element", async () => {
  let queries = 0;
  const browser = { $: async (selector) => {
    assert.equal(selector, '[role="tree"][aria-label="File Explorer"]');
    queries++;
    if (queries === 1) throw stale();
    if (queries === 2) return { isDisplayed: async () => { throw stale(); } };
    return { isDisplayed: async () => true };
  } };
  assert.equal(await nativeFileExplorerDisplayed(browser), false);
  assert.equal(await nativeFileExplorerDisplayed(browser), false);
  assert.equal(await nativeFileExplorerDisplayed(browser), true);
  assert.equal(queries, 3);
});
test("a missing or hidden tree does not imply readiness", async () => {
  assert.equal(await nativeFileExplorerDisplayed({ $: async () => ({ isDisplayed: async () => false }) }), false);
});
test("an explorer frame is insufficient when a particular project row is required", async () => {
  const row = '[role="treeitem"][data-path="gradle"]';
  const tree = '[role="tree"][aria-label="File Explorer"]';
  let rowVisible = false;
  const browser = { $: async (selector) => ({
    isDisplayed: async () => selector === tree || (selector === `${tree} ${row}` && rowVisible),
  }) };
  assert.equal(await nativeFileExplorerDisplayed(browser), true);
  assert.equal(await nativeFileExplorerDisplayed(browser, row), false);
  rowVisible = true;
  assert.equal(await nativeFileExplorerDisplayed(browser, row), true);
});
test("WebDriver stale-reference messages are contained when their name is generic", async () => {
  assert.equal(await nativeFileExplorerDisplayed({ $: async () => {
    throw new Error("stale element reference: WebDriverError: Stale element found");
  } }), false);
});
test("session, selector and transport failures are propagated rather than called readiness", async () => {
  for (const message of ["invalid session id", "invalid selector", "connection refused"]) {
    const failure = new Error(message);
    await assert.rejects(nativeFileExplorerDisplayed({ $: async () => { throw failure; } }), (error) => error === failure);
  }
});
