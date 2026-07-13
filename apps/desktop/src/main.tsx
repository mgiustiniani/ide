// ---------------------------------------------------------------------------
// apps/desktop/src/main.tsx
// Entry point for the IDE desktop app. Renders the App component inside
// React.StrictMode with ReactDOM.createRoot.
// ---------------------------------------------------------------------------

import React from 'react';
import ReactDOM from 'react-dom/client';

import '@ide/ui/styles/globals.css';
import { App } from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error(
    'Root element (#root) not found. Ensure your HTML contains ' +
      '<div id="root"></div>.',
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
