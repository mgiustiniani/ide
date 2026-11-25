/* global document, window, location, HTMLScriptElement, HTMLLinkElement */
/* Runs before the module graph. Retains only bounded categories and bundled asset names. */
(() => {
  const faults = [];
  let dropped = 0;
  const errorClasses = new Set([
    "Error",
    "TypeError",
    "ReferenceError",
    "SyntaxError",
    "RangeError",
    "EvalError",
    "URIError",
  ]);
  const assetName = (value) => {
    if (!value) return null;
    try {
      const name = new URL(value, location.href).pathname.split("/").pop();
      return /^[a-zA-Z0-9._-]+\.(js|css)$/.test(name) ? name.slice(0, 100) : null;
    } catch {
      return null;
    }
  };
  const record = (kind, name = null, asset = null) => {
    if (faults.length === 8) {
      dropped = Math.min(dropped + 1, 999);
      return;
    }
    faults.push(Object.freeze({ kind, errorClass: errorClasses.has(name) ? name : null, asset }));
  };
  document.documentElement.dataset.ideBootstrap = "document-started";
  Object.defineProperty(window, "__IDE_STARTUP_OBSERVATION__", {
    configurable: false,
    get: () => Object.freeze({ faults: Object.freeze([...faults]), dropped }),
  });
  window.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLScriptElement || event.target instanceof HTMLLinkElement)
        record("resource-load", null, assetName(event.target.src || event.target.href));
      else record("runtime", event.error?.name, assetName(event.filename || ""));
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) =>
    record("unhandled-rejection", event.reason?.name),
  );
  window.addEventListener("securitypolicyviolation", () => record("content-security-policy"));
})();
