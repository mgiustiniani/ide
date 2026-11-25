// ---------------------------------------------------------------------------
// @ide/ui – SettingsPanel
// Windows Settings-inspired modal for IDE settings, including optional Pi Agent
// configuration and status. Presentation-only: integrations are controlled by
// callbacks supplied by the consuming app/adapter layer.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  PiAgentInstallResult,
  PiAgentIntegration,
  PiAgentSettings,
  PiAgentSettingsUpdate,
  PiAgentStatus,
  LanguageServiceStatus,
  RefactorKitCapabilities,
  RefactorKitStatus,
  WorkspaceInfo,
  WorkspaceRegistry,
  Xcom2ModuleConfigurationDiagnosticPresentation,
  Xcom2SetupMonitorSnapshot,
  Xcom2SetupPlan,
  Xcom2SetupTransactionDetail,
  Xcom2SetupTransactionEvent,
  Xcom2SetupTransactionSummary,
  WorkspaceEditorPreferences,
} from "@ide/contracts";
import { DEFAULT_PI_AGENT_SETTINGS, DEFAULT_WORKSPACE_EDITOR_PREFERENCES } from "@ide/contracts";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import {
  JavaIntelligencePanel,
  type LanguageToolingDiagnosticsPresentation,
} from "../JavaIntelligencePanel";
import { Xcom2SetupPanel } from "../Xcom2SetupPanel";
import { Xcom2ModuleConfigurationDiagnosticAlert } from "../Xcom2ModuleConfigurationDiagnosticAlert";

export type SettingsPanelSection = "ai-agents" | "java" | "xcom2" | "workspace" | "editor";
export type SettingsPanelAction =
  "close" | "refresh" | "refresh-workspace" | "switch-workspace" | "save" | "install";

export interface SettingsPanelProps {
  /** Controls whether the modal/panel is rendered. Defaults to true. */
  isOpen?: boolean;
  /** Current persisted Pi Agent settings. */
  aiAgentSettings?: PiAgentSettings;
  /** Current Pi Agent runtime status. */
  aiAgentStatus?: PiAgentStatus | null;
  /** Current workspace metadata supplied by the host app. */
  workspaceInfo?: WorkspaceInfo | null;
  /** Current workspace-scoped indentation used by Monaco and Java formatting requests. */
  workspaceEditorPreferences?: WorkspaceEditorPreferences;
  /** Preference read/write failure supplied by the host app. */
  workspaceEditorPreferencesError?: string | null;
  /** User-level registry of known workspaces supplied by the host app. */
  workspaceRegistry?: WorkspaceRegistry | null;
  /** Workspace adapter or registry error to display. */
  workspaceError?: string | null;
  /** Safe host-supplied presentation for an XCOM 2 project configuration stop. */
  xcom2ModuleConfigurationDiagnosticPresentation?: Readonly<Xcom2ModuleConfigurationDiagnosticPresentation> | null;
  /** Whether the host is checking the current XCOM 2 project configuration. */
  isXcom2ModuleConfigurationChecking?: boolean;
  /** Host-managed global Eclipse JDT LS lifecycle and capability status. */
  javaLanguageServiceStatus?: LanguageServiceStatus | null;
  /** Whether Java language-service status is being refreshed. */
  isJavaLanguageServiceRefreshing?: boolean;
  /** Persisted JDK home used to launch JDT LS, independent of the project JDK. */
  javaLanguageServerRuntimeJdkHome?: string;
  javaLanguageServerRuntimePreferenceError?: string | null;
  /** Host-managed global RefactorKit availability. */
  javaRefactorKitStatus?: RefactorKitStatus | null;
  /** Backend-reported RefactorKit language capability discovery. */
  javaRefactorKitCapabilities?: RefactorKitCapabilities | null;
  /** Whether RefactorKit availability is being checked. */
  isJavaRefactorKitChecking?: boolean;
  /** RefactorKit availability error supplied by the host. */
  javaRefactorKitError?: string | null;
  /** Closed provider-neutral compiler-diagnostics state supplied by the host controller. */
  languageToolingDiagnostics?: LanguageToolingDiagnosticsPresentation | null;
  /** Latest host-provided XCOM 2 machine setup snapshot. */
  xcom2SetupSnapshot?: Xcom2SetupMonitorSnapshot | null;
  /** Whether the XCOM 2 setup state is currently loading. */
  isXcom2SetupLoading?: boolean;
  /** Whether the displayed XCOM 2 setup snapshot may be stale. */
  isXcom2SetupStale?: boolean;
  /** XCOM 2 setup monitor error supplied by the host. */
  xcom2SetupError?: string | null;
  /** Latest host-generated, dry-run-only XCOM 2 setup plan. */
  xcom2SetupPlan?: Xcom2SetupPlan | null;
  /** Current native-owned rollbackable setup transaction. */
  xcom2SetupTransaction?: Xcom2SetupTransactionDetail | null;
  /** Native transaction history for the current workspace. */
  xcom2SetupTransactions?: readonly Xcom2SetupTransactionSummary[];
  isXcom2SetupTransactionLoading?: boolean;
  xcom2SetupTransactionError?: string | null;
  xcom2SetupTransactionProgressEvent?: Xcom2SetupTransactionEvent | null;
  /** Additional class names applied to the modal panel. */
  className?: string;
  /** Called when the user closes the panel. */
  onClose?: () => void | Promise<void>;
  /** Refreshes Pi Agent status. Return the updated status when available. */
  onRefreshStatus?: () => PiAgentStatus | void | Promise<PiAgentStatus | void>;
  /** Saves Pi Agent settings. Return normalized persisted settings when available. */
  onSaveAiAgentSettings?: (
    settings: PiAgentSettingsUpdate,
  ) => PiAgentSettings | void | Promise<PiAgentSettings | void>;
  /** Installs or bootstraps the optional Pi Agent package through the host adapter. */
  onInstallPiAgent?: () => PiAgentInstallResult | void | Promise<PiAgentInstallResult | void>;
  /** Refreshes workspace metadata through the host app. */
  onRefreshWorkspace?: () => void | Promise<void>;
  /** Persists indentation preferences for the current workspace. */
  onChangeWorkspaceEditorPreferences?: (preferences: WorkspaceEditorPreferences) => void;
  /** Opens the native XML picker and returns a path relative to the current workspace. */
  onSelectWorkspaceFormatterProfile?: () => Promise<string | null>;
  /** Lists the usable profile names in saved workspace XML. */
  onListWorkspaceFormatterProfiles?: (path: string) => Promise<readonly string[]>;
  /** Opens the currently selected workspace formatter XML in the regular editor. */
  onOpenWorkspaceFormatterProfile?: (path: string) => Promise<void>;
  /** Switches to a known workspace through the host app. */
  onSwitchWorkspace?: (workspaceId: string) => void | Promise<void>;
  /** Starts the host-managed global Java language service. */
  onStartJavaLanguageService?: () => void | Promise<void>;
  /** Stops the host-managed global Java language service. */
  onStopJavaLanguageService?: () => void | Promise<void>;
  /** Restarts the host-managed global Java language service. */
  onRestartJavaLanguageService?: () => void | Promise<void>;
  /** Persists the JDT LS process runtime JDK preference. */
  onSaveJavaLanguageServerRuntimeJdkHome?: (home: string) => boolean;
  /** Refreshes Java language-service status. */
  onRefreshJavaLanguageService?: () => void | Promise<void>;
  /** Requests the host-owned JDT LS setup flow. */
  onSetupJavaLanguageService?: () => void | Promise<void>;
  /** Refreshes global RefactorKit availability. */
  onRefreshJavaRefactorKit?: () => void | Promise<void>;
  /** Requests host-owned compiler diagnostics for the current authorized source snapshot. */
  onRequestLanguageToolingDiagnostics?: () => void | Promise<void>;
  /** Refreshes global XCOM 2 machine, Steam, and SDK setup state. */
  onRefreshXcom2Setup?: () => void | Promise<void>;
  /** Requests a host-owned, dry-run-only XCOM 2 setup plan. */
  onPlanXcom2Setup?: () => void | Promise<void>;
  onPrepareXcom2Setup?: () => void | Promise<void>;
  onApplyXcom2Setup?: (transactionId: string, approvalDigest: string) => void | Promise<void>;
  onCancelXcom2Setup?: (transactionId: string) => void | Promise<void>;
  onRollbackXcom2Setup?: (transactionId: string) => void | Promise<void>;
  onRecoverXcom2Setup?: (transactionId: string) => void | Promise<void>;
  onRefreshXcom2SetupHistory?: () => void | Promise<void>;
}

