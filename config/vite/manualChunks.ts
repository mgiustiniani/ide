// Monaco's ESM editor API is a tightly coupled graph and is safer as one chunk.
// Workers are emitted as separate assets, so this limit applies only to the API chunk.
export const monacoChunkSizeWarningLimit = 2_400;

const reactVendorPackages = new Set(['react', 'react-dom', 'scheduler']);
const stateVendorPackages = new Set(['zustand']);

function normalizePath(id: string): string {
  return id.replace(/\\/g, '/');
}

function nodePackageName(id: string): string | undefined {
  if (!id.includes('/node_modules/')) {
    return undefined;
  }

  const packagePath = id.split('/node_modules/').pop();

  if (!packagePath) {
    return undefined;
  }

  const parts = packagePath.split('/');

  if (parts[0]?.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }

  return parts[0];
}

export function manualChunks(id: string): string | undefined {
  const normalizedId = normalizePath(id);
  const packageName = nodePackageName(normalizedId);

  if (packageName) {
    if (reactVendorPackages.has(packageName)) {
      return 'vendor-react';
    }

    if (stateVendorPackages.has(packageName)) {
      return 'vendor-state';
    }

    if (packageName.startsWith('@xterm/')) {
      return 'vendor-terminal';
    }

    if (packageName === '@monaco-editor/react') {
      return 'vendor-monaco-react';
    }

    if (packageName === 'monaco-editor') {
      return 'vendor-monaco';
    }

    if (packageName.startsWith('@tauri-apps/')) {
      return 'vendor-tauri';
    }

    return 'vendor';
  }

  if (
    normalizedId.endsWith('/packages/ui/src/components/Editor/MonacoCodeEditor.tsx')
    || normalizedId.endsWith('/packages/ui/src/components/Editor/monacoLanguage.ts')
    || normalizedId.includes('/packages/ui/src/monaco/')
  ) {
    return 'ide-ui-monaco';
  }

  if (normalizedId.includes('/packages/ui/src/')) {
    return 'ide-ui';
  }

  if (normalizedId.includes('/packages/web-core/src/')) {
    return 'ide-web-core';
  }

  if (normalizedId.includes('/packages/browser-adapters/src/')) {
    return 'ide-browser-adapters';
  }

  if (normalizedId.includes('/packages/tauri-adapters/src/')) {
    return 'ide-tauri-adapters';
  }

  if (normalizedId.includes('/packages/contracts/src/')) {
    return 'ide-contracts';
  }

  return undefined;
}
