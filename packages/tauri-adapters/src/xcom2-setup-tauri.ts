import {
  XCOM2_SETUP_PLAN_VERSION,
  type Xcom2SetupApproval,
  type Xcom2SetupApplyRequest,
  type Xcom2SetupApproveRequest,
  type Xcom2SetupCancelRequest,
  type Xcom2SetupCapability,
  type Xcom2SetupContentHash,
  type Xcom2SetupEventListener,
  type Xcom2SetupExternalAction,
  type Xcom2SetupFailure,
  type Xcom2SetupGetTransactionRequest,
  type Xcom2SetupListTransactionsRequest,
  type Xcom2SetupOperation,
  type Xcom2SetupOperationKind,
  type Xcom2SetupOperationStatus,
  type Xcom2SetupPrepareRequest,
  type Xcom2SetupRecoverRequest,
  type Xcom2SetupResult,
  type Xcom2SetupRollbackRequest,
  type Xcom2SetupStepId,
  type Xcom2SetupTransactionDetail,
  type Xcom2SetupTransactionEvent,
  type Xcom2SetupTransactionList,
  type Xcom2SetupTransactionSummary,
  type Xcom2SetupWorkflowState,
} from '@ide/contracts';
import { canApplyXcom2SetupTransaction } from '@ide/web-core';
import type { Xcom2SetupPort, Xcom2SetupSubscription } from '@ide/web-core/ports';

import { TauriAdapterError, invokeTauri, toTauriAdapterError } from './errors';

const COMMANDS = {
  prepare: 'prepare_xcom2_setup_transaction',
  apply: 'apply_xcom2_setup_transaction',
  get: 'get_xcom2_setup_transaction',
  list: 'list_xcom2_setup_transactions',
  cancel: 'cancel_xcom2_setup_transaction',
  rollback: 'rollback_xcom2_setup_transaction',
  recover: 'recover_xcom2_setup_transaction',
  poll: 'poll_xcom2_setup_transaction_events',
} as const;
const MAX_ITEMS = 128;
const MAX_TEXT = 4_096;
const SHA256 = /^[a-f0-9]{64}$/i;
const RAW_STATES = new Set(['waiting', 'prepared', 'applying', 'applied', 'partial', 'rollingBack', 'rolledBack', 'rollbackConflict', 'recoveryRequired', 'cancelled']);
const STEP_STATUSES = new Set(['pending', 'intentWritten', 'applied', 'rolledBack', 'conflict']);
const PATCH_PATHS = new Set([
  'XComGame/Config/DefaultEngine.ini',
  'XComGame/Config/XComEngine.ini',
  'XComGame/Config/XComEditorUserSettings.ini',
]);
const TLE_PREFIX = 'Development/SrcOrig/DLC_3/Classes/';
const COOKED_LINK = 'XComGame/CookedPCConsole';
const EXPECTED_OPERATION_COUNTS = { atomicTextPatch: 3, quarantineFile: 11, createSymlink: 1 } as const;
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

