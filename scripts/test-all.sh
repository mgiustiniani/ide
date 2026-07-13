#!/usr/bin/env bash
set -euo pipefail

echo "=== Test suite ==="
echo "=== Phase 1/1: Frontend unit and integration tests (root Vitest discovery) ==="

pnpm test

echo "=== All test phases complete ==="
