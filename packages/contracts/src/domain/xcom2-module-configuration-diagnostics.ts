import {
  XCOM2_MODULE_CONFIGURATION_PATH,
  type Xcom2ModuleConfigurationStopCode,
} from "./xcom2-module-configuration-activation";

/** Approved stable heading shared by every safe configuration diagnostic. */
export const XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE =
  "XCOM 2 project configuration needs attention" as const;

/** Display-safe project-relative label; this is never an adapter-supplied path. */
export const XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL =
  XCOM2_MODULE_CONFIGURATION_PATH;

/** Provider-neutral, interpolation-free copy for one typed configuration stop. */
export interface Xcom2ModuleConfigurationDiagnosticPresentation {
  readonly title: typeof XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE;
  readonly projectFileLabel: typeof XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL;
  readonly summary: string;
  readonly remediation: string;
  readonly supportIdentifier: Xcom2ModuleConfigurationStopCode;
}