interface PiAgentSettingsDraft {
  enabled: boolean;
}

interface FeedbackMessage {
  tone: "success" | "error";
  text: string;
}

const DETECTION_INTEGRATIONS: PiAgentIntegration[] = ["rpc", "cli", "sdk"];

const TAB_ITEMS: Array<{
  id: SettingsPanelSection;
  label: string;
  description: string;
  disabled?: boolean;
}> = [
  {
    id: "ai-agents",
    label: "AI Agents",
    description: "Pi Agent provider and status",
  },
  {
    id: "java",
    label: "Languages",
    description: "Language tooling",
  },
  {
    id: "xcom2",
    label: "XCOM 2",
    description: "Global machine setup",
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Workspace metadata",
  },
  {
    id: "editor",
    label: "Editor",
    description: "Workspace editing defaults",
  },
];

function toDraft(settings?: PiAgentSettings): PiAgentSettingsDraft {
  const source: PiAgentSettings = settings ?? { ...DEFAULT_PI_AGENT_SETTINGS };

  return {
    enabled: source.enabled,
  };
}

function toUpdate(draft: PiAgentSettingsDraft): PiAgentSettingsUpdate {
  return {
    provider: "pi",
    enabled: draft.enabled,
    preferredIntegration: "rpc",
    fallbackIntegrations: [],
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "The requested Settings action failed.";
}

function getAvailabilityTone(status?: PiAgentStatus | null): string {
  if (!status)
    return "bg-[var(--surface-panel)] text-[var(--text-secondary)] border-[var(--border-default)]";
  if (status.available) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status.availability === "not-installed")
    return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (status.availability === "error") return "bg-red-500/15 text-red-300 border-red-500/30";
  return "bg-[var(--surface-panel)] text-[var(--text-secondary)] border-[var(--border-default)]";
}

function formatDateTime(value?: string): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validFormatterProfileDraft(path: string, profileName: string): boolean {
  const normalizedPath = path.trim();
  const normalizedName = profileName.trim();
  if (!normalizedPath && !normalizedName) return true;
  return Boolean(
    normalizedPath &&
    normalizedName &&
    normalizedPath === path &&
    normalizedName === profileName &&
    normalizedPath.length <= 4096 &&
    normalizedPath.toLowerCase().endsWith(".xml") &&
    !normalizedPath.startsWith("/") &&
    !/^[A-Za-z]:/.test(normalizedPath) &&
    !/[\u0000-\u001f\u007f]/.test(normalizedPath) &&
    !normalizedPath
      .replace(/\\/g, "/")
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") &&
    normalizedName.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(normalizedName),
  );
}

