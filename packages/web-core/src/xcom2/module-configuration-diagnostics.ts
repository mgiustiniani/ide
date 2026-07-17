import {
  XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL,
  XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE,
  type Xcom2ModuleConfigurationDiagnosticPresentation,
  type Xcom2ModuleConfigurationStopCode,
} from "@ide/contracts";

/** Exhaustive provider-neutral presentation copy for configuration stop codes. */
export const XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PRESENTATIONS = Object.freeze({
  "configuration-unreadable": Object.freeze({
    title: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE,
    projectFileLabel: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL,
    summary: "The IDE could not safely read the XCOM 2 project configuration.",
    remediation:
      "Make .ide a regular directory and .ide/xcom2.json a readable regular file, with neither entry a symbolic link, then refresh the workspace.",
    supportIdentifier: "configuration-unreadable",
  }),
  "configuration-too-large": Object.freeze({
    title: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE,
    projectFileLabel: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL,
    summary: "The XCOM 2 project configuration exceeds the 64 KiB limit.",
    remediation: "Reduce .ide/xcom2.json to 64 KiB or less, then refresh the workspace.",
    supportIdentifier: "configuration-too-large",
  }),
  "configuration-invalid-utf8": Object.freeze({
    title: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE,
    projectFileLabel: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL,
    summary: "The XCOM 2 project configuration is not valid UTF-8.",
    remediation: "Save .ide/xcom2.json as UTF-8, then refresh the workspace.",
    supportIdentifier: "configuration-invalid-utf8",
  }),
  "configuration-invalid-json": Object.freeze({
    title: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE,
    projectFileLabel: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL,
    summary: "The XCOM 2 project configuration is not valid JSON.",
    remediation:
      "Correct the JSON syntax so the file contains one complete JSON object, then refresh the workspace.",
    supportIdentifier: "configuration-invalid-json",
  }),
  "configuration-invalid-schema": Object.freeze({
    title: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE,
    projectFileLabel: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL,
    summary: "The XCOM 2 project configuration does not match the activation v1 structure.",
    remediation:
      "Use exactly these fields once: numeric version, text target, and the moduleRoots list; remove all other fields, then refresh the workspace.",
    supportIdentifier: "configuration-invalid-schema",
  }),
  "configuration-unsupported-version": Object.freeze({
    title: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE,
    projectFileLabel: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL,
    summary: "This XCOM 2 project configuration version is not supported.",
    remediation: "Set version to 1, then refresh the workspace.",
    supportIdentifier: "configuration-unsupported-version",
  }),
  "configuration-unsupported-target": Object.freeze({
    title: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE,
    projectFileLabel: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL,
    summary: "This XCOM 2 project target is not supported.",
    remediation: 'Set target to "wotc", then refresh the workspace.',
    supportIdentifier: "configuration-unsupported-target",
  }),
  "configuration-invalid-module-roots": Object.freeze({
    title: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE,
    projectFileLabel: XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL,
    summary: "The configured module roots are not valid for this workspace.",
    remediation:
      "Provide 1–64 unique, exact-case workspace-relative paths to existing directories, with no symbolic links, then refresh the workspace.",
    supportIdentifier: "configuration-invalid-module-roots",
  }),
} as const satisfies Readonly<
  Record<Xcom2ModuleConfigurationStopCode, Xcom2ModuleConfigurationDiagnosticPresentation>
>);

/** Select the stable presentation for one typed configuration stop. */
export function mapXcom2ModuleConfigurationDiagnosticPresentation(
  code: Xcom2ModuleConfigurationStopCode,
): Readonly<Xcom2ModuleConfigurationDiagnosticPresentation> {
  return XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PRESENTATIONS[code];
}
