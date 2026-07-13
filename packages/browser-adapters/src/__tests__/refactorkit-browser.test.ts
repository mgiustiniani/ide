import type {
  ApplyRefactorKitPlanRequest,
  DiscardRefactorKitPlanRequest,
  PreviewExternalJavaImportRequest,
  RollbackRefactorKitTransactionRequest,
} from '@ide/contracts';
import { describe, expect, it } from 'vitest';
import {
  BrowserRefactorKitAdapter,
  BrowserRefactorKitUnavailableError,
  createBrowserAdapters,
} from '../index';

const UNAVAILABLE_REASON =
  'Local RefactorKit daemon access is desktop-only and unavailable in browser clients.';

const SYMBOL_ID = 'symbol-secret-7d94';
const SOURCE_ID = 'source-secret-18af';
const PLAN_ID = 'plan-secret-a251';
const TRANSACTION_ID = 'transaction-secret-64ce';
const REQUEST_ID = 'request-secret-099b';
const WORKSPACE_ID = 'workspace-secret-b012';
const FORBIDDEN_IDENTIFIERS = [
  SYMBOL_ID,
  SOURCE_ID,
  PLAN_ID,
  TRANSACTION_ID,
  REQUEST_ID,
  WORKSPACE_ID,
] as const;

const previewRequest: PreviewExternalJavaImportRequest = {
  code: SOURCE_ID,
  targetDirectory: 'src/main/java',
  sourceKind: 'clipboard',
  sourceUrl: null,
  licensePolicy: 'warn',
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  selectionGeneration: 12,
  requestId: REQUEST_ID,
};

const applyRequest: ApplyRefactorKitPlanRequest = {
  planId: PLAN_ID,
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  selectionGeneration: 12,
  requestId: REQUEST_ID,
  approval: {
    approvalId: 'approval-secret-c751',
    approvedPlanId: PLAN_ID,
    approvedAt: '2026-07-13T12:00:00.000Z',
  },
};

const rollbackRequest: RollbackRefactorKitTransactionRequest = {
  transactionId: TRANSACTION_ID,
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  requestId: REQUEST_ID,
};

const discardRequest: DiscardRefactorKitPlanRequest = {
  planId: PLAN_ID,
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  selectionGeneration: 12,
  requestId: REQUEST_ID,
};

async function expectStaticUnavailable(rejection: Promise<unknown>): Promise<void> {
  let caught: unknown;

  try {
    await rejection;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(BrowserRefactorKitUnavailableError);
  const error = caught as BrowserRefactorKitUnavailableError;
  expect(error.name).toBe('BrowserRefactorKitUnavailableError');
  expect(error.code).toBe('BROWSER_REFACTORKIT_UNAVAILABLE');
  expect(error.message).toBe(UNAVAILABLE_REASON);
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  for (const identifier of FORBIDDEN_IDENTIFIERS) {
    expect(error.message).not.toContain(identifier);
  }
}

describe('BrowserRefactorKitAdapter', () => {
  it('reports an honest unavailable status and language-kernel capability status', async () => {
    const adapter = new BrowserRefactorKitAdapter();

    await expect(adapter.getStatus()).resolves.toEqual({
      available: false,
      lastError: UNAVAILABLE_REASON,
    });
    await expect(adapter.getCapabilities()).resolves.toEqual({
      api: 'refactorkit',
      apiVersion: 'unknown',
      provider: 'refactorkit',
      providerVersion: null,
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
        stability: 'experimental',
      },
      languageKernel: {
        available: false,
        schema: null,
        reason: UNAVAILABLE_REASON,
      },
    });
  });

  it('is included in the browser adapter factory', () => {
    expect(createBrowserAdapters().refactorKitAdapter).toBeInstanceOf(BrowserRefactorKitAdapter);
  });

  it.each([
    ['scan', (adapter: BrowserRefactorKitAdapter) => adapter.scan()],
    ['diagnostics', (adapter: BrowserRefactorKitAdapter) => adapter.diagnostics()],
    ['symbols', (adapter: BrowserRefactorKitAdapter) => adapter.symbols()],
    ['definition', (adapter: BrowserRefactorKitAdapter) => adapter.definition(SYMBOL_ID)],
    ['references', (adapter: BrowserRefactorKitAdapter) => adapter.references(SYMBOL_ID)],
    [
      'previewExternalJavaImport',
      (adapter: BrowserRefactorKitAdapter) => adapter.previewExternalJavaImport(previewRequest),
    ],
    ['applyPlan', (adapter: BrowserRefactorKitAdapter) => adapter.applyPlan(applyRequest)],
    [
      'rollbackTransaction',
      (adapter: BrowserRefactorKitAdapter) => adapter.rollbackTransaction(rollbackRequest),
    ],
    ['discardPlan', (adapter: BrowserRefactorKitAdapter) => adapter.discardPlan(discardRequest)],
  ] as const)('rejects %s with one typed static error that redacts supplied identifiers', async (_name, operation) => {
    await expectStaticUnavailable(operation(new BrowserRefactorKitAdapter()));
  });
});
