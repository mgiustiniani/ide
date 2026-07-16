// ---------------------------------------------------------------------------
// @ide/web-core – Xcom2ModuleConfigurationPort
// ---------------------------------------------------------------------------
// Provider-neutral boundary for reading the configured XCOM 2 module roots.
// Concrete adapters own configuration access and validation.

import type {
  Xcom2ModuleConfigurationReadRequest,
  Xcom2ModuleConfigurationReadResult,
} from "@ide/contracts";

export interface Xcom2ModuleConfigurationPort {
  read(
    request: Readonly<Xcom2ModuleConfigurationReadRequest>,
  ): Promise<Readonly<Xcom2ModuleConfigurationReadResult>>;
}
