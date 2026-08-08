import { useRef, useState } from "react";
import {
  XCOM2_PROJECT_BUILD_RECIPE_ARGUMENT_ROLES,
  XCOM2_PROJECT_BUILD_RECIPE_LIMITS,
  XCOM2_PROJECT_BUILD_RECIPE_PREREQUISITE_ROLES,
  XCOM2_PROJECT_BUILD_RECIPE_SCRIPT_PATH,
  type Xcom2ProjectBuildRecipeArgument,
  type Xcom2ProjectBuildRecipeArgumentRole,
  type Xcom2ProjectBuildRecipePrerequisiteRole,
} from "@ide/contracts";

export interface Xcom2ProjectBuildRecipeArgumentPresentation {
  readonly role: Xcom2ProjectBuildRecipeArgumentRole;
  readonly valueState: Xcom2ProjectBuildRecipeArgument["valueState"];
}

export interface Xcom2ProjectBuildRecipePrerequisitePresentation {
  readonly role: Xcom2ProjectBuildRecipePrerequisiteRole;
  readonly state: "unresolved";
}

/** Safe, execution-free review metadata supplied by the application view model. */
export interface Xcom2ProjectBuildRecipeReviewPresentation {
  readonly scriptSha256: string;
  readonly scriptByteSize: number;
  readonly provenance: "X2ModBuildCommon";
  readonly license: "MIT";
  readonly noticeIdentity: string;
  readonly noticeText: string;
  readonly action: "Default";
  readonly arguments: readonly Readonly<Xcom2ProjectBuildRecipeArgumentPresentation>[];
  readonly unresolvedPrerequisites: readonly Readonly<Xcom2ProjectBuildRecipePrerequisitePresentation>[];
}

export type Xcom2ProjectBuildRecipeViewState =
  | {
      readonly kind: "unavailable";
      readonly code: "browser-unavailable" | "native-unavailable";
    }
  | { readonly kind: "idle" }
  | { readonly kind: "inspecting" }
  | {
      readonly kind: "review-ready";
      readonly review: Readonly<Xcom2ProjectBuildRecipeReviewPresentation>;
    }
  | {
      readonly kind: "approved";
      readonly review: Readonly<Xcom2ProjectBuildRecipeReviewPresentation>;
    }
  | {
      readonly kind: "revoked";
      readonly code: "workspace-refresh" | "recipe-changed" | "context-changed";
    }
  | {
      readonly kind: "refused";
      readonly code: "recipe-invalid" | "approval-refused";
    }
  | {
      readonly kind: "error";
      readonly code: "inspection-failed" | "approval-failed";
    };

interface Xcom2ProjectBuildRecipeContributionBase {
  /** Used only to attach the contribution to the matching active module card. */
  readonly moduleRoot: string;
  readonly viewState: Readonly<Xcom2ProjectBuildRecipeViewState>;
}

type UnavailableBuildRecipeContribution = Xcom2ProjectBuildRecipeContributionBase & {
  readonly viewState: Extract<Xcom2ProjectBuildRecipeViewState, { readonly kind: "unavailable" }>;
  readonly onOpenReview?: never;
  readonly onApproveExactRecipe?: never;
  readonly onDiscardReview?: never;
};

type AvailableBuildRecipeContribution = Xcom2ProjectBuildRecipeContributionBase & {
  readonly viewState: Exclude<Xcom2ProjectBuildRecipeViewState, { readonly kind: "unavailable" }>;
  readonly onOpenReview: () => void | Promise<void>;
  /** Starts at most one approval request for the currently displayed exact review. */
  readonly onApproveExactRecipe: () => void | Promise<void>;
  readonly onDiscardReview: () => void | Promise<void>;
};

export type Xcom2ProjectBuildRecipeContributionPresentation =
  UnavailableBuildRecipeContribution | AvailableBuildRecipeContribution;

function reviewIsAvailable(
  contribution: Readonly<Xcom2ProjectBuildRecipeContributionPresentation>,
): contribution is Readonly<AvailableBuildRecipeContribution> {
  return contribution.viewState.kind !== "unavailable";
}

const buttonClassName =
  "inline-flex items-center justify-center rounded-sm border border-[var(--border-default)] bg-[var(--surface-panel)] px-2 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--highlight-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] disabled:cursor-not-allowed disabled:opacity-50";

const SAFE_ARGUMENT_VALUE_STATES: readonly Xcom2ProjectBuildRecipeArgument["valueState"][] = [
  "current-module",
  "unresolved",
  "declared",
  "project-local",
];

