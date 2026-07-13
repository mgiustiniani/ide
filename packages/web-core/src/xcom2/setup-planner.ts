import {
  canPlanXcom2Setup,
  XCOM2_SETUP_PLAN_VERSION,
  type Xcom2SetupMonitorSnapshot,
  type Xcom2SetupPlan,
  type Xcom2SetupPlanStep,
  type Xcom2SetupStepDisposition,
  type Xcom2SetupStepId,
} from "@ide/contracts";

interface StepDefinition {
  id: Xcom2SetupStepId;
  title: string;
  readyDisposition: Exclude<Xcom2SetupStepDisposition, "blocked" | "already-satisfied">;
  summary: string;
}

const STEP_DEFINITIONS: readonly StepDefinition[] = [
  {
    id: "discover-tools",
    title: "Discover host and container tools",
    readyDisposition: "automatic",
    summary: "Inspect PowerShell, Wine, Protontricks, Git, rsync, Distrobox, and X2ModBuildCommon.",
  },
  {
    id: "authorize-external-roots",
    title: "Authorize external roots",
    readyDisposition: "requires-approval",
    summary:
      "Request least-privilege grants for SDK, game, Steam library, Workshop, and Proton roots.",
  },
  {
    id: "backup-sdk-files",
    title: "Back up SDK files",
    readyDisposition: "requires-approval",
    summary: "Create checksummed backups before any SDK configuration or source remediation.",
  },
  {
    id: "remove-day-zero-references",
    title: "Remove XCom_DLC_Day0 references",
    readyDisposition: "requires-approval",
    summary: "Plan atomic removal of references to the unshipped XCom_DLC_Day0 package.",
  },
  {
    id: "quarantine-tle-sources",
    title: "Quarantine duplicate Tactical Legacy sources",
    readyDisposition: "requires-approval",
    summary: "Plan reversible quarantine of duplicate *TLE* source files instead of deletion.",
  },
  {
    id: "configure-sdk-offline-mode",
    title: "Configure SDK offline source control mode",
    readyDisposition: "requires-approval",
    summary: "Plan SourceControl Disabled=True and GameAssetDatabase OfflineMode=True.",
  },
  {
    id: "link-cooked-pc-console",
    title: "Link CookedPCConsole",
    readyDisposition: "requires-approval",
    summary: "Plan a validated SDK link to the authorized game CookedPCConsole directory.",
  },
  {
    id: "verify-proton-shortcut",
    title: "Verify the GE-Proton editor shortcut",
    readyDisposition: "requires-user-action",
    summary: "Verify the non-Steam XComGame.exe editor shortcut and compatibility tool.",
  },
  {
    id: "provision-proton-prefix",
    title: "Provision the editor Proton prefix",
    readyDisposition: "requires-user-action",
    summary:
      "Verify dotnet472 and SDK redistributables, pausing for upstream interactive installers.",
  },
  {
    id: "create-build-prefix-copy",
    title: "Create the isolated build prefix copy",
    readyDisposition: "requires-approval",
    summary: "Plan a separate pfx_copy so builds do not mutate Steam-managed prefix state.",
  },
  {
    id: "create-sdk-alias",
    title: "Create the no-space SDK alias",
    readyDisposition: "requires-approval",
    summary: "Plan an optional validated alias for tools that cannot handle spaces safely.",
  },
  {
    id: "write-workspace-configuration",
    title: "Write workspace XCOM 2 configuration",
    readyDisposition: "requires-approval",
    summary:
      "Preview .ide/xcom2.json with portable project settings and machine-local path provenance.",
  },
  {
    id: "verify-operational-readiness",
    title: "Verify operational readiness",
    readyDisposition: "automatic",
    summary: "Run read-only postcondition checks and a non-destructive X2MBC validation fixture.",
  },
] as const;

function requiredProductBlockers(snapshot: Xcom2SetupMonitorSnapshot): string[] {
  return snapshot.products
    .filter((status) => status.product.role === "required" && (!status.complete || !status.stable))
    .flatMap((status) => {
      const reasons = [...status.completionReasons, ...status.stabilityReasons];
      return reasons.length > 0
        ? reasons.map((reason) => `${status.product.name}: ${reason}`)
        : [`${status.product.name} is not complete and stable`];
    });
}

function blockedStep(definition: StepDefinition, blockers: readonly string[]): Xcom2SetupPlanStep {
  return {
    id: definition.id,
    title: definition.title,
    disposition: "blocked",
    summary: definition.summary,
    blockers,
    executable: false,
  };
}

/**
 * Build the first reviewable setup plan from export-safe monitor evidence.
 * No path discovery or mutation is performed in this layer.
 */
export function createXcom2SetupPlan(
  snapshot: Xcom2SetupMonitorSnapshot,
  generatedAt = new Date().toISOString(),
): Xcom2SetupPlan {
  const downloadsReady =
    snapshot.canPlanSetup &&
    snapshot.overallState === "ready" &&
    canPlanXcom2Setup(snapshot.products);
  const downloadBlockers = downloadsReady
    ? []
    : [
        "Required Steam downloads must be complete and stable before operational setup can continue.",
        ...requiredProductBlockers(snapshot),
      ];
  const verifyStep: Xcom2SetupPlanStep = {
    id: "verify-downloads",
    title: "Verify game and SDK downloads",
    disposition: downloadsReady ? "already-satisfied" : "blocked",
    summary: downloadsReady
      ? "Required XCOM 2 and WOTC SDK products are complete and stable."
      : "Wait for Steam to finish downloading, staging, and verifying required products.",
    blockers: downloadBlockers,
    executable: false,
  };
  const steps = [
    verifyStep,
    ...STEP_DEFINITIONS.map((definition): Xcom2SetupPlanStep =>
      downloadsReady
        ? {
            id: definition.id,
            title: definition.title,
            disposition: definition.readyDisposition,
            summary: definition.summary,
            blockers: [],
            executable: false,
          }
        : blockedStep(definition, ["Blocked by verify-downloads"]),
    ),
  ];

  return {
    version: XCOM2_SETUP_PLAN_VERSION,
    planId: `${snapshot.workspaceId}:${snapshot.generation}:${snapshot.checkedAt}`,
    workspaceId: snapshot.workspaceId,
    workspaceGeneration: snapshot.generation,
    sourceCheckedAt: snapshot.checkedAt,
    state: downloadsReady ? "planned" : "waiting-for-download",
    dryRun: true,
    canApply: false,
    steps,
    blockers: downloadBlockers,
    warnings: [
      ...snapshot.warnings,
      "This increment is dry-run only. No SDK, Proton, Steam, or workspace files will be changed.",
    ],
    generatedAt: new Date(generatedAt).toISOString(),
  };
}
