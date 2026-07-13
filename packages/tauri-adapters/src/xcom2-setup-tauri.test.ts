import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TauriAdapterError } from './errors';
import { TauriXcom2SetupAdapter } from './xcom2-setup-tauri';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);
const digest = 'a'.repeat(64);
const now = '2026-07-12T10:00:00Z';

const patchPaths = [
  'XComGame/Config/DefaultEngine.ini',
  'XComGame/Config/XComEngine.ini',
  'XComGame/Config/XComEditorUserSettings.ini',
];
function operation(id: string, kind: string, relativePath: string, overrides: Record<string, unknown> = {}) {
  const symlink = kind === 'createSymlink';
  return {
    operation: { id, kind, relativePath, executable: true },
    precondition: symlink ? { type: 'absent' } : { type: 'file', sha256: digest, bytes: 7 },
    afterState: null,
    backup: null,
    status: 'pending', checkpoint: 0, ...overrides,
  };
}
function operations() {
  return [
    ...patchPaths.map((path, index) => operation(`patch-${index}`, 'atomicTextPatch', path)),
    ...Array.from({ length: 11 }, (_, index) => operation(`quarantine-${index}`, 'quarantineFile', `Development/SrcOrig/DLC_3/Classes/X2TLE${index}.uc`)),
    operation('link-cooked', 'createSymlink', 'XComGame/CookedPCConsole'),
  ];
}
function baseline() {
  return {
    setupSchemaVersion: 1,
    products: [
      { appId: 268500, buildId: '8270065', stateFlags: 4, manifestSha256: 'b'.repeat(64), manifestBytes: 100, installRootIdentity: 'c'.repeat(64), manifestIdentity: 'd'.repeat(64) },
      { appId: 602410, buildId: '3197185', stateFlags: 4, manifestSha256: 'e'.repeat(64), manifestBytes: 100, installRootIdentity: 'f'.repeat(64), manifestIdentity: '1'.repeat(64) },
    ],
  };
}
function transaction(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, transactionId: 'tx-1', workspaceId: 'workspace-1', generation: 7,
    operationDigest: digest, state: 'prepared', executable: true, blockers: [],
    steps: operations(), baseline: baseline(), checkpoint: 0, cancelRequested: false,
    createdAt: now, updatedAt: now, error: null, ...overrides,
  };
}
function waiting() {
  return transaction({ state: 'waiting', executable: false, blockers: ['SDK monitor is not ready'] });
}
function event(sequence: number, overrides: Record<string, unknown> = {}) {
  return { sequence, workspaceId: 'workspace-1', generation: 7, transactionId: 'tx-1', state: 'applying', message: 'Apply checkpoint reached', ...overrides };
}

