// ---------------------------------------------------------------------------
// @ide/web-core – Xcom2ModuleScannerPort
// ---------------------------------------------------------------------------
// Provider-neutral boundary for the dedicated read-only module evidence scan.
// Concrete adapters own filesystem authority and bounded traversal.

import type { Xcom2ModuleScanRequest, Xcom2ModuleScanSnapshot } from "@ide/contracts";

export interface Xcom2ModuleScannerPort {
  scan(request: Readonly<Xcom2ModuleScanRequest>): Promise<Readonly<Xcom2ModuleScanSnapshot>>;
}
