import type {
  LanguageDiagnostic as ContractLanguageDiagnostic,
  LanguageDocumentIdentity as ContractLanguageDocumentIdentity,
  LanguagePosition as ContractLanguagePosition,
  LanguageRange as ContractLanguageRange,
  LanguageDiagnosticSeverity,
} from "@ide/contracts";

export type LanguageDiagnostic = ContractLanguageDiagnostic;
export type LanguageDocumentIdentity = ContractLanguageDocumentIdentity;
export type DiagnosticPosition = ContractLanguagePosition;
export type DiagnosticRange = ContractLanguageRange;
/** “info” is accepted by presentation-only problem sources; language-service diagnostics use “information”. */
export type DiagnosticSeverity = LanguageDiagnosticSeverity | "info";

export interface DiagnosticCounts {
  error: number;
  warning: number;
  info: number;
  hint: number;
  total: number;
}

export const DIAGNOSTIC_SEVERITY_ORDER: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
  information: 2,
  info: 2,
  hint: 3,
};

export function countDiagnostics(
  diagnostics: readonly { severity: DiagnosticSeverity }[],
): DiagnosticCounts {
  const counts: DiagnosticCounts = { error: 0, warning: 0, info: 0, hint: 0, total: 0 };
  for (const diagnostic of diagnostics) {
    const severity = diagnostic.severity === "information" ? "info" : diagnostic.severity;
    counts[severity] += 1;
    counts.total += 1;
  }
  return counts;
}

export function formatDiagnosticSummary(
  diagnostics: readonly { severity: DiagnosticSeverity }[],
): string {
  const counts = countDiagnostics(diagnostics);
  if (counts.total === 0) return "Diagnostics: none.";
  const details = (["error", "warning", "info", "hint"] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}${counts[severity] === 1 ? "" : "s"}`)
    .join(", ");
  return `Diagnostics: ${counts.total} (${details}).`;
}
