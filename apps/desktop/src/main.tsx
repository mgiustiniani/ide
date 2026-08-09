// ---------------------------------------------------------------------------
// apps/desktop/src/main.tsx
// Entry point for the IDE desktop app. Renders the App component inside
// React.StrictMode with ReactDOM.createRoot.
// ---------------------------------------------------------------------------

import React from "react";
import ReactDOM from "react-dom/client";
import { createTauriXcom2ProjectFoundryRendererComposition } from "@ide/tauri-adapters";

import "@ide/ui/styles/globals.css";
import { App } from "./App";
import { DetachedPiAgentApp } from "./DetachedPiAgentApp";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(
    "Root element (#root) not found. Ensure your HTML contains " + '<div id="root"></div>.',
  );
}

const isDetachedPiAgent = new URLSearchParams(window.location.search).get("view") === "pi-agent";
const application = isDetachedPiAgent ? (
  <DetachedPiAgentApp />
) : (
  <App projectFoundry={createTauriXcom2ProjectFoundryRendererComposition()} />
);

ReactDOM.createRoot(rootElement).render(<React.StrictMode>{application}</React.StrictMode>);
