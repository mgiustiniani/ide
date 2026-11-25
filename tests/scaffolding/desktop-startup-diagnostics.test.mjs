import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
const source = await readFile("apps/desktop/public/startup-diagnostics.js", "utf8");
function fixture() {
  const listeners = new Map();
  const window = { addEventListener: (name, callback) => listeners.set(name, callback) };
  const document = { documentElement: { dataset: {} } };
  class HTMLScriptElement {
    src = "tauri://localhost/assets/index-fixture.js?token=unsafe";
  }
  class HTMLLinkElement {
    href = "tauri://localhost/assets/style-fixture.css?secret=unsafe";
  }
  runInNewContext(source, {
    window,
    document,
    URL,
    location: { href: "tauri://localhost/index.html" },
    HTMLScriptElement,
    HTMLLinkElement,
  });
  return { window, document, listeners, HTMLScriptElement };
}
test("early bootstrap observation classifies faults without retaining messages, paths, queries or rejection contents", () => {
  const { window, document, listeners, HTMLScriptElement } = fixture();
  assert.equal(document.documentElement.dataset.ideBootstrap, "document-started");
  listeners.get("error")({
    error: { name: "TypeError", message: "token=unsafe private source" },
    filename: "tauri://localhost/assets/index-fixture.js?token=unsafe",
  });
  listeners.get("error")({ target: new HTMLScriptElement() });
  listeners.get("unhandledrejection")({
    reason: { name: "ReferenceError", message: "password=unsafe" },
  });
  listeners.get("securitypolicyviolation")({ blockedURI: "private location" });
  const result = window.__IDE_STARTUP_OBSERVATION__;
  assert.equal(result.faults.length, 4);
  assert.equal(result.faults[0].errorClass, "TypeError");
  assert.equal(result.faults[0].asset, "index-fixture.js");
  assert.equal(result.faults[1].kind, "resource-load");
  assert.equal(result.faults[2].kind, "unhandled-rejection");
  assert.ok(!JSON.stringify(result).includes("unsafe"));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.faults));
  assert.throws(() => {
    window.__IDE_STARTUP_OBSERVATION__ = {};
  });
});
test("bootstrap fault history is capped and snapshots cannot add mutable entries", () => {
  const { window, listeners } = fixture();
  for (let i = 0; i < 15; i++)
    listeners.get("unhandledrejection")({ reason: { name: "secret=unsafe" } });
  const before = window.__IDE_STARTUP_OBSERVATION__;
  assert.equal(before.faults.length, 8);
  assert.equal(before.dropped, 7);
  assert.equal(before.faults[0].errorClass, null);
  assert.throws(() => before.faults.push({ kind: "fabricated-ready" }));
  assert.throws(() => {
    before.faults[0].kind = "fabricated-ready";
  });
  assert.equal(window.__IDE_STARTUP_OBSERVATION__.faults[0].kind, "unhandled-rejection");
});
test("desktop document installs the same-origin classic observer before its application module", async () => {
  const html = await readFile("apps/desktop/index.html", "utf8");
  const observer = html.indexOf('<script src="/startup-diagnostics.js"></script>');
  const application = html.indexOf('<script type="module" src="/src/main.tsx"></script>');
  assert.ok(observer >= 0 && observer < application);
});
