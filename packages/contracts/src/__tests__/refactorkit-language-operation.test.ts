import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  RefactorKitLanguageAdapterRuntime,
  RefactorKitLanguageCapability,
} from '../refactorkit';

const runtime = Object.freeze({
  executionMode: 'external-process',
  supportsTimeout: true,
  supportsCancellation: true,
  usesWorkspaceOverlay: true,
  recordsProcessProvenance: true,
  limits: Object.freeze({
    requestTimeoutMillis: 10_000,
    maxInputBytes: 8 * 1024 * 1024,
    maxOutputBytes: 64 * 1024 * 1024,
    maxProcesses: 8,
  }),
}) satisfies RefactorKitLanguageAdapterRuntime;

const extensions = Object.freeze(['ts', 'tsx']);

const diagnosticsCapability = {
  operation: 'diagnostics',
  stability: 'experimental',
  evidence: 'compiler',
  mutationAuthority: 'none',
  backend: 'typescript-lsp-explicit-v1',
  runtime: { ...runtime, limits: { ...runtime.limits } },
  extensions: [...extensions],
} satisfies RefactorKitLanguageCapability;

describe('RefactorKit schema-v1 language operation capability', () => {
  it('requires the exact seven-field RefactorKit 0.6.2 wire contract', () => {
    expectTypeOf<keyof RefactorKitLanguageCapability>().toEqualTypeOf<
      | 'operation'
      | 'stability'
      | 'evidence'
      | 'mutationAuthority'
      | 'backend'
      | 'runtime'
      | 'extensions'
    >();

    expect(Object.keys(diagnosticsCapability)).toEqual([
      'operation',
      'stability',
      'evidence',
      'mutationAuthority',
      'backend',
      'runtime',
      'extensions',
    ]);
  });

  it('preserves explicit operation metadata in independent arrays and runtime values', () => {
    expect(diagnosticsCapability).toEqual({
      operation: 'diagnostics',
      stability: 'experimental',
      evidence: 'compiler',
      mutationAuthority: 'none',
      backend: 'typescript-lsp-explicit-v1',
      runtime,
      extensions,
    });
    expect(diagnosticsCapability.runtime).not.toBe(runtime);
    expect(diagnosticsCapability.runtime.limits).not.toBe(runtime.limits);
    expect(diagnosticsCapability.extensions).not.toBe(extensions);
  });

  it('does not accept a wire operation with missing materialized metadata', () => {
    // @ts-expect-error RefactorKit 0.6.2 wire entries always materialize backend, runtime, and extensions.
    const incomplete: RefactorKitLanguageCapability = {
      operation: 'diagnostics',
      stability: 'experimental',
      evidence: 'compiler',
      mutationAuthority: 'none',
    };

    expect(incomplete.operation).toBe('diagnostics');
  });
});
