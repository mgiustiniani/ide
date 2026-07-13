import { describe, expect, it, vi } from 'vitest';
import type {
  ApplyRefactorKitPlanResult,
  DiscardRefactorKitPlanRequest,
  DiscardRefactorKitPlanResult,
  PreviewExternalJavaImportRequest,
  RefactorKitCapabilities,
  RefactorKitPatchPlan,
} from '@ide/contracts';
import type { ClipboardPort, RefactorKitPort } from './ports';
import {
  PasteExternalJavaClass,
  type PasteExternalJavaClassApproval,
  type PasteExternalJavaClassSelection,
} from './paste-external-java-class';

const selection: PasteExternalJavaClassSelection = {
  targetDirectory: 'src/main/java/example',
  workspaceId: 'workspace-1',
  workspaceGeneration: 7,
  selectionGeneration: 3,
  requestId: 'preview-1',
};

const capabilities: RefactorKitCapabilities = {
  api: 'RefactorKit',
  apiVersion: '0.3',
  provider: 'refactorkit',
  providerVersion: '0.3.0',
  javaImportExternalClass: {
    supported: true,
    targetDirectory: true,
    preview: true,
    apply: true,
    rollback: true,
    stability: 'preview',
  },
};

function plan(status: RefactorKitPatchPlan['status'] = 'ready'): RefactorKitPatchPlan {
  return {
    planId: 'plan-42',
    status,
    summary: 'Create Example.java',
    confidence: 0.98,
    riskLevel: 'low',
    evidence: [],
    affectedFiles: [{ change: 'create', path: 'src/main/java/example/Example.java', primary: true }],
    placement: { packageName: 'example', sourceRoot: 'src/main/java', moduleName: null },
    packageChanges: [],
    renderedDiff: 'diff',
    structuredDiff: [],
    warnings: [],
    diagnosticsAfterPreview: [],
    provenance: {
      sourceKind: 'clipboard',
      sourceUrl: null,
      detectedLicense: null,
      licensePolicy: 'warn',
      notices: [],
    },
    unresolvedDependencies: [],
    conflicts: [],
    refusalReasons: status === 'ready' ? [] : ['Backend refused the import.'],
    applyEligibility: { eligible: status === 'ready', blockers: [] },
    staleness: { stale: status === 'stale', reasons: [] },
    provider: 'refactorkit',
    providerVersion: '0.3.0',
    workspaceId: selection.workspaceId,
    workspaceGeneration: selection.workspaceGeneration,
    selectionGeneration: selection.selectionGeneration,
    requestId: selection.requestId,
  };
}

function approval(overrides: Partial<PasteExternalJavaClassApproval> = {}): PasteExternalJavaClassApproval {
  return {
    workspaceId: selection.workspaceId,
    workspaceGeneration: selection.workspaceGeneration,
    selectionGeneration: selection.selectionGeneration,
    requestId: 'apply-1',
    approval: { approvalId: 'approval-1', approvedPlanId: 'plan-42', approvedAt: '2026-07-12T00:00:00Z' },
    ...overrides,
  };
}

function harness(text = 'public class Example {}', patchPlan = plan()) {
  const readText = vi.fn().mockResolvedValue(text);
  const clipboard: ClipboardPort = { readText };
  const previewExternalJavaImport = vi.fn().mockResolvedValue(patchPlan);
  const applyPlan = vi.fn().mockResolvedValue({
    transactionId: 'tx-1',
    planId: patchPlan.planId,
    changedFiles: patchPlan.affectedFiles,
    primaryFile: patchPlan.affectedFiles[0]?.path ?? null,
    diagnostics: [],
    provider: 'refactorkit',
    providerVersion: '0.3.0',
  } satisfies ApplyRefactorKitPlanResult);
  const discardPlan = vi.fn((request: DiscardRefactorKitPlanRequest) =>
    Promise.resolve({
      planId: request.planId,
      discarded: true,
    } satisfies DiscardRefactorKitPlanResult),
  );
  const refactorKit = {
    getCapabilities: vi.fn().mockResolvedValue(capabilities),
    previewExternalJavaImport,
    applyPlan,
    discardPlan,
  } as unknown as RefactorKitPort;
  return {
    useCase: new PasteExternalJavaClass(clipboard, refactorKit),
    readText,
    refactorKit,
    previewExternalJavaImport,
    applyPlan,
    discardPlan,
  };
}