const unavailableMessages = {
  "browser-unavailable": "Build recipe review is unavailable in the browser.",
  "native-unavailable": "Build recipe review is unavailable on this platform.",
} as const;

const revokedMessages = {
  "workspace-refresh":
    "Exact recipe approval was revoked after Workspace Refresh. Inspect and review again.",
  "recipe-changed": "Exact recipe approval was revoked because the reviewed recipe changed.",
  "context-changed":
    "Exact recipe approval was revoked because the active project context changed.",
} as const;

const refusedMessages = {
  "recipe-invalid": "Build recipe review was refused because its safe metadata is invalid.",
  "approval-refused": "Exact recipe approval was refused.",
} as const;

const errorMessages = {
  "inspection-failed": "Build recipe inspection could not be completed safely.",
  "approval-failed": "Exact recipe approval could not be completed safely.",
} as const;

function orderedValuesEqual<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

const NOTICE_UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
const NOTICE_MACHINE_PATH =
  /(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|(?:^|[\s("'`])\/(?:[^\s/]+(?:\/|$)))/imu;
const NOTICE_COMMAND_OR_SCRIPT_BYTES =
  /(?:#!|<\/?script\b|\b(?:powershell|pwsh|cmd(?:\.exe)?|bash|zsh)\b|\.(?:ps1|cmd|bat|sh)\b|\$env:|(?:^|\n)\s*(?:param\s*\(|set-strictmode\b|invoke-[\w-]+\b|function\s+[\w-]+\s*\{)|&&|\|\|)/imu;

function safeNoticeIdentity(value: string): boolean {
  if (value.length === 0 || value.length > XCOM2_PROJECT_BUILD_RECIPE_LIMITS.maximumIdentityBytes) {
    return false;
  }
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  if (/(?:[A-Za-z]:[\\/]|\\\\|(?:^|\s)\/(?:[^/\s]+\/)+[^/\s]+)/u.test(value)) return false;
  return !/(?:https?:\/\/|file:\/\/|\b(?:powershell|pwsh|cmd\.exe|bash)\b)/iu.test(value);
}

function safeNoticeText(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return false;
  if (value !== value.normalize("NFC") || NOTICE_UNSAFE_CONTROL_CHARACTER.test(value)) return false;
  if (
    new TextEncoder().encode(value).byteLength >
    XCOM2_PROJECT_BUILD_RECIPE_LIMITS.maximumNoticeBytes
  ) {
    return false;
  }
  return !NOTICE_MACHINE_PATH.test(value) && !NOTICE_COMMAND_OR_SCRIPT_BYTES.test(value);
}

function safeReview(review: Readonly<Xcom2ProjectBuildRecipeReviewPresentation>): boolean {
  const roles = review.arguments.map(({ role }) => role);
  const prerequisiteRoles = review.unresolvedPrerequisites.map(({ role }) => role);
  return (
    /^[0-9a-f]{64}$/u.test(review.scriptSha256) &&
    Number.isSafeInteger(review.scriptByteSize) &&
    review.scriptByteSize >= 0 &&
    review.scriptByteSize <= XCOM2_PROJECT_BUILD_RECIPE_LIMITS.maximumScriptBytes &&
    review.provenance === "X2ModBuildCommon" &&
    review.license === "MIT" &&
    review.action === "Default" &&
    safeNoticeIdentity(review.noticeIdentity) &&
    safeNoticeText(review.noticeText) &&
    orderedValuesEqual(roles, XCOM2_PROJECT_BUILD_RECIPE_ARGUMENT_ROLES) &&
    review.arguments.every(({ valueState }) => SAFE_ARGUMENT_VALUE_STATES.includes(valueState)) &&
    orderedValuesEqual(prerequisiteRoles, XCOM2_PROJECT_BUILD_RECIPE_PREREQUISITE_ROLES) &&
    review.unresolvedPrerequisites.every(({ state }) => state === "unresolved")
  );
}

function ReviewField({
  term,
  children,
}: {
  readonly term: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-medium text-[var(--text-primary)]">{term}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function ReviewTable({
  caption,
  headings,
  rows,
}: {
  readonly caption: string;
  readonly headings: readonly string[];
  readonly rows: readonly (readonly string[])[];
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded border border-[var(--border-default)]">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[var(--surface-background)] text-[var(--text-secondary)]">
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col" className="px-3 py-2 font-medium">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-default)]">
          {rows.map((row) => (
            <tr key={row.join(":")}>
              {row.map((value) => (
                <td key={value} className="px-3 py-2">
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExactReview({
  review,
  approved,
  onApproveExactRecipe,
  onDiscardReview,
}: {
  readonly review: Readonly<Xcom2ProjectBuildRecipeReviewPresentation>;
  readonly approved: boolean;
  readonly onApproveExactRecipe: () => void | Promise<void>;
  readonly onDiscardReview: () => void | Promise<void>;
}): JSX.Element {
  const approvalStarted = useRef(approved);
  const [approvalPending, setApprovalPending] = useState(approved);

  if (!safeReview(review)) {
    return (
      <p role="alert" className="px-3 py-2 text-xs text-amber-200">
        {refusedMessages["recipe-invalid"]}
      </p>
    );
  }

  const approveOnce = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (approvalStarted.current) return;
    approvalStarted.current = true;
    event.currentTarget.disabled = true;
    setApprovalPending(true);
    void onApproveExactRecipe();
  };

  return (
    <section
      aria-label="Default Build recipe"
      className="space-y-3 border-t border-[var(--border-default)] p-3"
    >
      <div>
        <h3 className="text-sm font-semibold">Default Build recipe</h3>
        <p className="text-xs text-[var(--text-secondary)]">
          The script is untrusted project input and will not be executed by this review.
        </p>
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
        <ReviewField term="script path">
          <code>{XCOM2_PROJECT_BUILD_RECIPE_SCRIPT_PATH}</code>
        </ReviewField>
        <ReviewField term="script SHA-256">
          <code className="break-all">{review.scriptSha256}</code>
        </ReviewField>
        <ReviewField term="script byte size">{review.scriptByteSize}</ReviewField>
        <ReviewField term="action">{review.action}</ReviewField>
        <ReviewField term="provenance">{review.provenance}, MIT-licensed</ReviewField>
        <ReviewField term="notice identity">{review.noticeIdentity}</ReviewField>
        <ReviewField term="attribution notice">
          <span className="whitespace-pre-wrap">{review.noticeText}</span>
        </ReviewField>
      </dl>

      <ReviewTable
        caption="Default Build recipe structured arguments"
        headings={["structured role", "value state"]}
        rows={review.arguments.map(({ role, valueState }) => [role, valueState])}
      />
      <ReviewTable
        caption="Default Build recipe unresolved prerequisites"
        headings={["unresolved prerequisite", "state"]}
        rows={review.unresolvedPrerequisites.map(({ role, state }) => [role, state])}
      />

      {approved ? (
        <>
          <p role="status" aria-live="polite" className="text-xs font-semibold text-green-300">
            Recipe approved; execution remains unavailable
          </p>
          <p className="text-xs font-semibold text-amber-200">Execution blocked</p>
        </>
      ) : (
        <p role="status" className="text-xs font-semibold text-amber-200">
          <strong>Execution blocked</strong>. Native execution is unavailable and blocked.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClassName}
          disabled={approvalPending}
          onClick={approveOnce}
        >
          Approve exact recipe
        </button>
        <button type="button" className={buttonClassName} onClick={() => void onDiscardReview()}>
          Discard
        </button>
      </div>
    </section>
  );
}

export function Xcom2ProjectBuildRecipeContribution({
  contribution,
}: {
  readonly contribution: Readonly<Xcom2ProjectBuildRecipeContributionPresentation>;
}): JSX.Element {
  if (!reviewIsAvailable(contribution)) {
    return (
      <p
        role="status"
        className="border-t border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)]"
      >
        {unavailableMessages[contribution.viewState.code]}
      </p>
    );
  }

  const state = contribution.viewState;
  if (state.kind === "review-ready" || state.kind === "approved") {
    return (
      <ExactReview
        review={state.review}
        approved={state.kind === "approved"}
        onApproveExactRecipe={contribution.onApproveExactRecipe}
        onDiscardReview={contribution.onDiscardReview}
      />
    );
  }

  const feedback =
    state.kind === "revoked"
      ? revokedMessages[state.code]
      : state.kind === "refused"
        ? refusedMessages[state.code]
        : state.kind === "error"
          ? errorMessages[state.code]
          : undefined;

  return (
    <div className="space-y-2 border-t border-[var(--border-default)] p-3">
      {state.kind === "inspecting" ? (
        <p role="status" aria-live="polite" className="text-xs text-[var(--text-secondary)]">
          Inspecting safe build recipe metadata. Execution blocked.
        </p>
      ) : feedback ? (
        <p role="alert" className="text-xs text-amber-200">
          {feedback}
        </p>
      ) : null}
      <button
        type="button"
        className={buttonClassName}
        disabled={state.kind === "inspecting"}
        aria-busy={state.kind === "inspecting" ? "true" : undefined}
        onClick={() => void contribution.onOpenReview()}
      >
        Default Build recipe
      </button>
    </div>
  );
}
