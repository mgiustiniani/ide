import type {
  Xcom2ProjectFoundryPreviewPlan,
  Xcom2ProjectFoundryPreviewRefusalCode,
} from "@ide/contracts";
import { useEffect, useId, useRef } from "react";
import { Button } from "../ui/Button";
import { ModalLayer } from "../ui/ModalLayer";

export type Xcom2ProjectFoundryDialogViewState =
  | { readonly kind: "editing" }
  | { readonly kind: "busy" }
  | {
      readonly kind: "refused";
      readonly code: Xcom2ProjectFoundryPreviewRefusalCode;
    }
  | {
      readonly kind: "ready";
      readonly plan: Readonly<Xcom2ProjectFoundryPreviewPlan>;
    };

export interface Xcom2ProjectFoundryDialogProps {
  readonly sourceRepository: string;
  readonly destinationParent: string;
  readonly modId: string;
  readonly viewState: Xcom2ProjectFoundryDialogViewState;
  readonly onSelectSourceRepository: () => void | Promise<void>;
  readonly onSelectDestinationParent: () => void | Promise<void>;
  readonly onModIdChange: (modId: string) => void;
  readonly onPreview: (modId: string) => void | Promise<void>;
  readonly onCancel: () => void | Promise<void>;
}

const refusalMessages: Record<Xcom2ProjectFoundryPreviewRefusalCode, string> = {
  "mod-id-invalid": "The ModId is invalid.",
  "mod-id-windows-device": "The ModId is reserved as a Windows device name.",
  "source-commit-missing": "The pinned source commit is missing.",
  "source-commit-unreadable": "The pinned source commit cannot be read safely.",
  "source-commit-mismatched": "The source commit does not match the pinned commit.",
  "source-commit-fingerprint-invalid": "The source commit fingerprint is invalid.",
  "source-tree-missing": "The pinned source tree is missing.",
  "source-tree-unreadable": "The pinned source tree cannot be read safely.",
  "source-tree-mismatched": "The source tree does not match the pinned tree.",
  "source-tree-fingerprint-invalid": "The source tree fingerprint is invalid.",
  "source-blob-missing": "A required committed source blob is missing.",
  "source-blob-unreadable": "A required committed source blob cannot be read safely.",
  "source-blob-mismatched": "A committed source blob does not match the pinned source.",
  "source-blob-fingerprint-invalid": "A committed source blob fingerprint is invalid.",
  "source-grant-invalid": "The source selection grant is invalid.",
  "destination-parent-unavailable": "The destination parent is unavailable.",
  "destination-parent-grant-invalid": "The destination parent grant is invalid.",
  "derived-destination-present": "The derived destination already exists.",
  "derived-destination-mismatched": "The derived destination does not match this request.",
  "operation-grant-invalid": "The preview operation grant is invalid.",
};

function isValidModId(modId: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/u.test(modId)) return false;
  return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu.test(modId);
}

function TableFrame({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <div className="max-w-full overflow-x-auto rounded border border-[var(--border-default)]">
      {children}
    </div>
  );
}