function hasAvailableIntegrationProbe(metadata?: Record<string, unknown>): boolean {
  if (!metadata) return false;

  return DETECTION_INTEGRATIONS.some((integration) => {
    const probe = metadata[integration];
    return isRecord(probe) && probe.available === true;
  });
}

function isPiAgentDetected(status?: PiAgentStatus | null): boolean {
  return Boolean(
    status &&
    (status.available ||
      status.activeIntegration ||
      status.version ||
      hasAvailableIntegrationProbe(status.metadata)),
  );
}

function StatusRow({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-editor)] p-3">
      <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function WorkspaceListItem({
  workspace,
  isCurrent,
  isSwitchDisabled,
  isSwitching,
  onSwitch,
}: {
  workspace: WorkspaceInfo;
  isCurrent: boolean;
  isSwitchDisabled: boolean;
  isSwitching: boolean;
  onSwitch: (workspaceId: string) => void;
}): JSX.Element {
  return (
    <li className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-editor)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words text-sm font-medium text-[var(--text-primary)]">
          {workspace.name}
        </span>
        {isCurrent ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-200">
            Current
          </span>
        ) : (
          <Button
            aria-label={`Switch to ${workspace.name}`}
            disabled={isSwitchDisabled}
            isLoading={isSwitching}
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => onSwitch(workspace.id)}
          >
            Switch
          </Button>
        )}
      </div>
      <p className="mt-1 break-all text-xs text-[var(--text-secondary)]">{workspace.rootPath}</p>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Last opened: {formatDateTime(workspace.lastOpenedAt)}
      </p>
    </li>
  );
}

