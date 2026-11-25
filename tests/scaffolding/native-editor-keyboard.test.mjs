import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { textKeySequence } = await tsImport(
  "../story/support/native-editor-surface.ts",
  import.meta.url,
);

test("native editor typing releases repeated letters instead of holding an entire word", () => {
  const actions = textKeySequence("class");
  assert.equal(actions.length, 10);
  for (let index = 0; index < actions.length; index += 2) {
    assert.equal(actions[index].type, "keyDown");
    assert.deepEqual(actions[index + 1], { type: "keyUp", value: actions[index].value });
  }
  assert.deepEqual(actions.slice(-4), [
    { type: "keyDown", value: "s" },
    { type: "keyUp", value: "s" },
    { type: "keyDown", value: "s" },
    { type: "keyUp", value: "s" },
  ]);
});

test("native text typing preserves Unicode code points and literal punctuation", () => {
  assert.deepEqual(
    textKeySequence('é𝄞"')
      .filter(({ type }) => type === "keyDown")
      .map(({ value }) => value),
    ["é", "𝄞", '"'],
  );
  assert.deepEqual(textKeySequence(""), []);
});
