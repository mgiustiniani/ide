// ---------------------------------------------------------------------------
// @ide/web-core – Store Accessor Helpers
// ---------------------------------------------------------------------------
// View-models must read the current store state on every access. Passing a
// Zustand state snapshot (store.getState()) freezes reads at construction time,
// so view-models accept either a getState function or a StoreApi-like object.

import type { StoreApi } from 'zustand';

/** Source of live store state for framework-agnostic view-models. */
export type StoreAccessor<TState> = (() => TState) | Pick<StoreApi<TState>, 'getState'>;

/** Normalize a getState function or StoreApi-like object to a getState function. */
export function toGetState<TState>(accessor: StoreAccessor<TState>): () => TState {
  // Zustand bound stores are callable functions with a getState property, so
  // recognize StoreApi-like accessors before treating a function as getState.
  if (
    (typeof accessor === 'object' || typeof accessor === 'function') &&
    accessor !== null &&
    'getState' in accessor &&
    typeof accessor.getState === 'function'
  ) {
    return () => accessor.getState();
  }
  if (typeof accessor === 'function') return accessor;

  // Runtime compatibility for legacy JavaScript callers that still pass a
  // snapshot. TypeScript callers are intentionally required to pass live state.
  return () => accessor as TState;
}