describe('PasteExternalJavaClass', () => {
  it('stays unavailable when targetDirectory capability is absent', async () => {
    const h = harness();
    vi.mocked(h.refactorKit.getCapabilities).mockResolvedValue({
      ...capabilities,
      apiVersion: '0.2',
      javaImportExternalClass: { ...capabilities.javaImportExternalClass, targetDirectory: false },
    });

    const state = await h.useCase.preview(selection);

    expect(state).toEqual({
      status: 'unavailable',
      message:
        'Paste Java Class is unavailable because RefactorKit does not advertise java.importExternalClass with targetDirectory preview and apply support.',
    });
    expect(h.readText).not.toHaveBeenCalled();
    expect(h.previewExternalJavaImport).not.toHaveBeenCalled();
  });

  it('does not read the clipboard when the capability probe fails', async () => {
    const h = harness();
    vi.mocked(h.refactorKit.getCapabilities).mockRejectedValue(new Error('probe failed'));

    const state = await h.useCase.preview(selection);

    expect(state).toEqual({
      status: 'unavailable',
      message: 'Paste Java Class is unavailable because the RefactorKit request failed.',
    });
    expect(h.readText).not.toHaveBeenCalled();
    expect(h.previewExternalJavaImport).not.toHaveBeenCalled();
  });

  it('does not read the clipboard when cancelled during the capability probe', async () => {
    const h = harness();
    let resolveCapabilities!: (value: RefactorKitCapabilities) => void;
    const capabilityProbe = new Promise<RefactorKitCapabilities>((resolve) => {
      resolveCapabilities = resolve;
    });
    vi.mocked(h.refactorKit.getCapabilities).mockReturnValue(capabilityProbe);

    const preview = h.useCase.preview(selection);
    expect(h.useCase.state).toEqual({ status: 'checking-capability' });
    h.useCase.cancel();
    resolveCapabilities(capabilities);

    await expect(preview).resolves.toEqual({ status: 'idle' });
    expect(h.readText).not.toHaveBeenCalled();
    expect(h.previewExternalJavaImport).not.toHaveBeenCalled();
    // No plan existed to discard — discardPlan should not have been called
    expect(h.discardPlan).not.toHaveBeenCalled();
  });

  it('validates the target before probing capabilities or reading the clipboard', async () => {
    const h = harness();

    await expect(h.useCase.preview({ ...selection, targetDirectory: '  ' })).resolves.toEqual(
      expect.objectContaining({ status: 'refused', kind: 'invalid-target' }),
    );

    expect(h.refactorKit.getCapabilities).not.toHaveBeenCalled();
    expect(h.readText).not.toHaveBeenCalled();
  });

  it('passes the exact directory and clipboard provenance without deriving targetPackage', async () => {
    const h = harness();
    await h.useCase.preview(selection);

    const request = h.previewExternalJavaImport.mock.calls[0]?.[0] as PreviewExternalJavaImportRequest;
    expect(request).toEqual({
      code: 'public class Example {}',
      targetDirectory: selection.targetDirectory,
      sourceKind: 'clipboard',
      sourceUrl: null,
      licensePolicy: 'warn',
      workspaceId: selection.workspaceId,
      workspaceGeneration: selection.workspaceGeneration,
      selectionGeneration: selection.selectionGeneration,
      requestId: selection.requestId,
    });
    expect(Object.keys(request)).not.toContain('targetPackage');
    expect(h.readText).toHaveBeenCalledOnce();
    expect(h.useCase.state).not.toHaveProperty('code');
  });

  it.each([
    ['', 'empty-clipboard'],
    ['   ', 'empty-clipboard'],
  ])('refuses empty clipboard text', async (text, kind) => {
    const h = harness(text);
    await expect(h.useCase.preview(selection)).resolves.toEqual(expect.objectContaining({ kind }));
    expect(h.refactorKit.getCapabilities).toHaveBeenCalledOnce();
    expect(h.readText).toHaveBeenCalledOnce();
    expect(h.useCase.state).not.toHaveProperty('plan');
  });

  it('refuses oversized text after capability detection', async () => {
    const h = harness('12345');
    h.useCase = new PasteExternalJavaClass(
      { readText: vi.fn().mockResolvedValue('12345') },
      h.refactorKit,
      { maxClipboardLength: 4 },
    );
    await expect(h.useCase.preview(selection)).resolves.toEqual(
      expect.objectContaining({ kind: 'clipboard-too-large' }),
    );
    expect(h.refactorKit.getCapabilities).toHaveBeenCalledOnce();
  });

  it.each([
    ['refused', 'plan-refused'],
    ['stale', 'plan-stale'],
    ['error', 'plan-error'],
  ] as const)('retains the complete backend %s plan as refusal evidence', async (status, kind) => {
    const backendPlan = plan(status);
    backendPlan.warnings = ['Backend warning'];
    backendPlan.evidence = [{ kind: 'java-source-root', summary: 'Matched source root' }];
    const h = harness('class X {}', backendPlan);

    const state = await h.useCase.preview(selection);

    expect(state).toEqual({
      status: 'refused',
      kind,
      reasons: ['Backend refused the import.'],
      plan: backendPlan,
    });
    expect(state).toHaveProperty('plan', backendPlan);
    expect(h.applyPlan).not.toHaveBeenCalled();
  });

  it('retains no raw clipboard request field with backend refusal evidence', async () => {
    const clipboardCode = 'private-secret-clipboard-source';
    const h = harness(clipboardCode, plan('refused'));

    const state = await h.useCase.preview(selection);

    expect(state).toEqual(expect.objectContaining({ status: 'refused', plan: plan('refused') }));
    expect(state).not.toHaveProperty('code');
    expect((state as { plan?: object }).plan).not.toHaveProperty('code');
    expect(JSON.stringify(state)).not.toContain(clipboardCode);
  });

  it('does not retain a backend plan from a stale selection generation', async () => {
    const stalePlan = {
      ...plan('stale'),
      selectionGeneration: selection.selectionGeneration + 1,
    };
    const h = harness('class X {}', stalePlan);

    const state = await h.useCase.preview(selection);

    expect(state).toEqual({
      status: 'refused',
      kind: 'plan-stale',
      reasons: ['RefactorKit returned a plan for a stale workspace selection.'],
    });
    expect(state).not.toHaveProperty('plan');
  });

  it('a cancelled generation discards a late-arriving backend plan', async () => {
    const h = harness();
    let resolvePlan!: (value: RefactorKitPatchPlan) => void;
    h.previewExternalJavaImport.mockReturnValue(
      new Promise<RefactorKitPatchPlan>((resolve) => {
        resolvePlan = resolve;
      }),
    );

    const preview = h.useCase.preview(selection);
    await vi.waitFor(() => expect(h.previewExternalJavaImport).toHaveBeenCalledOnce());
    h.useCase.cancel();
    resolvePlan(plan('error'));

    await expect(preview).resolves.toEqual({ status: 'idle' });
    expect(h.useCase.state).toEqual({ status: 'idle' });
    // The late plan should be discarded asynchronously
    expect(h.discardPlan).toHaveBeenCalledOnce();
    const discardRequest = h.discardPlan.mock.calls[0]?.[0] as DiscardRefactorKitPlanRequest;
    expect(discardRequest).toEqual({
      planId: 'plan-42',
      workspaceId: selection.workspaceId,
      workspaceGeneration: selection.workspaceGeneration,
      selectionGeneration: selection.selectionGeneration,
      requestId: selection.requestId,
    });
  });

  it.each(['refused', 'stale', 'error'] as const)(
    'cancel clears retained %s evidence and discards the non-ready plan',
    async (status) => {
      const nonReadyPlan = plan(status);
      const h = harness('class X {}', nonReadyPlan);
      await h.useCase.preview(selection);
      expect(h.useCase.state).toHaveProperty('plan');

      h.useCase.cancel();

      expect(h.useCase.state).toEqual({ status: 'idle' });
      expect(h.discardPlan).toHaveBeenCalledOnce();
      expect(h.discardPlan.mock.calls[0]?.[0]).toEqual({
        planId: nonReadyPlan.planId,
        workspaceId: nonReadyPlan.workspaceId,
        workspaceGeneration: nonReadyPlan.workspaceGeneration,
        selectionGeneration: nonReadyPlan.selectionGeneration,
        requestId: nonReadyPlan.requestId,
      });
      await h.useCase.apply(approval());
      expect(h.applyPlan).not.toHaveBeenCalled();
    },
  );

  it('cancel invalidates synchronously and sends only the exact discard envelope', async () => {
    const h = harness();
    await h.useCase.preview(selection);
    expect(h.discardPlan).not.toHaveBeenCalled();
    h.discardPlan.mockImplementationOnce((request: DiscardRefactorKitPlanRequest) => {
      expect(h.useCase.state).toEqual({ status: 'idle' });
      return Promise.resolve({ planId: request.planId, discarded: true });
    });

    h.useCase.cancel();

    expect(h.useCase.state).toEqual({ status: 'idle' });
    expect(h.discardPlan).toHaveBeenCalledOnce();
    const discardRequest = h.discardPlan.mock.calls[0]?.[0] as DiscardRefactorKitPlanRequest;
    expect(discardRequest).toEqual({
      planId: 'plan-42',
      workspaceId: selection.workspaceId,
      workspaceGeneration: selection.workspaceGeneration,
      selectionGeneration: selection.selectionGeneration,
      requestId: selection.requestId,
    });
    expect(Object.keys(discardRequest).sort()).toEqual([
      'planId',
      'requestId',
      'selectionGeneration',
      'workspaceGeneration',
      'workspaceId',
    ]);
    expect(JSON.stringify(discardRequest)).not.toContain('public class Example');

    await h.useCase.apply(approval());
    expect(h.applyPlan).not.toHaveBeenCalled();
  });

  it('double cancel is idempotent and discards a retained plan exactly once', async () => {
    const h = harness();
    await h.useCase.preview(selection);

    h.useCase.cancel();
    h.useCase.cancel();

    expect(h.useCase.state).toEqual({ status: 'idle' });
    expect(h.discardPlan).toHaveBeenCalledOnce();
  });

  it('a new preview discards the older retained plan before retaining its replacement', async () => {
    const replacementSelection = {
      ...selection,
      selectionGeneration: selection.selectionGeneration + 1,
      requestId: 'preview-2',
    };
    const originalPlan = plan();
    const replacementPlan = {
      ...plan(),
      planId: 'plan-43',
      selectionGeneration: replacementSelection.selectionGeneration,
      requestId: replacementSelection.requestId,
    };
    const h = harness();
    h.previewExternalJavaImport
      .mockReset()
      .mockResolvedValueOnce(originalPlan)
      .mockResolvedValueOnce(replacementPlan);
    await h.useCase.preview(selection);

    const replacementPreview = h.useCase.preview(replacementSelection);

    expect(h.useCase.state).toEqual({ status: 'checking-capability' });
    expect(h.discardPlan).toHaveBeenCalledOnce();
    expect(h.discardPlan.mock.calls[0]?.[0]).toEqual({
      planId: originalPlan.planId,
      workspaceId: originalPlan.workspaceId,
      workspaceGeneration: originalPlan.workspaceGeneration,
      selectionGeneration: originalPlan.selectionGeneration,
      requestId: originalPlan.requestId,
    });
    await expect(replacementPreview).resolves.toEqual({
      status: 'preview',
      plan: replacementPlan,
    });
    expect(h.discardPlan).toHaveBeenCalledOnce();
  });

  it('keeps asynchronous discard failures redacted, non-fatal, and state-neutral', async () => {
    const source = 'private-secret-clipboard-source';
    const h = harness(source);
    await h.useCase.preview(selection);
    h.discardPlan.mockRejectedValueOnce(new Error(`discard failed: ${source}`));

    expect(() => h.useCase.cancel()).not.toThrow();
    expect(h.useCase.state).toEqual({ status: 'idle' });
    await Promise.resolve();

    expect(h.discardPlan).toHaveBeenCalledOnce();
    expect(JSON.stringify(h.discardPlan.mock.calls[0]?.[0])).not.toContain(source);
    expect(JSON.stringify(h.useCase.state)).not.toContain(source);
  });

  it('absorbs a synchronous legacy discard failure after clearing state', async () => {
    const h = harness();
    await h.useCase.preview(selection);
    h.discardPlan.mockImplementationOnce(() => {
      throw new Error('synchronous adapter failure with private source');
    });

    expect(() => h.useCase.cancel()).not.toThrow();
    expect(h.useCase.state).toEqual({ status: 'idle' });
    expect(h.discardPlan).toHaveBeenCalledOnce();
  });

  it('defensively tolerates a legacy structural mock without discardPlan', async () => {
    const h = harness();
    await h.useCase.preview(selection);
    delete (h.refactorKit as unknown as Record<string, unknown>).discardPlan;

    expect(() => h.useCase.cancel()).not.toThrow();
    expect(h.useCase.state).toEqual({ status: 'idle' });
  });

  it('never discards a successfully applied plan', async () => {
    const h = harness();
    await h.useCase.preview(selection);
    await h.useCase.apply(approval());
    expect(h.useCase.state).toEqual(expect.objectContaining({ status: 'applied' }));

    h.useCase.cancel();

    expect(h.useCase.state).toEqual({ status: 'idle' });
    expect(h.discardPlan).not.toHaveBeenCalled();
  });

  it('applies only the exact current plan approval without source or placement data', async () => {
    const h = harness();
    await h.useCase.preview(selection);
    const exactApproval = approval();
    await h.useCase.apply(exactApproval);
    expect(h.applyPlan).toHaveBeenCalledOnce();
    expect(h.applyPlan.mock.calls[0]?.[0]).toEqual({
      planId: 'plan-42',
      workspaceId: selection.workspaceId,
      workspaceGeneration: selection.workspaceGeneration,
      selectionGeneration: selection.selectionGeneration,
      requestId: exactApproval.requestId,
      approval: exactApproval.approval,
    });
    expect(h.applyPlan.mock.calls[0]?.[0]).not.toHaveProperty('code');
    expect(h.applyPlan.mock.calls[0]?.[0]).not.toHaveProperty('targetDirectory');
  });

  it.each([
    { workspaceGeneration: 8 },
    { selectionGeneration: 4 },
    { workspaceId: 'other-workspace' },
  ])('rejects stale workspace or selection approval before the adapter', async (mismatch) => {
    const h = harness();
    await h.useCase.preview(selection);
    const state = await h.useCase.apply(approval(mismatch));
    expect(state).toEqual(expect.objectContaining({ kind: 'approval-mismatch' }));
    expect(state).not.toHaveProperty('plan');
    expect(h.applyPlan).not.toHaveBeenCalled();
  });

  it('does not fall back when RefactorKit preview fails', async () => {
    const h = harness();
    h.previewExternalJavaImport.mockRejectedValue(new Error('provider failure with source'));
    const state = await h.useCase.preview(selection);
    expect(state).toEqual({
      status: 'unavailable',
      message: 'Paste Java Class is unavailable because the RefactorKit request failed.',
    });
    expect(h.previewExternalJavaImport).toHaveBeenCalledOnce();
    expect(JSON.stringify(state)).not.toContain('public class Example');
  });
});