export function SettingsPanel({
  isOpen = true,
  aiAgentSettings,
  aiAgentStatus,
  workspaceInfo,
  workspaceEditorPreferences = DEFAULT_WORKSPACE_EDITOR_PREFERENCES,
  workspaceEditorPreferencesError,
  workspaceRegistry,
  workspaceError,
  xcom2ModuleConfigurationDiagnosticPresentation,
  isXcom2ModuleConfigurationChecking = false,
  javaLanguageServiceStatus,
  isJavaLanguageServiceRefreshing = false,
  javaLanguageServerRuntimeJdkHome,
  javaLanguageServerRuntimePreferenceError,
  javaRefactorKitStatus,
  javaRefactorKitCapabilities,
  isJavaRefactorKitChecking = false,
  javaRefactorKitError,
  languageToolingDiagnostics,
  xcom2SetupSnapshot,
  isXcom2SetupLoading = false,
  isXcom2SetupStale = false,
  xcom2SetupError,
  xcom2SetupPlan,
  xcom2SetupTransaction,
  xcom2SetupTransactions,
  isXcom2SetupTransactionLoading = false,
  xcom2SetupTransactionError,
  xcom2SetupTransactionProgressEvent,
  className,
  onClose,
  onRefreshStatus,
  onSaveAiAgentSettings,
  onInstallPiAgent,
  onRefreshWorkspace,
  onChangeWorkspaceEditorPreferences,
  onSelectWorkspaceFormatterProfile,
  onListWorkspaceFormatterProfiles,
  onOpenWorkspaceFormatterProfile,
  onSwitchWorkspace,
  onStartJavaLanguageService,
  onStopJavaLanguageService,
  onRestartJavaLanguageService,
  onSaveJavaLanguageServerRuntimeJdkHome,
  onRefreshJavaLanguageService,
  onSetupJavaLanguageService,
  onRefreshJavaRefactorKit,
  onRequestLanguageToolingDiagnostics,
  onRefreshXcom2Setup,
  onPlanXcom2Setup,
  onPrepareXcom2Setup,
  onApplyXcom2Setup,
  onCancelXcom2Setup,
  onRollbackXcom2Setup,
  onRecoverXcom2Setup,
  onRefreshXcom2SetupHistory,
}: SettingsPanelProps): JSX.Element | null {
  const [activeSection, setActiveSection] = useState<SettingsPanelSection>("ai-agents");
  const [draft, setDraft] = useState<PiAgentSettingsDraft>(() => toDraft(aiAgentSettings));
  const [status, setStatus] = useState<PiAgentStatus | null>(aiAgentStatus ?? null);
  const [pendingAction, setPendingAction] = useState<SettingsPanelAction | null>(null);
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const [workspaceFeedback, setWorkspaceFeedback] = useState<FeedbackMessage | null>(null);
  const [formatterProfileDraft, setFormatterProfileDraft] = useState({ path: "", profileName: "" });
  const [formatterPickerBusy, setFormatterPickerBusy] = useState(false);
  const [formatterPickerError, setFormatterPickerError] = useState<string | null>(null);
  const [formatterLookup, setFormatterLookup] = useState<{
    path: string;
    workspaceId: string | undefined;
    names?: readonly string[];
    error?: string;
  } | null>(null);
  const currentFormatterLookup = formatterLookup?.path === formatterProfileDraft.path.trim() &&
    formatterLookup.workspaceId === workspaceInfo?.id ? formatterLookup : null;
  const [formatterProfileOpenBusy, setFormatterProfileOpenBusy] = useState(false);
  const [formatterProfileOpenError, setFormatterProfileOpenError] = useState<string | null>(null);
  const [formatterProfileOpenStatus, setFormatterProfileOpenStatus] = useState<string | null>(null);

  useEffect(() => {
    setDraft(toDraft(aiAgentSettings));
  }, [aiAgentSettings]);

  useEffect(() => {
    setStatus(aiAgentStatus ?? null);
  }, [aiAgentStatus]);

  useEffect(() => {
    setFormatterProfileDraft({
      path: workspaceEditorPreferences?.javaFormatterProfile?.path ?? "",
      profileName: workspaceEditorPreferences?.javaFormatterProfile?.profileName ?? "",
    });
    setFormatterPickerError(null);
    setFormatterLookup(null);
    setFormatterProfileOpenError(null);
    setFormatterProfileOpenStatus(null);
  }, [
    workspaceInfo?.id,
    workspaceEditorPreferences?.javaFormatterProfile?.path,
    workspaceEditorPreferences?.javaFormatterProfile?.profileName,
  ]);

  useEffect(() => {
    if (!isOpen || !onClose) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        void handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // handleClose is intentionally not a dependency so Escape behavior only
    // follows the current open/close callback contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose]);

  const isBusy = pendingAction !== null;
  const currentStatus = status;
  const statusBadgeText = currentStatus?.availability ?? "not checked";
  const piAgentDetected = isPiAgentDetected(currentStatus);
  const canInstallPiAgent = Boolean(
    onInstallPiAgent &&
    !isBusy &&
    !piAgentDetected &&
    currentStatus?.availability === "not-installed",
  );
  const installButtonLabel = piAgentDetected ? "Pi Agent detected" : "Install Pi Agent";

  const normalizedSettings = useMemo(() => toUpdate(draft), [draft]);
  const knownWorkspaces = workspaceRegistry?.workspaces ?? [];
  const visibleWorkspaces = knownWorkspaces.slice(0, 6);
  const currentWorkspaceId = workspaceInfo?.id ?? workspaceRegistry?.currentWorkspaceId ?? null;
  const activeTab = TAB_ITEMS.find((tab) => tab.id === activeSection);
  const sectionTitle = activeTab?.label ?? "Settings";
  const sectionDescription =
    activeSection === "ai-agents"
      ? "Inspect the Pi runtime used by the native Agent screen and manage legacy RPC compatibility."
      : activeSection === "java"
        ? "Inspect language capability discovery and manage provider-specific language tooling. Eclipse JDT LS controls remain Java-specific."
        : activeSection === "xcom2"
          ? "Manage global machine setup. Project tools will activate only for detected or configured XCOM modules (future capability)."
          : activeSection === "editor"
            ? "Set workspace-specific indentation defaults used by the editor and Java formatting commands."
            : "View current workspace metadata and the user workspace registry.";

  if (!isOpen) return null;

  async function handleClose(): Promise<void> {
    if (!onClose) return;
    setPendingAction("close");
    setFeedback(null);
    try {
      await onClose();
    } catch (error) {
      setFeedback({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRefreshStatus(): Promise<void> {
    if (!onRefreshStatus) return;
    setPendingAction("refresh");
    setFeedback(null);
    try {
      const nextStatus = await onRefreshStatus();
      if (nextStatus) setStatus(nextStatus);
      setFeedback({ tone: "success", text: "Pi Agent status refreshed." });
    } catch (error) {
      setFeedback({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSaveSettings(): Promise<void> {
    if (!onSaveAiAgentSettings) return;
    setPendingAction("save");
    setFeedback(null);
    try {
      const savedSettings = await onSaveAiAgentSettings(normalizedSettings);
      if (savedSettings) setDraft(toDraft(savedSettings));
      setFeedback({ tone: "success", text: "Pi Agent settings saved." });
    } catch (error) {
      setFeedback({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleInstallPiAgent(): Promise<void> {
    if (!onInstallPiAgent) return;
    if (piAgentDetected) {
      setFeedback({
        tone: "success",
        text: "Pi Agent is already detected. Installation is disabled.",
      });
      return;
    }
    setPendingAction("install");
    setFeedback(null);
    try {
      const result = await onInstallPiAgent();
      const defaultMessage = result?.success
        ? "Pi Agent package installed or verified."
        : "Pi Agent installation finished.";
      setFeedback({
        tone: result && !result.success ? "error" : "success",
        text: result?.message ?? defaultMessage,
      });
    } catch (error) {
      setFeedback({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRefreshWorkspace(): Promise<void> {
    if (!onRefreshWorkspace) return;
    setPendingAction("refresh-workspace");
    setWorkspaceFeedback(null);
    try {
      await onRefreshWorkspace();
      setWorkspaceFeedback({ tone: "success", text: "Workspace refreshed." });
    } catch (error) {
      setWorkspaceFeedback({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSwitchWorkspace(workspaceId: string): Promise<void> {
    if (!onSwitchWorkspace || workspaceId === currentWorkspaceId) return;
    const workspaceName =
      knownWorkspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId;
    setPendingAction("switch-workspace");
    setPendingWorkspaceId(workspaceId);
    setWorkspaceFeedback(null);
    try {
      await onSwitchWorkspace(workspaceId);
      setWorkspaceFeedback({ tone: "success", text: `Switched to ${workspaceName}.` });
    } catch (error) {
      setWorkspaceFeedback({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setPendingAction(null);
      setPendingWorkspaceId(null);
    }
  }

  const panelCls = [
    "grid h-[min(760px,calc(100vh-2rem))] w-[min(1040px,calc(100vw-2rem))] grid-cols-[260px_minmax(0,1fr)] overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-background)] text-[var(--text-primary)] shadow-2xl",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="dark fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <section
        aria-labelledby="settings-panel-title"
        aria-modal="true"
        className={panelCls}
        role="dialog"
      >
        <aside className="flex min-h-0 flex-col border-r border-[var(--border-default)] bg-[var(--surface-sidebar)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-5 py-4">
            <Icon type="settings" className="text-[var(--text-accent)]" />
            <div>
              <h2
                id="settings-panel-title"
                className="text-lg font-semibold text-[var(--text-primary)]"
              >
                Settings
              </h2>
              <p className="text-xs text-[var(--text-muted)]">IDE preferences</p>
            </div>
          </div>

          <nav aria-label="Settings sections" className="flex-1 overflow-y-auto p-3">
            <div className="space-y-1" role="tablist" aria-orientation="vertical">
              {TAB_ITEMS.map((tab) => {
                const isActive = tab.id === activeSection;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-disabled={tab.disabled ? "true" : undefined}
                    aria-selected={isActive}
                    className={[
                      "w-full rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]",
                      isActive
                        ? "border-[var(--border-active)] bg-[var(--highlight-bg)] text-[var(--text-primary)]"
                        : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)]",
                      tab.disabled
                        ? "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-[var(--text-secondary)]"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={tab.disabled}
                    role="tab"
                    onClick={() => setActiveSection(tab.id)}
                  >
                    <span className="block text-sm font-medium">{tab.label}</span>
                    <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                      {tab.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        </aside>

        <main className="flex min-h-0 flex-col bg-[var(--surface-background)]">
          <header className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-header)] px-6 py-4">
            <div>
              <h3 className="text-xl font-semibold text-[var(--text-primary)]">{sectionTitle}</h3>
              <p className="text-sm text-[var(--text-secondary)]">{sectionDescription}</p>
            </div>
            <Button
              aria-label="Close settings"
              disabled={isBusy && pendingAction !== "close"}
              isLoading={pendingAction === "close"}
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => void handleClose()}
            >
              <Icon type="close" />
            </Button>
          </header>

          <div
            className={[
              "min-h-0 flex-1 p-6",
              activeSection === "xcom2" || activeSection === "java"
                ? "overflow-hidden"
                : "overflow-y-auto",
            ].join(" ")}
          >
            {activeSection === "ai-agents" ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-5">
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-[var(--text-primary)]">
                        Pi Agent runtime
                      </h4>
                      <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
                        The Agent screen embeds Pi's real interactive TUI through a workspace PTY.
                        Legacy RPC settings do not own that conversation.
                      </p>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-3 rounded-full border border-[var(--border-default)] bg-[var(--surface-editor)] px-3 py-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        Legacy RPC
                      </span>
                      <input
                        aria-label="Enable legacy Pi Agent RPC compatibility"
                        checked={draft.enabled}
                        className="sr-only"
                        disabled={isBusy}
                        type="checkbox"
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, enabled: event.target.checked }))
                        }
                      />
                      <span
                        aria-hidden="true"
                        className={[
                          "relative h-5 w-9 rounded-full transition-colors",
                          draft.enabled ? "bg-[var(--accent-green)]" : "bg-[var(--input-bg)]",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                            draft.enabled ? "translate-x-4" : "translate-x-0.5",
                          ].join(" ")}
                        />
                      </span>
                    </label>
                  </div>

                  <div className="grid gap-4">
                    <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
                      <h5 className="text-sm font-semibold text-sky-100">Native Agent authority</h5>
                      <p className="mt-1 text-sm text-sky-100/80">
                        Chat, history, tools, models, commands, extensions, trust, and compaction
                        stay inside the interactive Pi TUI. RPC is retained only as a legacy
                        compatibility setting.
                      </p>
                    </div>
                  </div>
                </section>

                <aside className="grid gap-5">
                  <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-base font-semibold text-[var(--text-primary)]">
                          Status
                        </h4>
                        <p className="text-sm text-[var(--text-secondary)]">
                          Runtime availability reported by the host.
                        </p>
                      </div>
                      <span
                        className={[
                          "rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
                          getAvailabilityTone(currentStatus),
                        ].join(" ")}
                      >
                        {statusBadgeText}
                      </span>
                    </div>

                    <dl className="grid gap-3">
                      <StatusRow label="Status" value={statusBadgeText} />
                      <StatusRow label="Version" value={currentStatus?.version ?? "Unknown"} />
                      <StatusRow label="Agent presentation" value="Native Pi TUI / PTY" />
                      <StatusRow
                        label="Checked at"
                        value={formatDateTime(currentStatus?.checkedAt)}
                      />
                      <StatusRow label="Last error" value={currentStatus?.lastError ?? "None"} />
                    </dl>
                  </section>

                  <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-5">
                    <h4 className="text-base font-semibold text-[var(--text-primary)]">
                      Install Pi Agent
                    </h4>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">
                      Installation is available only when status reports Pi Agent as not installed.
                    </p>
                    {piAgentDetected ? (
                      <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                        Pi Agent is already installed or detected by the host adapter.
                      </p>
                    ) : null}
                    <Button
                      className="mt-4 w-full"
                      disabled={!canInstallPiAgent}
                      isLoading={pendingAction === "install"}
                      type="button"
                      variant="secondary"
                      onClick={() => void handleInstallPiAgent()}
                    >
                      {installButtonLabel}
                    </Button>
                  </section>
                </aside>

                <footer className="xl:col-span-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4">
                  {feedback ? (
                    <div
                      className={[
                        "mb-4 rounded-lg border px-3 py-2 text-sm",
                        feedback.tone === "error"
                          ? "border-red-500/30 bg-red-500/10 text-red-200"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
                      ].join(" ")}
                      role={feedback.tone === "error" ? "alert" : "status"}
                    >
                      {feedback.text}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-[var(--text-muted)]">
                      Save changes only the legacy RPC compatibility record. It does not replace or
                      project the native Pi TUI session.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={!onRefreshStatus || isBusy}
                        isLoading={pendingAction === "refresh"}
                        type="button"
                        variant="secondary"
                        onClick={() => void handleRefreshStatus()}
                      >
                        Refresh status
                      </Button>
                      <Button
                        disabled={!onSaveAiAgentSettings || isBusy}
                        isLoading={pendingAction === "save"}
                        type="button"
                        onClick={() => void handleSaveSettings()}
                      >
                        Save settings
                      </Button>
                    </div>
                  </div>
                </footer>
              </div>
            ) : activeSection === "java" ? (
              <div className="h-full min-h-0 overflow-hidden rounded-xl border border-[var(--border-default)]">
                <JavaIntelligencePanel
                  presentationMode="settings"
                  languageServiceStatus={javaLanguageServiceStatus}
                  isLanguageServiceRefreshing={isJavaLanguageServiceRefreshing}
                  serverJdkHomePreference={javaLanguageServerRuntimeJdkHome}
                  serverJdkHomePreferenceError={javaLanguageServerRuntimePreferenceError}
                  onSaveServerJdkHomePreference={onSaveJavaLanguageServerRuntimeJdkHome}
                  status={javaRefactorKitStatus}
                  capabilities={javaRefactorKitCapabilities}
                  isChecking={isJavaRefactorKitChecking}
                  error={javaRefactorKitError}
                  languageToolingDiagnostics={languageToolingDiagnostics}
                  onStartLanguageService={onStartJavaLanguageService}
                  onStopLanguageService={onStopJavaLanguageService}
                  onRestartLanguageService={onRestartJavaLanguageService}
                  onRefreshLanguageService={onRefreshJavaLanguageService}
                  onSetupLanguageService={onSetupJavaLanguageService}
                  onRefresh={onRefreshJavaRefactorKit}
                  onRequestLanguageToolingDiagnostics={onRequestLanguageToolingDiagnostics}
                />
              </div>
            ) : activeSection === "xcom2" ? (
              <div className="h-full min-h-0 overflow-hidden rounded-xl border border-[var(--border-default)]">
                <Xcom2SetupPanel
                  snapshot={xcom2SetupSnapshot}
                  isLoading={isXcom2SetupLoading}
                  isStale={isXcom2SetupStale}
                  error={xcom2SetupError}
                  plan={xcom2SetupPlan}
                  onRefresh={onRefreshXcom2Setup}
                  onPlanSetup={onPlanXcom2Setup}
                  currentTransaction={xcom2SetupTransaction}
                  transactions={xcom2SetupTransactions}
                  isTransactionLoading={isXcom2SetupTransactionLoading}
                  transactionError={xcom2SetupTransactionError}
                  transactionProgressEvent={xcom2SetupTransactionProgressEvent}
                  onPrepare={onPrepareXcom2Setup}
                  onApply={onApplyXcom2Setup}
                  onCancel={onCancelXcom2Setup}
                  onRollback={onRollbackXcom2Setup}
                  onRecover={onRecoverXcom2Setup}
                  onRefreshHistory={onRefreshXcom2SetupHistory}
                />
              </div>
            ) : activeSection === "workspace" ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-5">
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-[var(--text-primary)]">
                        Current workspace
                      </h4>
                      <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
                        Workspace identity and marker metadata supplied by the host app.
                      </p>
                    </div>
                    <Button
                      disabled={!onRefreshWorkspace || isBusy}
                      isLoading={pendingAction === "refresh-workspace"}
                      type="button"
                      variant="secondary"
                      onClick={() => void handleRefreshWorkspace()}
                    >
                      Refresh workspace
                    </Button>
                  </div>

                  {isXcom2ModuleConfigurationChecking ? (
                    <div
                      className="mb-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-editor)] px-3 py-2 text-sm text-[var(--text-secondary)]"
                      role="status"
                    >
                      Checking XCOM 2 project configuration…
                    </div>
                  ) : xcom2ModuleConfigurationDiagnosticPresentation ? (
                    <div className="mb-4">
                      <Xcom2ModuleConfigurationDiagnosticAlert
                        {...xcom2ModuleConfigurationDiagnosticPresentation}
                      />
                    </div>
                  ) : null}

                  {workspaceError ? (
                    <div
                      className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
                      role="alert"
                    >
                      {workspaceError}
                    </div>
                  ) : null}

                  {workspaceFeedback ? (
                    <div
                      className={[
                        "mb-4 rounded-lg border px-3 py-2 text-sm",
                        workspaceFeedback.tone === "error"
                          ? "border-red-500/30 bg-red-500/10 text-red-200"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
                      ].join(" ")}
                      role={workspaceFeedback.tone === "error" ? "alert" : "status"}
                    >
                      {workspaceFeedback.text}
                    </div>
                  ) : null}

                  {workspaceInfo ? (
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <StatusRow label="Name" value={workspaceInfo.name} />
                      <StatusRow label="ID" value={workspaceInfo.id} />
                      <StatusRow label="Root path" value={workspaceInfo.rootPath} />
                      <StatusRow
                        label="Marker folder"
                        value={workspaceInfo.markerFolder ?? ".ide"}
                      />
                      <StatusRow
                        label="Created at"
                        value={formatDateTime(workspaceInfo.createdAt)}
                      />
                      <StatusRow
                        label="Last opened at"
                        value={formatDateTime(workspaceInfo.lastOpenedAt)}
                      />
                    </dl>
                  ) : (
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-editor)] p-4 text-sm text-[var(--text-secondary)]">
                      No current workspace metadata has been supplied.
                    </div>
                  )}
                </section>

                <aside className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-[var(--text-primary)]">
                        Known workspaces
                      </h4>
                      <p className="text-sm text-[var(--text-secondary)]">
                        User registry metadata.
                      </p>
                    </div>
                    <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-editor)] px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)]">
                      {knownWorkspaces.length} known
                    </span>
                  </div>

                  {visibleWorkspaces.length > 0 ? (
                    <ul className="grid gap-3">
                      {visibleWorkspaces.map((workspace) => (
                        <WorkspaceListItem
                          key={`${workspace.id}:${workspace.rootPath}`}
                          workspace={workspace}
                          isCurrent={workspace.id === currentWorkspaceId}
                          isSwitchDisabled={!onSwitchWorkspace || isBusy}
                          isSwitching={
                            pendingAction === "switch-workspace" &&
                            pendingWorkspaceId === workspace.id
                          }
                          onSwitch={(workspaceId) => void handleSwitchWorkspace(workspaceId)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-editor)] p-4 text-sm text-[var(--text-secondary)]">
                      No known workspaces are registered.
                    </div>
                  )}

                  {knownWorkspaces.length > visibleWorkspaces.length ? (
                    <p className="mt-3 text-xs text-[var(--text-muted)]">
                      Showing {visibleWorkspaces.length} of {knownWorkspaces.length} known
                      workspaces.
                    </p>
                  ) : null}
                </aside>
              </div>
            ) : activeSection === "editor" ? (
              <div className="grid gap-5">
                <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-5">
                  <div className="mb-5">
                    <h4 className="text-base font-semibold text-[var(--text-primary)]">
                      Java formatting defaults
                    </h4>
                    <p className="mt-1 max-w-3xl text-sm text-[var(--text-secondary)]">
                      These settings control editor indentation and the options sent with Format
                      Document and Format Selection. You can also apply an Eclipse formatter profile
                      exported as XML; its rules, such as brace placement, are supplied to JDT LS
                      for this workspace.
                    </p>
                  </div>

                  {workspaceEditorPreferencesError ? (
                    <p
                      className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
                      role="alert"
                    >
                      {workspaceEditorPreferencesError}
                    </p>
                  ) : null}

                  {workspaceInfo ? (
                    <fieldset
                      className="grid max-w-xl gap-4"
                      disabled={!onChangeWorkspaceEditorPreferences}
                    >
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-[var(--text-primary)]">
                          Java indentation size
                        </span>
                        <select
                          aria-label="Java indentation size"
                          className="rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-3 py-2"
                          value={workspaceEditorPreferences.tabSize}
                          onChange={(event) =>
                            onChangeWorkspaceEditorPreferences?.({
                              ...workspaceEditorPreferences,
                              tabSize: Number(event.target.value),
                            })
                          }
                        >
                          {Array.from({ length: 8 }, (_, index) => index + 1).map((size) => (
                            <option key={size} value={size}>
                              {size} {size === 1 ? "space or tab column" : "spaces or tab columns"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-[var(--text-primary)]">
                          Java indentation character
                        </span>
                        <select
                          aria-label="Java indentation character"
                          className="rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-3 py-2"
                          value={workspaceEditorPreferences.insertSpaces ? "spaces" : "tabs"}
                          onChange={(event) =>
                            onChangeWorkspaceEditorPreferences?.({
                              ...workspaceEditorPreferences,
                              insertSpaces: event.target.value === "spaces",
                            })
                          }
                        >
                          <option value="spaces">Spaces</option>
                          <option value="tabs">Tabs</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={workspaceEditorPreferences.formatJavaOnType === true}
                          onChange={(event) => onChangeWorkspaceEditorPreferences?.({
                            ...workspaceEditorPreferences, formatJavaOnType: event.target.checked,
                          })}
                        />
                        Format Java while typing
                      </label>
                      <p className="text-sm text-[var(--text-secondary)]">
                        Use the Java language service to format after its supported characters. Changes stay in the editor until you save.
                      </p>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-[var(--text-primary)]">
                          Eclipse formatter XML path
                        </span>
                        <div className="flex gap-2">
                          <input
                            aria-label="Eclipse formatter XML path"
                            className="min-w-0 flex-1 rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-3 py-2"
                            placeholder="config/java-formatter.xml"
                            value={formatterProfileDraft.path}
                            onChange={(event) => {
                              setFormatterLookup(null);
                              setFormatterProfileDraft((draft) => ({
                                ...draft,
                                path: event.target.value,
                              }));
                            }}
                          />
                          {onSelectWorkspaceFormatterProfile ? (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={formatterPickerBusy}
                              onClick={() => {
                                setFormatterPickerBusy(true);
                                setFormatterPickerError(null);
                                void onSelectWorkspaceFormatterProfile()
                                  .then((path) => {
                                    if (path) {
                                      setFormatterLookup(null);
                                      setFormatterProfileDraft((draft) => ({ ...draft, path }));
                                    }
                                  })
                                  .catch((failure: unknown) => {
                                    setFormatterPickerError(getErrorMessage(failure));
                                  })
                                  .finally(() => setFormatterPickerBusy(false));
                              }}
                            >
                              {formatterPickerBusy ? "Choosing…" : "Browse XML"}
                            </Button>
                          ) : null}
                          {onOpenWorkspaceFormatterProfile &&
                          workspaceEditorPreferences.javaFormatterProfile ? (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={formatterProfileOpenBusy}
                              onClick={() => {
                                const { path } = workspaceEditorPreferences.javaFormatterProfile!;
                                setFormatterProfileOpenBusy(true);
                                setFormatterProfileOpenError(null);
                                setFormatterProfileOpenStatus(null);
                                void onOpenWorkspaceFormatterProfile(path)
                                  .then(() => {
                                    setFormatterProfileOpenStatus(
                                      "Opened formatter XML in the editor. Save changes, then restart Eclipse JDT LS to load the updated profile.",
                                    );
                                  })
                                  .catch((failure: unknown) => {
                                    setFormatterProfileOpenError(getErrorMessage(failure));
                                  })
                                  .finally(() => setFormatterProfileOpenBusy(false));
                              }}
                            >
                              {formatterProfileOpenBusy ? "Opening…" : "Open in editor"}
                            </Button>
                          ) : null}
                        </div>
                      </label>
                      {formatterPickerError ? (
                        <p
                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
                          role="alert"
                        >
                          {formatterPickerError}
                        </p>
                      ) : null}
                      {formatterProfileOpenError ? (
                        <p
                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
                          role="alert"
                        >
                          {formatterProfileOpenError}
                        </p>
                      ) : null}
                      {formatterProfileOpenStatus ? (
                        <p className="text-xs text-[var(--text-muted)]" role="status">
                          {formatterProfileOpenStatus}
                        </p>
                      ) : null}
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-[var(--text-primary)]">
                          Profile name in XML
                        </span>
                        {currentFormatterLookup?.names ? (
                          <select
                            aria-label="Eclipse formatter profile name"
                            className="rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-3 py-2"
                            value={currentFormatterLookup.names.includes(formatterProfileDraft.profileName)
                              ? formatterProfileDraft.profileName : ""}
                            onChange={(event) => {
                              const profileName = event.target.value;
                              setFormatterProfileDraft((draft) => ({ ...draft, profileName }));
                            }}
                          >
                            <option value="">Choose a profile</option>
                            {currentFormatterLookup.names.map((name) => <option key={name} value={name}>{name}</option>)}
                          </select>
                        ) : <input
                          aria-label="Eclipse formatter profile name"
                          className="rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-3 py-2"
                          placeholder="My Java Profile"
                          value={formatterProfileDraft.profileName}
                          onChange={(event) =>
                            setFormatterProfileDraft((draft) => ({
                              ...draft,
                              profileName: event.target.value,
                            }))
                          }
                        />}
                      </label>
                      {onListWorkspaceFormatterProfiles ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!formatterProfileDraft.path.trim() ||
                            Boolean(currentFormatterLookup && !currentFormatterLookup.names && !currentFormatterLookup.error)}
                          onClick={() => {
                            const pending = { path: formatterProfileDraft.path.trim(), workspaceId: workspaceInfo?.id };
                            setFormatterLookup(pending);
                            void onListWorkspaceFormatterProfiles(pending.path)
                              .then((names) => setFormatterLookup((current) => current === pending ? { ...pending, names } : current))
                              .catch((error: unknown) => setFormatterLookup((current) => current === pending
                                ? { ...pending, error: getErrorMessage(error) } : current));
                          }}
                        >
                          Read profile names
                        </Button>
                      ) : null}
                      {currentFormatterLookup?.error ? (
                        <p role="alert" className="text-sm text-red-300">{currentFormatterLookup.error}</p>
                      ) : null}
                      {onChangeWorkspaceEditorPreferences ? (
                        <div className="grid gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={
                              Boolean(workspaceEditorPreferencesError) ||
                              Boolean(currentFormatterLookup?.names && !currentFormatterLookup.names.includes(formatterProfileDraft.profileName)) ||
                              !validFormatterProfileDraft(
                                formatterProfileDraft.path,
                                formatterProfileDraft.profileName,
                              )
                            }
                            onClick={() =>
                              onChangeWorkspaceEditorPreferences?.({
                                ...workspaceEditorPreferences,
                                javaFormatterProfile:
                                  formatterProfileDraft.path.trim() &&
                                  formatterProfileDraft.profileName.trim()
                                    ? {
                                        path: formatterProfileDraft.path.trim(),
                                        profileName: formatterProfileDraft.profileName.trim(),
                                      }
                                    : undefined,
                              })
                            }
                          >
                            Apply formatter profile
                          </Button>
                          <p className="text-xs text-[var(--text-muted)]" role="status">
                            Use a workspace-relative XML path and the exact profile name exported in
                            that file. Applying changes restarts JDT LS and reopens editor
                            documents; unsaved text remains in the editor.
                          </p>
                        </div>
                      ) : null}
                      {onChangeWorkspaceEditorPreferences && !workspaceEditorPreferencesError ? (
                        <p className="text-xs text-[var(--text-muted)]" role="status">
                          Preferences for {workspaceInfo.name}. Changes save immediately and apply
                          to open editor tabs.
                        </p>
                      ) : !onChangeWorkspaceEditorPreferences ? (
                        <p className="text-xs text-[var(--text-muted)]" role="status">
                          Workspace editor preferences cannot be changed in this host.
                        </p>
                      ) : null}
                    </fieldset>
                  ) : (
                    <p className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-editor)] p-4 text-sm text-[var(--text-secondary)]">
                      Open a workspace to configure its editor and Java indentation defaults.
                    </p>
                  )}
                </section>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-6 text-[var(--text-secondary)]">
                This settings section is not available yet.
              </div>
            )}
          </div>
        </main>
      </section>
    </div>
  );
}
