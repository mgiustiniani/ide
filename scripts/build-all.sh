#!/usr/bin/env bash
set -euo pipefail

echo "=== Building all packages ==="

# Build shared packages in dependency order
pnpm --filter @ide/contracts exec tsc --noEmit
pnpm --filter @ide/web-core exec tsc --noEmit
pnpm --filter @ide/ui exec tsc --noEmit
pnpm --filter @ide/browser-adapters exec tsc --noEmit
pnpm --filter @ide/tauri-adapters exec tsc --noEmit

# Build web app
pnpm --filter @ide/web build

# Build desktop app
pnpm --filter @ide/desktop build

echo "=== Build complete ==="