function PlanTable({
  caption,
  headings,
  rows,
}: {
  readonly caption: string;
  readonly headings: readonly string[];
  readonly rows: readonly (readonly React.ReactNode[])[];
}): JSX.Element {
  return (
    <TableFrame>
      <table className="w-full min-w-max text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[var(--surface-background)] text-[var(--text-secondary)]">
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-default)]">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, columnIndex) => (
                <td
                  key={columnIndex}
                  className={`px-3 py-2 align-top ${columnIndex === 0 ? "font-mono" : ""}`}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      className="space-y-2"
      aria-labelledby={`foundry-${title.toLowerCase().replace(/[^a-z]+/gu, "-")}`}
    >
      <h3
        id={`foundry-${title.toLowerCase().replace(/[^a-z]+/gu, "-")}`}
        className="text-sm font-semibold"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function ReadyPlan({
  plan,
}: {
  readonly plan: Readonly<Xcom2ProjectFoundryPreviewPlan>;
}): JSX.Element {
  const facts: readonly (readonly [string, React.ReactNode])[] = [
    ["pack ID", plan.packId],
    ["platform", plan.platform],
    ["publication status", plan.publicationStatus],
    ["source repository", plan.source.repository],
    ["source grant identity", plan.source.grantIdentity],
    ["commit", plan.source.commit],
    ["tree", plan.source.tree],
    ["source fingerprint result", plan.source.fingerprintResult],
    ["source policy", plan.source.policy],
    ["ModId", plan.project.modId],
    ["project GUID", plan.project.guid],
    ["destination parent", plan.destination.parent],
    ["destination grant identity", plan.destination.parentGrantIdentity],
    ["derived absent destination", plan.destination.derivedAbsentDestination],
    ["operation grant identity", plan.destination.operationGrantIdentity],
    ["plan digest", <code className="break-all">{plan.planDigest}</code>],
  ];

  return (
    <div className="space-y-5" aria-label="Complete Project Foundry preview">
      <section
        role="region"
        aria-label="Project Foundry plan integrity"
        className="rounded border border-blue-500/40 bg-blue-500/10 p-3 text-xs"
      >
        <p>
          This plan binds schema version {plan.schemaVersion}, {plan.canonicalization} canonical
          JSON, and {plan.digestAlgorithm} digest{" "}
          <code className="break-all">{plan.planDigest}</code>.
        </p>
        <p className="mt-1">Changing any bound value changes the plan digest or refuses preview.</p>
      </section>

      <Section title="Bound identities and source facts">
        <PlanTable
          caption="Project Foundry bound identities and source facts"
          headings={["Field", "Exact value"]}
          rows={facts}
        />
      </Section>

      <Section title="Directory topology">
        <p className="text-xs text-[var(--text-secondary)]">No symlinks</p>
        <PlanTable
          caption="Project Foundry directory topology"
          headings={["Path", "Mode", "State"]}
          rows={plan.directories.map((directory) => [
            directory.path,
            directory.mode,
            directory.state,
          ])}
        />
      </Section>

      <Section title="Regular files">
        <PlanTable
          caption="Project Foundry regular files"
          headings={["Path", "Classification", "Mode", "Bytes", "SHA-256"]}
          rows={plan.files.map((file) => [
            file.path,
            file.classification,
            file.mode,
            file.bytes,
            <code className="block min-w-[32rem] break-all">{file.sha256}</code>,
          ])}
        />
      </Section>

      <Section title="Approved generated previews">
        <div className="space-y-3">
          {plan.generatedPreviews.map((preview) => (
            <section
              key={preview.path}
              role="region"
              aria-label={preview.path}
              className="min-w-0 rounded border border-[var(--border-default)]"
            >
              <header className="border-b border-[var(--border-default)] bg-[var(--surface-background)] px-3 py-2">
                <h4 className="break-all font-mono text-xs font-semibold">{preview.path}</h4>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-[var(--text-secondary)]">
                  <span>{preview.encoding}</span>
                  <span>BOM {preview.byteOrderMark}</span>
                  <span>{preview.lineEndings}</span>
                </p>
              </header>
              <div className="max-h-96 max-w-full overflow-auto p-3" tabIndex={0}>
                <pre className="w-max min-w-full whitespace-pre font-mono text-xs">
                  {preview.escapedBytePreview}
                </pre>
              </div>
            </section>
          ))}
        </div>
      </Section>

      <Section title="Absent outputs and capabilities">
        <ul
          aria-label="Project Foundry absent outputs and capabilities"
          className="list-disc space-y-1 pl-5 text-xs"
        >
          {plan.absences.map((absence) => (
            <li key={absence} className="break-words">
              {absence}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Warnings">
        <ul aria-label="Project Foundry warnings" className="list-disc space-y-1 pl-5 text-xs">
          {plan.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export function Xcom2ProjectFoundryDialog({
  sourceRepository,
  destinationParent,
  modId,
  viewState,
  onSelectSourceRepository,
  onSelectDestinationParent,
  onModIdChange,
  onPreview,
  onCancel,
}: Xcom2ProjectFoundryDialogProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const modIdHelpId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const busy = viewState.kind === "busy";
  const validModId = isValidModId(modId);
  const canPreview =
    !busy && sourceRepository.length > 0 && destinationParent.length > 0 && validModId;

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const cancel = (): void => {
    void onCancel();
  };

  return (
    <ModalLayer className="flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded border border-[var(--border-default)] bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
            return;
          }
          if (event.key !== "Tab") return;

          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ) ?? [],
          ).filter((element) => !element.hasAttribute("hidden"));
          if (focusable.length === 0) {
            event.preventDefault();
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="shrink-0 border-b border-[var(--border-default)] px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            New XCOM 2 Project
          </h2>
          <p id={descriptionId} className="mt-1 text-xs text-[var(--text-secondary)]">
            Select the pinned EMPT source and an absent destination, then inspect a read-only plan.
            Preview does not create a project or execute template tooling.
          </p>
        </header>

        <form
          aria-label="New XCOM 2 Project"
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (canPreview) void onPreview(modId);
          }}
        >
          <div
            data-testid="xcom2-project-foundry-scroll-content"
            className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"
          >
            <fieldset
              disabled={busy}
              className="grid gap-4 rounded border border-[var(--border-default)] p-4"
            >
              <legend className="px-1 text-sm font-semibold">Project selections</legend>

              <div className="grid min-w-0 gap-1 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
                <label htmlFor="foundry-source-repository" className="text-xs font-medium sm:pb-2">
                  EMPT repository
                </label>
                <input
                  id="foundry-source-repository"
                  value={sourceRepository}
                  readOnly
                  className="min-w-0 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void onSelectSourceRepository()}
                >
                  Select EMPT repository
                </Button>
              </div>

              <div className="grid min-w-0 gap-1 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
                <label htmlFor="foundry-destination-parent" className="text-xs font-medium sm:pb-2">
                  Destination parent
                </label>
                <input
                  id="foundry-destination-parent"
                  value={destinationParent}
                  readOnly
                  className="min-w-0 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void onSelectDestinationParent()}
                >
                  Select Destination parent
                </Button>
              </div>

              <div className="grid min-w-0 gap-1 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-start">
                <label htmlFor="foundry-mod-id" className="text-xs font-medium sm:pt-2">
                  ModId
                </label>
                <div className="min-w-0">
                  <input
                    id="foundry-mod-id"
                    value={modId}
                    aria-describedby={modIdHelpId}
                    aria-invalid={modId.length > 0 && !validModId}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={48}
                    onChange={(event) => onModIdChange(event.target.value)}
                    className="w-full min-w-0 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm aria-[invalid=true]:border-[var(--accent-red)]"
                  />
                  <p id={modIdHelpId} className="mt-1 text-xs text-[var(--text-secondary)]">
                    1–48 ASCII letters, digits, or underscores; begin with a letter. Windows device
                    names are refused.
                  </p>
                </div>
                <span aria-hidden="true" />
              </div>
            </fieldset>

            {viewState.kind === "busy" ? (
              <p
                role="status"
                aria-live="polite"
                className="rounded border border-blue-500/40 bg-blue-500/10 p-3 text-sm"
              >
                Preparing the read-only Project Foundry preview…
              </p>
            ) : null}

            {viewState.kind === "refused" ? (
              <div
                role="alert"
                className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm"
              >
                <p className="font-semibold">Preview refused. No project was created.</p>
                <p className="mt-1">{refusalMessages[viewState.code]}</p>
                <p className="mt-1 text-xs">
                  Refusal code: <code>{viewState.code}</code>
                </p>
              </div>
            ) : null}

            {viewState.kind === "ready" ? <ReadyPlan plan={viewState.plan} /> : null}
          </div>

          <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
            <Button type="button" variant="secondary" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canPreview} isLoading={busy}>
              Preview
            </Button>
          </footer>
        </form>
      </div>
    </ModalLayer>
  );
}