describe('TauriXcom2SetupAdapter commands and normalization', () => {
  beforeEach(() => invokeMock.mockReset());

  it('prepares without frontend paths or operations and keeps production blocked', async () => {
    invokeMock.mockResolvedValueOnce(waiting());
    const result = await new TauriXcom2SetupAdapter().prepare({} as never);
    expect(invokeMock).toHaveBeenCalledWith('prepare_xcom2_setup_transaction', undefined);
    expect(result).toMatchObject({ ok: true, value: { state: 'waiting-for-download', executable: false, applyAvailability: { allowed: false, blockers: ['SDK monitor is not ready'] } } });
  });

  it('normalizes an executable live-shaped native prepare while redacting paths and native metadata', async () => {
    invokeMock.mockResolvedValueOnce(transaction());
    const result = await new TauriXcom2SetupAdapter().getTransaction({ transactionId: 'tx-1' });
    expect(invokeMock).toHaveBeenCalledWith('get_xcom2_setup_transaction', { transactionId: 'tx-1' });
    expect(result).toMatchObject({ ok: true, value: { state: 'awaiting-approval', executable: true, applyAvailability: { allowed: true, blockers: [] }, reviewedOperationDigest: { digest }, journal: { managedBy: 'native' } } });
    expect(result.ok && result.value.operations).toHaveLength(15);
    expect(result.ok && result.value.operations[0]).toMatchObject({ operationId: 'patch-0', kind: 'atomic-text-config-patch', status: 'previewed', originalHash: { digest }, target: { scope: 'steam-sdk', redactedLabel: 'XCOM 2 SDK build 3197185' } });
    expect(JSON.stringify(result)).not.toContain('XComGame/Config');
    expect(JSON.stringify(result)).not.toContain('backups/');
  });

  it('binds apply to the exact digest and maps all transaction commands exactly', async () => {
    invokeMock.mockImplementation((command) => Promise.resolve(command === 'list_xcom2_setup_transactions' ? [transaction()] : transaction()));
    const adapter = new TauriXcom2SetupAdapter();
    await adapter.apply({ transactionId: 'tx-1', approvalToken: digest });
    await adapter.listTransactions({ workspaceId: 'workspace-1', limit: 12 });
    await adapter.cancel({ transactionId: 'tx-1', reason: 'not sent' });
    await adapter.rollback({ transactionId: 'tx-1', reason: 'not sent' });
    expect(invokeMock.mock.calls).toEqual([
      ['apply_xcom2_setup_transaction', { transactionId: 'tx-1', approvalDigest: digest }],
      ['list_xcom2_setup_transactions', { limit: 12 }],
      ['cancel_xcom2_setup_transaction', { transactionId: 'tx-1' }],
      ['rollback_xcom2_setup_transaction', { transactionId: 'tx-1' }],
    ]);
  });

  it('forwards only the exact transaction and digest through apply, then supports rollback and re-prepare', async () => {
    const appliedSteps = operations().map((step, index) => ({
      ...step,
      status: 'applied',
      afterState: index === 14 ? { type: 'symlink', target: '/home/user/.steam/XCOM2/CookedPCConsole' } : { type: 'file', sha256: '2'.repeat(64), bytes: 8 },
    }));
    const rolledBackSteps = appliedSteps.map((step) => ({ ...step, status: 'rolledBack' }));
    invokeMock
      .mockResolvedValueOnce(transaction())
      .mockResolvedValueOnce(transaction({ state: 'applied', steps: appliedSteps }))
      .mockResolvedValueOnce(transaction({ state: 'rolledBack', steps: rolledBackSteps }))
      .mockResolvedValueOnce(transaction({ transactionId: 'tx-2' }));
    const adapter = new TauriXcom2SetupAdapter();
    await adapter.prepare({} as never);
    const applied = await adapter.apply({ transactionId: 'tx-1', approvalToken: digest });
    const rolledBack = await adapter.rollback({ transactionId: 'tx-1', reason: '/not-forwarded' });
    const preparedAgain = await adapter.prepare({} as never);
    expect(applied).toMatchObject({ ok: true, value: { state: 'applied', rollbackAvailable: true } });
    expect(rolledBack).toMatchObject({ ok: true, value: { state: 'rolled-back', rollbackAvailable: false } });
    expect(preparedAgain).toMatchObject({ ok: true, value: { transactionId: 'tx-2', state: 'awaiting-approval', applyAvailability: { allowed: true } } });
    expect(invokeMock.mock.calls[1]).toEqual(['apply_xcom2_setup_transaction', { transactionId: 'tx-1', approvalDigest: digest }]);
    expect(JSON.stringify(invokeMock.mock.calls[1])).not.toMatch(/path|root|operation/i);
    expect(JSON.stringify(applied)).not.toContain('/home/user');
    expect(invokeMock.mock.calls[2]).toEqual(['rollback_xcom2_setup_transaction', { transactionId: 'tx-1' }]);
  });

  it('returns a redacted stale-plan rejection when the native build fingerprint changes', async () => {
    invokeMock.mockRejectedValueOnce('Steam build, manifest, or canonical install identity changed; /home/user/SteamLibrary');
    const result = await new TauriXcom2SetupAdapter().apply({ transactionId: 'tx-1', approvalToken: digest });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'stale-plan',
        message: 'The native Steam build fingerprint changed after preparation',
        recoveryGuidance: ['Prepare and review a fresh native XCOM 2 setup transaction'],
      },
    });
    expect(JSON.stringify(result)).not.toContain('/home/user');
  });

  it.each([
    ['resume rollback', 'resume-rollback'],
    ['retry rollback conflicts', 'retry-rollback'],
    ['inspect the journal without mutation', 'verify-journal'],
  ] as const)('maps %s to the exact native recovery strategy', async (_semantics, strategy) => {
    invokeMock.mockResolvedValueOnce(transaction());
    await new TauriXcom2SetupAdapter().recover({ transactionId: 'tx-1', strategy });
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith('recover_xcom2_setup_transaction', {
      transactionId: 'tx-1',
      strategy,
    });
  });

  it('rejects unsupported recovery strategies before invoking native code', () => {
    const adapter = new TauriXcom2SetupAdapter();
    expect(() => adapter.recover({ transactionId: 'tx-1', strategy: 'rollback' as never }))
      .toThrow(/Unsupported XCOM 2 recovery strategy: rollback/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('normalizes rollback conflict and recovery-required journal states', async () => {
    invokeMock
      .mockResolvedValueOnce(transaction({ state: 'rollbackConflict', steps: operations().map((step, index) => ({ ...step, status: index === 0 ? 'conflict' : 'applied', afterState: index === 14 ? { type: 'symlink', target: 'safe-relative-target' } : { type: 'file', sha256: 'b'.repeat(64), bytes: 8 } })), error: 'Target changed after apply' }))
      .mockResolvedValueOnce(transaction({ state: 'recoveryRequired', steps: operations().map((step, index) => ({ ...step, status: index === 0 ? 'intentWritten' : 'pending' })), error: 'Interrupted journal checkpoint' }));
    const adapter = new TauriXcom2SetupAdapter();
    const conflict = await adapter.getTransaction({ transactionId: 'tx-1' });
    expect(conflict).toMatchObject({ ok: true, value: { state: 'rollback-conflict', conflictReasons: ['Target changed after apply'], rollbackAvailable: true } });
    expect(conflict.ok && conflict.value.operations[0]).toMatchObject({ status: 'rollback-conflict', hashValidationStatus: 'mismatch' });
    await expect(adapter.getTransaction({ transactionId: 'tx-1' })).resolves.toMatchObject({ ok: true, value: { state: 'recovery-required', recoveryGuidance: ['Interrupted journal checkpoint'] } });
  });

  it.each([
    ['bad digest', () => transaction({ operationDigest: 'bad' })],
    ['absolute target', () => transaction({ steps: operations().map((step, index) => index === 0 ? { ...step, operation: { ...step.operation, relativePath: '/home/user/config' } } : step) })],
    ['duplicate ids and paths', () => transaction({ steps: operations().map((step, index, all) => index === 1 ? { ...step, operation: { ...step.operation, id: all[0]!.operation.id, relativePath: all[0]!.operation.relativePath } } : step) })],
    ['impossible rolled-back state', () => transaction({ state: 'rolledBack' })],
    ['conflict without operation conflict', () => transaction({ state: 'rollbackConflict' })],
    ['path leaked through message', () => transaction({ state: 'waiting', executable: false, blockers: ['See /home/user/journal'] })],
    ['content leaked through operation', () => transaction({ steps: operations().map((step, index) => index === 0 ? { ...step, operation: { ...step.operation, generatedContent: '[secret]' } } : step) })],
    ['absolute baseline root', () => transaction({ baseline: { ...baseline(), products: baseline().products.map((product, index) => index === 1 ? { ...product, installRootIdentity: '/home/user/sdk' } : product) } })],
  ])('rejects malformed %s payloads', async (_name, fixture) => {
    invokeMock.mockResolvedValueOnce(fixture());
    await expect(new TauriXcom2SetupAdapter().getTransaction({ transactionId: 'tx-1' })).rejects.toBeInstanceOf(TauriAdapterError);
  });
});

describe('TauriXcom2SetupAdapter event polling', () => {
  beforeEach(() => { vi.useFakeTimers(); invokeMock.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it('shares a non-overlapping loop, filters stale events, backs off, and cleans up', async () => {
    invokeMock.mockResolvedValueOnce(transaction()).mockRejectedValueOnce('temporary').mockResolvedValueOnce([
      event(1, { generation: 6 }), event(2),
    ]).mockResolvedValue([]);
    const adapter = new TauriXcom2SetupAdapter({ pollIntervalMs: 50, maxBackoffMs: 500, pollLimit: 9 });
    await adapter.getTransaction({ transactionId: 'tx-1' });
    const first = vi.fn(); const second = vi.fn();
    const unsubscribeFirst = adapter.subscribe({ transactionId: 'tx-1' }, first);
    const unsubscribeSecond = adapter.subscribe({ workspaceId: 'workspace-1' }, second);
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeMock).toHaveBeenLastCalledWith('poll_xcom2_setup_transaction_events', { afterSequence: 0, limit: 9 });
    await vi.advanceTimersByTimeAsync(100);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ sequence: 2 }));
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeFirst(); unsubscribeSecond(); unsubscribeSecond();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it('does not overlap or emit an in-flight response after unsubscribe', async () => {
    let resolve!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const listener = vi.fn();
    const unsubscribe = new TauriXcom2SetupAdapter({ pollIntervalMs: 50 }).subscribe({}, listener);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invokeMock).toHaveBeenCalledOnce();
    unsubscribe(); resolve([event(1)]);
    await Promise.resolve(); await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });
});
