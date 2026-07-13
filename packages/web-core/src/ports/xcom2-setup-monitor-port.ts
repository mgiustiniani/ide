// ---------------------------------------------------------------------------
// @ide/web-core – Xcom2SetupMonitorPort
// ---------------------------------------------------------------------------
// Read-only boundary for live Steam download/setup observation. Concrete
// adapters own discovery, polling, filesystem access and path redaction.

import type {
  Xcom2SetupMonitorListener,
  Xcom2SetupMonitorSnapshot,
  Xcom2SetupMonitorUnsubscribe,
} from '@ide/contracts';

export interface Xcom2SetupMonitorPort {
  /** Return the latest export-safe snapshot without requesting new I/O. */
  getSnapshot(): Promise<Xcom2SetupMonitorSnapshot>;

  /** Request a fresh read of Steam metadata and return the resulting snapshot. */
  refresh(): Promise<Xcom2SetupMonitorSnapshot>;

  /**
   * Subscribe to monotonically sequenced snapshot events.
   * The returned function detaches the listener and must be safe to call repeatedly.
   */
  subscribe(listener: Xcom2SetupMonitorListener): Xcom2SetupMonitorUnsubscribe;
}