export interface Xcom2SetupPollOptions {
  pollIntervalMs?: number;
  maxBackoffMs?: number;
  pollLimit?: number;
}
interface Subscription { active: boolean; filter: Xcom2SetupSubscription; listener: Xcom2SetupEventListener }
interface NormalizedTransaction { detail: Xcom2SetupTransactionDetail; rawState: string; executable: boolean; operationDigest: string }
interface NativeBaselineEvidence { sdkBuildId: string; sdkRootFingerprint: string; sdkManifestHash: string }
interface NormalizedOperation { operation: Xcom2SetupOperation; path: string; rawKind: string; status: string; reversible: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid(command: string, message: string, response: unknown): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid ${command} response: ${message}`, response);
}
function object(command: string, response: unknown, value: unknown = response): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(command, 'expected object', response);
  return value;
}
function text(command: string, response: unknown, value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_TEXT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw invalid(command, `invalid or oversized string ${field}`, response);
  }
  return value;
}
function optionalText(command: string, response: unknown, value: unknown, field: string): string | undefined {
  return value === undefined || value === null ? undefined : text(command, response, value, field);
}
function safeId(command: string, response: unknown, value: unknown, field: string): string {
  const result = text(command, response, value, field);
  if (!SAFE_ID.test(result)) throw invalid(command, `unsafe identifier ${field}`, response);
  return result;
}
function exportText(command: string, response: unknown, value: unknown, field: string): string {
  const result = text(command, response, value, field);
  if (/(?:^|\s)(?:[/\\][A-Za-z0-9_.-]|[A-Za-z]:[/\\]|file:)/i.test(result)) {
    throw invalid(command, `absolute path is forbidden in ${field}`, response);
  }
  return result;
}
function bool(command: string, response: unknown, value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalid(command, `invalid boolean ${field}`, response);
  return value;
}
function integer(command: string, response: unknown, value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid(command, `invalid integer ${field}`, response);
  return value;
}
function timestamp(command: string, response: unknown, value: unknown, field: string): string {
  const input = text(command, response, value, field);
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) throw invalid(command, `invalid timestamp ${field}`, response);
  return new Date(parsed).toISOString();
}
function array(command: string, response: unknown, value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw invalid(command, `invalid or oversized array ${field}`, response);
  return value;
}
function strings(command: string, response: unknown, value: unknown, field: string): readonly string[] {
  return array(command, response, value, field).map((item, index) => exportText(command, response, item, `${field}[${index}]`));
}
function hash(command: string, response: unknown, value: unknown, field: string): Xcom2SetupContentHash {
  const digest = text(command, response, value, field);
  if (!SHA256.test(digest)) throw invalid(command, `invalid sha256 digest ${field}`, response);
  return { algorithm: 'sha256', digest: digest.toLowerCase() };
}
function safeRelative(command: string, response: unknown, value: unknown, field: string): string {
  const path = text(command, response, value, field);
  if (/^(?:[/\\]|[A-Za-z]:[/\\]|file:)/i.test(path) || path.split(/[\\/]/).some((part) => part === '' || part === '.' || part === '..')) {
    throw invalid(command, `unsafe path ${field}`, response);
  }
  return path;
}
function workflow(command: string, response: unknown, value: unknown): Xcom2SetupWorkflowState {
  if (!RAW_STATES.has(value as string)) throw invalid(command, 'unsupported transaction state', response);
  return ({ waiting: 'waiting-for-download', prepared: 'awaiting-approval', applying: 'applying', applied: 'applied', partial: 'partial', rollingBack: 'rolling-back', rolledBack: 'rolled-back', rollbackConflict: 'rollback-conflict', recoveryRequired: 'recovery-required', cancelled: 'cancelled' } as const)[value as 'waiting'];
}

const OPERATION_MAP: Record<string, { kind: Xcom2SetupOperationKind; capability: Xcom2SetupCapability; stepId: Xcom2SetupStepId }> = {
  atomicTextPatch: { kind: 'atomic-text-config-patch', capability: 'patch-sdk-configuration', stepId: 'configure-sdk-offline-mode' },
  quarantineFile: { kind: 'quarantine-restore-file', capability: 'quarantine-sdk-file', stepId: 'quarantine-tle-sources' },
  createGeneratedFile: { kind: 'create-remove-generated-file', capability: 'manage-generated-workspace-content', stepId: 'write-workspace-configuration' },
  createGeneratedDirectory: { kind: 'create-remove-generated-directory', capability: 'manage-generated-prefix-content', stepId: 'provision-proton-prefix' },
  createSymlink: { kind: 'create-restore-symlink', capability: 'manage-sdk-symlink', stepId: 'create-sdk-alias' },
  managedDirectoryCopyUnsupported: { kind: 'copy-restore-managed-directory', capability: 'copy-managed-directory', stepId: 'create-build-prefix-copy' },
};
const STATUS_MAP: Record<string, Xcom2SetupOperationStatus> = {
  pending: 'previewed', intentWritten: 'applying', applied: 'applied', rolledBack: 'rolled-back', conflict: 'rollback-conflict',
};

function normalizeBaseline(command: string, response: unknown, value: unknown): NativeBaselineEvidence | undefined {
  if (value === undefined || value === null) return undefined;
  const baseline = object(command, response, value);
  if (integer(command, response, baseline.setupSchemaVersion, 'baseline.setupSchemaVersion') !== 1) throw invalid(command, 'unsupported baseline schema', response);
  const products = array(command, response, baseline.products, 'baseline.products');
  if (products.length !== 2) throw invalid(command, 'baseline must identify the game and SDK', response);
  const normalized = products.map((entry, index) => {
    const product = object(command, response, entry);
    const appId = integer(command, response, product.appId, `baseline.products[${index}].appId`);
    const buildId = safeId(command, response, product.buildId, `baseline.products[${index}].buildId`);
    integer(command, response, product.stateFlags, `baseline.products[${index}].stateFlags`);
    const manifestHash = hash(command, response, product.manifestSha256, `baseline.products[${index}].manifestSha256`).digest;
    integer(command, response, product.manifestBytes, `baseline.products[${index}].manifestBytes`);
    const rootFingerprint = hash(command, response, product.installRootIdentity, `baseline.products[${index}].installRootIdentity`).digest;
    hash(command, response, product.manifestIdentity, `baseline.products[${index}].manifestIdentity`);
    return { appId, buildId, manifestHash, rootFingerprint };
  });
  if (normalized[0]?.appId !== 268_500 || normalized[1]?.appId !== 602_410) throw invalid(command, 'baseline product scope is not the allowlisted game and SDK', response);
  const sdk = normalized[1]!;
  return { sdkBuildId: sdk.buildId, sdkRootFingerprint: sdk.rootFingerprint, sdkManifestHash: sdk.manifestHash };
}

function stateHash(command: string, response: unknown, value: unknown, field: string): Xcom2SetupContentHash | undefined {
  const state = object(command, response, value);
  const type = text(command, response, state.type, `${field}.type`);
  if (!['absent', 'file', 'directory', 'symlink'].includes(type)) throw invalid(command, `invalid file state ${field}`, response);
  if (type === 'file') {
    integer(command, response, state.bytes, `${field}.bytes`);
    return hash(command, response, state.sha256, `${field}.sha256`);
  }
  // Symlink observations may contain an absolute native target. Validate only its
  // bounded scalar shape and discard it; target paths never enter web contracts.
  if (type === 'symlink') text(command, response, state.target, `${field}.target`);
  return undefined;
}

function normalizeOperation(command: string, response: unknown, value: unknown, index: number, baseline?: NativeBaselineEvidence): NormalizedOperation {
  const step = object(command, response, value);
  const rawOperation = object(command, response, step.operation);
  const operationId = safeId(command, response, rawOperation.id, `steps[${index}].operation.id`);
  const rawKind = text(command, response, rawOperation.kind, `steps[${index}].operation.kind`);
  const mapped = OPERATION_MAP[rawKind];
  if (!mapped) throw invalid(command, `unsupported operation kind ${rawKind}`, response);
  const relativePath = safeRelative(command, response, rawOperation.relativePath, `steps[${index}].operation.relativePath`);
  const executable = bool(command, response, rawOperation.executable, `steps[${index}].operation.executable`);
  const status = text(command, response, step.status, `steps[${index}].status`);
  if (!STEP_STATUSES.has(status)) throw invalid(command, `unsupported operation status ${status}`, response);
  integer(command, response, step.checkpoint, `steps[${index}].checkpoint`);
  const originalHash = stateHash(command, response, step.precondition, `steps[${index}].precondition`);
  const resultHash = step.afterState === undefined || step.afterState === null ? undefined : stateHash(command, response, step.afterState, `steps[${index}].afterState`);
  if (step.backup !== undefined && step.backup !== null) {
    const backup = object(command, response, step.backup);
    const backupHash = hash(command, response, backup.contentSha256, `steps[${index}].backup.contentSha256`);
    integer(command, response, backup.bytes, `steps[${index}].backup.bytes`);
    safeRelative(command, response, backup.relativePath, `steps[${index}].backup.relativePath`);
    if (!originalHash || backupHash.digest !== originalHash.digest) throw invalid(command, 'backup hash does not bind original content', response);
  }
  // Native journals deliberately skip serialized generated content and link targets.
  // Seeing either here means the RPC boundary is leaking mutation material.
  if (rawOperation.generatedContent !== undefined || rawOperation.linkTarget !== undefined) throw invalid(command, 'native operation content or target leak', response);
  const supported = executable && rawKind !== 'managedDirectoryCopyUnsupported';
  const targetId = baseline ? `steam-sdk:${baseline.sdkRootFingerprint}` : `steam-sdk-target-${index + 1}`;
  const redactedLabel = baseline ? `XCOM 2 SDK build ${baseline.sdkBuildId}` : 'XCOM 2 SDK managed target';
  const operation: Xcom2SetupOperation = {
    operationId, stepId: mapped.stepId, kind: mapped.kind, capability: mapped.capability,
    summary: baseline ? `Native-managed ${mapped.kind} operation for SDK build ${baseline.sdkBuildId} (manifest ${baseline.sdkManifestHash})` : `Native-managed ${mapped.kind} operation`,
    target: { targetId, scope: 'steam-sdk', redactedLabel },
    support: supported ? 'supported' : 'unsupported',
    ...(supported ? {} : { unsupportedReason: 'Native operation is non-executable or unsupported' }),
    rollbackSupport: supported ? 'conflict-checked' : 'none',
    ...(supported ? {} : { nonReversibleReason: 'Unsupported operations are never applied' }),
    status: STATUS_MAP[status]!,
    journalStatus: status === 'pending' ? 'pending' : status === 'intentWritten' ? 'recorded' : 'validated',
    hashValidationStatus: status === 'conflict' ? 'mismatch' : status === 'pending' || status === 'intentWritten' ? 'pending' : originalHash || resultHash ? 'matched' : 'not-applicable',
    ...(originalHash ? { originalHash } : {}), ...(resultHash ? { resultHash } : {}),
    ...(status === 'conflict' ? { conflictReason: 'Current target no longer matches the journaled result' } : {}),
  };
  const precondition = object(command, response, step.precondition);
  const preconditionType = text(command, response, precondition.type, `steps[${index}].precondition.type`);
  const backupPending = step.backup === undefined || step.backup === null;
  const hasBoundBackup = isRecord(step.backup) && originalHash !== undefined;
  const reversible = rawKind === 'createSymlink'
    ? preconditionType === 'absent' && backupPending
    : (rawKind === 'atomicTextPatch' || rawKind === 'quarantineFile') && originalHash !== undefined && (backupPending || hasBoundBackup);
  return { operation, path: relativePath, rawKind, status, reversible };
}

function validateExecutableScope(command: string, response: unknown, steps: readonly NormalizedOperation[]): boolean {
  if (steps.length !== 15 || steps.some(({ operation, reversible }) => operation.support !== 'supported' || !reversible)) return false;
  const counts = new Map<string, number>();
  for (const step of steps) counts.set(step.rawKind, (counts.get(step.rawKind) ?? 0) + 1);
  if (Object.entries(EXPECTED_OPERATION_COUNTS).some(([kind, count]) => counts.get(kind) !== count) || counts.size !== 3) return false;
  const patchPaths = steps.filter(({ rawKind }) => rawKind === 'atomicTextPatch').map(({ path }) => path);
  const quarantinePaths = steps.filter(({ rawKind }) => rawKind === 'quarantineFile').map(({ path }) => path);
  const links = steps.filter(({ rawKind }) => rawKind === 'createSymlink').map(({ path }) => path);
  const pathsValid = patchPaths.length === PATCH_PATHS.size && patchPaths.every((path) => PATCH_PATHS.has(path))
    && quarantinePaths.every((path) => path.startsWith(TLE_PREFIX) && !path.slice(TLE_PREFIX.length).includes('/'))
    && links.length === 1 && links[0] === COOKED_LINK;
  if (!pathsValid) throw invalid(command, 'operation set escapes the allowlisted external SDK write scope', response);
  return true;
}

function validateState(command: string, response: unknown, rawState: string, executable: boolean, cancelRequested: boolean, statuses: readonly string[]): void {
  if (!executable && !['waiting', 'cancelled'].includes(rawState)) throw invalid(command, 'non-executable transaction entered a mutation state', response);
  if (rawState === 'waiting' && (executable || statuses.some((s) => s !== 'pending'))) throw invalid(command, 'waiting transaction is executable or mutated', response);
  if (rawState === 'prepared' && (!executable || statuses.some((s) => s !== 'pending'))) throw invalid(command, 'prepared transaction has invalid operations', response);
  if (rawState === 'applied' && statuses.some((s) => s !== 'applied')) throw invalid(command, 'applied transaction has incomplete operations', response);
  if (rawState === 'rolledBack' && (statuses.some((s) => !['pending', 'rolledBack'].includes(s)) || !statuses.includes('rolledBack'))) throw invalid(command, 'rolled-back transaction lacks a completed rollback or retains mutations', response);
  if (rawState === 'partial' && !statuses.some((s) => ['intentWritten', 'applied'].includes(s))) throw invalid(command, 'partial transaction lacks a started operation', response);
  if (rawState === 'recoveryRequired' && !statuses.some((s) => ['intentWritten', 'applied', 'conflict'].includes(s))) throw invalid(command, 'recovery-required transaction lacks journaled work', response);
  if (rawState === 'rollbackConflict' && !statuses.includes('conflict')) throw invalid(command, 'rollback conflict lacks a conflicting operation', response);
  if (rawState === 'cancelled' && statuses.some((s) => s !== 'pending')) throw invalid(command, 'cancelled transaction contains mutations', response);
  if (cancelRequested && !['applying', 'rollingBack', 'partial'].includes(rawState)) throw invalid(command, 'impossible cancellation flag', response);
}

function normalizeTransaction(command: string, response: unknown): NormalizedTransaction {
  const item = object(command, response);
  if (integer(command, response, item.schemaVersion, 'schemaVersion') !== 1) throw invalid(command, 'unsupported schema version', response);
  const transactionId = safeId(command, response, item.transactionId, 'transactionId');
  const workspaceId = safeId(command, response, item.workspaceId, 'workspaceId');
  const generation = integer(command, response, item.generation, 'generation');
  const operationDigest = hash(command, response, item.operationDigest, 'operationDigest');
  const rawState = text(command, response, item.state, 'state');
  const state = workflow(command, response, rawState);
  const executable = bool(command, response, item.executable, 'executable');
  const blockers = strings(command, response, item.blockers, 'blockers');
  const cancelRequested = bool(command, response, item.cancelRequested, 'cancelRequested');
  integer(command, response, item.checkpoint, 'checkpoint');
  const error = item.error === undefined || item.error === null ? undefined : exportText(command, response, item.error, 'error');
  const baseline = normalizeBaseline(command, response, item.baseline);
  const steps = array(command, response, item.steps, 'steps').map((step, index) => normalizeOperation(command, response, step, index, baseline));
  const ids = steps.map(({ operation }) => operation.operationId);
  const paths = steps.map(({ path }) => path);
  if (new Set(ids).size !== ids.length || new Set(paths).size !== paths.length) throw invalid(command, 'duplicate operation id or target path', response);
  validateState(command, response, rawState, executable, cancelRequested, steps.map(({ status }) => status));
  const operationScopeValid = validateExecutableScope(command, response, steps);
  if (steps.length > 0 && !operationScopeValid) throw invalid(command, 'transaction lacks the exact 15-operation rollbackable native scope', response);
  if (executable && !baseline) throw invalid(command, 'executable transaction lacks complete native baseline evidence', response);
  const operations = steps.map(({ operation }) => operation);
  const createdAt = timestamp(command, response, item.createdAt, 'createdAt');
  const updatedAt = timestamp(command, response, item.updatedAt, 'updatedAt');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw invalid(command, 'updatedAt precedes createdAt', response);
  const mutated = operations.some((operation) => !['previewed', 'unsupported'].includes(operation.status));
  const rollbackAvailable = executable && operationScopeValid && mutated && ['applying', 'applied', 'partial', 'rolling-back', 'rollback-conflict', 'recovery-required'].includes(state);
  const conflictReasons = state === 'rollback-conflict' ? [error ?? 'Rollback conflicts require review'] : [];
  const recoveryGuidance = state === 'recovery-required' ? [error ?? 'Recover the native journal before continuing'] : [];
  const approved = !['waiting', 'prepared'].includes(rawState);
  const nativeBlockers = blockers.length > 0 ? blockers : executable && rawState === 'prepared' && operationScopeValid ? [] : ['Native transaction evidence is not executable'];
  const evidenceSummary: Xcom2SetupTransactionSummary = {
    transactionId, planId: transactionId, planVersion: XCOM2_SETUP_PLAN_VERSION,
    workspaceId, workspaceGeneration: generation, createdAt, updatedAt, state, executable,
    approvedStepIds: approved ? [...new Set(operations.map((operation) => operation.stepId))] : [],
    approvedOperationIds: approved ? operations.map((operation) => operation.operationId) : [],
    approvedCapabilities: approved ? [...new Set(operations.map((operation) => operation.capability))] : [],
    ...(operations.length > 0 ? { reviewedOperationDigest: operationDigest } : {}),
    journal: { scope: 'local-machine', managedBy: 'native', redactedLocation: 'Native-managed XCOM 2 setup journal' },
    applyAvailability: { allowed: nativeBlockers.length === 0, blockers: nativeBlockers },
    rollbackAvailable, conflictReasons, recoveryGuidance,
  };
  const allowed = canApplyXcom2SetupTransaction(evidenceSummary);
  const summary: Xcom2SetupTransactionSummary = {
    ...evidenceSummary,
    applyAvailability: { allowed, blockers: allowed ? [] : nativeBlockers },
  };
  const externalActions: readonly Xcom2SetupExternalAction[] = [];
  return { detail: { ...summary, operations, externalActions }, rawState, executable, operationDigest: operationDigest.digest };
}

function failure(command: string, error: unknown): Xcom2SetupFailure {
  const normalized = toTauriAdapterError(command, error);
  const nativeMessage = normalized.message.toLowerCase();
  if (nativeMessage.includes('build, manifest, or canonical install identity changed')) {
    return {
      code: 'stale-plan',
      message: 'The native Steam build fingerprint changed after preparation',
      recoveryGuidance: ['Prepare and review a fresh native XCOM 2 setup transaction'],
    };
  }
  if (nativeMessage.includes('digest')) {
    return { code: 'operation-digest-mismatch', message: 'The native transaction digest was rejected', recoveryGuidance: ['Review a freshly prepared native transaction'] };
  }
  // Native failures can contain filesystem paths. Never forward their payload.
  return { code: 'native-unavailable', message: `Native XCOM 2 transaction command ${command} failed`, recoveryGuidance: ['Retry after the native desktop service is available'] };
}

function nativeRecoveryStrategy(strategy: unknown): Xcom2SetupRecoverRequest['strategy'] {
  switch (strategy) {
    case 'resume-rollback': return 'resume-rollback';
    case 'retry-rollback': return 'retry-rollback';
    case 'verify-journal': return 'verify-journal';
    default: throw new TauriAdapterError(COMMANDS.recover, `Unsupported XCOM 2 recovery strategy: ${String(strategy)}`, strategy);
  }
}

export class TauriXcom2SetupAdapter implements Xcom2SetupPort {
  private readonly subscriptions = new Map<number, Subscription>();
  private readonly current = new Map<string, { workspaceId: string; generation: number; operationDigest: string; detail: Xcom2SetupTransactionDetail }>();
  private readonly pollIntervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly pollLimit: number;
  private nextId = 0;
  private sequence = 0;
  private failures = 0;
  private polling = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: Xcom2SetupPollOptions = {}) {
    this.pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 250);
    this.maxBackoffMs = Math.max(this.pollIntervalMs, options.maxBackoffMs ?? 5_000);
    this.pollLimit = Math.min(MAX_ITEMS, Math.max(1, Math.floor(options.pollLimit ?? 64)));
  }

  private remember(value: NormalizedTransaction): Xcom2SetupTransactionDetail {
    this.current.set(value.detail.transactionId, { workspaceId: value.detail.workspaceId, generation: value.detail.workspaceGeneration, operationDigest: value.operationDigest, detail: value.detail });
    return value.detail;
  }
  private async transaction(command: string, args?: Record<string, unknown>): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    try { return { ok: true, value: this.remember(normalizeTransaction(command, await invokeTauri<unknown>(command, args))) }; }
    catch (error) { if (error instanceof TauriAdapterError && error.message.includes(`Invalid ${command} response`)) throw error; return { ok: false, error: failure(command, error) }; }
  }

  prepare(_request: Xcom2SetupPrepareRequest): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    return this.transaction(COMMANDS.prepare);
  }
  async approve(request: Xcom2SetupApproveRequest): Promise<Xcom2SetupResult<Xcom2SetupApproval>> {
    try {
      const digest = hash('approve_xcom2_setup_transaction', request, request.reviewedOperationDigest.digest, 'reviewedOperationDigest');
      if (request.reviewedOperationDigest.algorithm !== 'sha256') throw invalid('approve_xcom2_setup_transaction', 'invalid digest algorithm', request);
      const known = this.current.get(request.transactionId);
      if (known) {
        const sameSet = (left: readonly string[], right: readonly string[]) => left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item));
        const expectedSteps = [...new Set(known.detail.operations.map((operation) => operation.stepId))];
        const expectedOperations = known.detail.operations.map((operation) => operation.operationId);
        const expectedCapabilities = [...new Set(known.detail.operations.map((operation) => operation.capability))];
        if (request.planId !== known.detail.planId || request.planVersion !== known.detail.planVersion || request.workspaceId !== known.workspaceId || request.workspaceGeneration !== known.generation || digest.digest !== known.operationDigest || !sameSet(request.approvedStepIds, expectedSteps) || !sameSet(request.approvedOperationIds, expectedOperations) || !sameSet(request.approvedCapabilities, expectedCapabilities)) {
          throw invalid('approve_xcom2_setup_transaction', 'approval does not exactly bind the native transaction', request);
        }
      }
      return { ok: true, value: { approvalToken: digest.digest, transactionId: request.transactionId, planId: request.planId, workspaceId: request.workspaceId, workspaceGeneration: request.workspaceGeneration, reviewedOperationDigest: digest } };
    } catch (error) {
      if (error instanceof TauriAdapterError) throw error;
      return { ok: false, error: failure('approve_xcom2_setup_transaction', error) };
    }
  }
  apply(request: Xcom2SetupApplyRequest): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    if (!SHA256.test(request.approvalToken)) throw invalid(COMMANDS.apply, 'approval token must be the exact sha256 operation digest', request);
    const known = this.current.get(request.transactionId);
    if (known && known.operationDigest !== request.approvalToken.toLowerCase()) throw invalid(COMMANDS.apply, 'approval digest does not match the native transaction', request);
    if (known && !canApplyXcom2SetupTransaction(known.detail)) throw invalid(COMMANDS.apply, 'native transaction evidence does not allow apply', request);
    return this.transaction(COMMANDS.apply, { transactionId: request.transactionId, approvalDigest: request.approvalToken.toLowerCase() });
  }
  getTransaction(request: Xcom2SetupGetTransactionRequest): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    return this.transaction(COMMANDS.get, { transactionId: request.transactionId });
  }
  async listTransactions(request: Xcom2SetupListTransactionsRequest): Promise<Xcom2SetupResult<Xcom2SetupTransactionList>> {
    const limit = Math.min(64, Math.max(1, Math.floor(request.limit ?? 64)));
    try {
      const response = await invokeTauri<unknown>(COMMANDS.list, { limit });
      const values = array(COMMANDS.list, response, response, 'transactions').map((value) => this.remember(normalizeTransaction(COMMANDS.list, value)));
      const filtered = values.filter((value) => value.workspaceId === request.workspaceId && (!request.states || request.states.includes(value.state)));
      return { ok: true, value: { transactions: filtered } };
    } catch (error) {
      if (error instanceof TauriAdapterError && error.message.includes(`Invalid ${COMMANDS.list} response`)) throw error;
      return { ok: false, error: failure(COMMANDS.list, error) };
    }
  }
  cancel(request: Xcom2SetupCancelRequest): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> { return this.transaction(COMMANDS.cancel, { transactionId: request.transactionId }); }
  rollback(request: Xcom2SetupRollbackRequest): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> { return this.transaction(COMMANDS.rollback, { transactionId: request.transactionId }); }
  recover(request: Xcom2SetupRecoverRequest): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    const strategy = nativeRecoveryStrategy(request.strategy);
    return this.transaction(COMMANDS.recover, { transactionId: request.transactionId, strategy });
  }

  subscribe(filter: Xcom2SetupSubscription, listener: Xcom2SetupEventListener): () => void {
    const id = ++this.nextId;
    const subscription: Subscription = { active: true, filter, listener };
    this.subscriptions.set(id, subscription);
    if (this.subscriptions.size === 1) this.schedule(0);
    return () => {
      if (!subscription.active) return;
      subscription.active = false;
      this.subscriptions.delete(id);
      if (this.subscriptions.size === 0 && this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    };
  }
  private schedule(delay: number): void {
    if (this.subscriptions.size === 0 || this.polling || this.timer !== undefined) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.poll(); }, delay);
  }
  private normalizeEvent(response: unknown, value: unknown): { event: Xcom2SetupTransactionEvent; workspaceId: string; generation: number } {
    const item = object(COMMANDS.poll, response, value);
    const sequence = integer(COMMANDS.poll, response, item.sequence, 'event.sequence');
    const workspaceId = safeId(COMMANDS.poll, response, item.workspaceId, 'event.workspaceId');
    const generation = integer(COMMANDS.poll, response, item.generation, 'event.generation');
    const transactionId = safeId(COMMANDS.poll, response, item.transactionId, 'event.transactionId');
    const rawState = text(COMMANDS.poll, response, item.state, 'event.state');
    const state = workflow(COMMANDS.poll, response, rawState);
    const operationIdText = optionalText(COMMANDS.poll, response, item.operationId, 'event.operationId');
    const operationId = operationIdText === undefined ? undefined : safeId(COMMANDS.poll, response, operationIdText, 'event.operationId');
    if (item.step !== undefined && item.step !== null) integer(COMMANDS.poll, response, item.step, 'event.step');
    const message = exportText(COMMANDS.poll, response, item.message, 'event.message');
    const terminal = ['applied', 'rolled-back', 'rollback-conflict', 'cancelled', 'recovery-required'].includes(state);
    const operationStatus: Xcom2SetupOperationStatus | undefined = operationId === undefined ? undefined : ({ applying: 'applying', applied: 'applied', 'rolling-back': 'rolling-back', 'rolled-back': 'rolled-back', 'rollback-conflict': 'rollback-conflict' } as Partial<Record<Xcom2SetupWorkflowState, Xcom2SetupOperationStatus>>)[state];
    return { workspaceId, generation, event: { transactionId, sequence, occurredAt: new Date().toISOString(), kind: operationId ? 'operation-progress' : terminal ? 'terminal' : 'transaction-state', state, terminal, ...(operationId ? { operationId } : {}), ...(operationStatus ? { operationStatus } : {}), message } };
  }
  private emit(event: Xcom2SetupTransactionEvent, workspaceId: string, generation: number): void {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active || subscription.filter.transactionId && subscription.filter.transactionId !== event.transactionId || subscription.filter.workspaceId && subscription.filter.workspaceId !== workspaceId) continue;
      const known = this.current.get(event.transactionId);
      if (known && (known.workspaceId !== workspaceId || generation < known.generation)) continue;
      try { subscription.listener(event); } catch { /* Listener errors do not stop native polling. */ }
    }
  }
  private async poll(): Promise<void> {
    if (this.polling || this.subscriptions.size === 0) return;
    this.polling = true;
    try {
      const response = await invokeTauri<unknown>(COMMANDS.poll, { afterSequence: this.sequence, limit: this.pollLimit });
      const events = array(COMMANDS.poll, response, response, 'events');
      let previous = this.sequence;
      for (const value of events) {
        const event = this.normalizeEvent(response, value);
        if (event.event.sequence <= this.sequence) continue;
        if (event.event.sequence <= previous) throw invalid(COMMANDS.poll, 'events are not monotonically sequenced', response);
        previous = event.event.sequence;
        this.sequence = event.event.sequence;
        this.emit(event.event, event.workspaceId, event.generation);
      }
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      void toTauriAdapterError(COMMANDS.poll, error);
    } finally {
      this.polling = false;
      const delay = Math.min(this.maxBackoffMs, this.pollIntervalMs * (2 ** Math.min(this.failures, 5)));
      this.schedule(delay);
    }
  }
}
