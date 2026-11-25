import type { JavaLaunchConfiguration } from "@ide/contracts";
import { validateLaunchSettings } from "./validateJavaLaunchSettings";
import { validCoverageThresholdSettings, type JavaCoverageThresholdSettings } from "./javaCoverageThresholds";

export const MAX_JAVA_CONFIGURATIONS = 16;
export const MAX_JAVA_CONFIGURATION_STORAGE_BYTES = 2 * 1024 * 1024;

export interface JavaNamedConfiguration {
  id: string;
  name: string;
  configuration: JavaLaunchConfiguration;
  coverageThresholds?: JavaCoverageThresholdSettings;
}
export interface JavaConfigurationCollection {
  version: 1;
  selectedId: string;
  configurations: JavaNamedConfiguration[];
}

export function defaultJavaConfigurations(
  configuration: JavaLaunchConfiguration = { buildTool: "auto", mainClass: "", classPath: [] },
): JavaConfigurationCollection {
  return {
    version: 1,
    selectedId: "default",
    configurations: [{ id: "default", name: "Default", configuration }],
  };
}

export function javaConfigurationsStorageKey(workspaceId: string) {
  return `ide.java.configurations.${workspaceId}`;
}

function isStoredConfiguration(value: unknown): value is JavaLaunchConfiguration {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as JavaLaunchConfiguration;
  return (
    ["auto", "jdk", "maven", "gradle"].includes(config.buildTool) &&
    (config.testFramework === undefined || ["junit", "testng"].includes(config.testFramework)) &&
    (config.debuggerMode === undefined || ["jdb", "jdi"].includes(config.debuggerMode)) &&
    typeof config.mainClass === "string" &&
    config.mainClass.length <= 512 &&
    (config.launchAsModule === undefined || typeof config.launchAsModule === "boolean") &&
    Array.isArray(config.classPath) &&
    config.classPath.length <= 64 &&
    config.classPath.every((path) => typeof path === "string" && path.length <= 4096) &&
    (config.projectPath === undefined ||
      (typeof config.projectPath === "string" && config.projectPath.length <= 4096)) &&
    (config.testFilter === undefined ||
      (typeof config.testFilter === "string" && config.testFilter.length <= 512)) &&
    (config.testReportPaths === undefined ||
      (Array.isArray(config.testReportPaths) &&
        config.testReportPaths.length <= 16 &&
        config.testReportPaths.every((path) => typeof path === "string" && path.length <= 4096))) &&
    validateLaunchSettings(config, true) === null
  );
}

export function validateJavaConfigurationName(name: string): string | null {
  if (!name.trim() || /[\0\r\n]/.test(name) || new TextEncoder().encode(name.trim()).length > 128)
    return "Use a nonempty configuration name of at most 128 bytes without line breaks.";
  return null;
}

export function isJavaConfigurationCollection(
  value: unknown,
): value is JavaConfigurationCollection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const collection = value as JavaConfigurationCollection;
  if (
    collection.version !== 1 ||
    typeof collection.selectedId !== "string" ||
    !Array.isArray(collection.configurations) ||
    collection.configurations.length === 0 ||
    collection.configurations.length > MAX_JAVA_CONFIGURATIONS
  )
    return false;
  const ids = new Set<string>(),
    names = new Set<string>();
  for (const item of collection.configurations) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== "string" ||
      validateJavaConfigurationName(item.name) !== null ||
      item.name !== item.name.trim() ||
      names.has(item.name.toLowerCase()) ||
      !isStoredConfiguration(item.configuration)
      || (item.coverageThresholds !== undefined && !validCoverageThresholdSettings(item.coverageThresholds))
    )
      return false;
    ids.add(item.id);
    names.add(item.name.toLowerCase());
  }
  return ids.has(collection.selectedId);
}

export function loadJavaConfigurations(workspaceId: string): JavaConfigurationCollection {
  try {
    const stored = localStorage.getItem(javaConfigurationsStorageKey(workspaceId));
    if (stored !== null) {
      if (new TextEncoder().encode(stored).length > MAX_JAVA_CONFIGURATION_STORAGE_BYTES)
        return defaultJavaConfigurations();
      const value: unknown = JSON.parse(stored);
      return isJavaConfigurationCollection(value) ? value : defaultJavaConfigurations();
    }
    const legacy = localStorage.getItem(`ide.java.launch.${workspaceId}`);
    if (legacy && new TextEncoder().encode(legacy).length <= 128 * 1024) {
      const value: unknown = JSON.parse(legacy);
      if (isStoredConfiguration(value)) return defaultJavaConfigurations(value);
    }
  } catch {
    /* Local storage is optional and never grants workspace trust. */
  }
  return defaultJavaConfigurations();
}

export function nextJavaConfigurationIdentity(collection: JavaConfigurationCollection) {
  let index = 1;
  while (
    collection.configurations.some(
      (item) =>
        item.id === `configuration-${index}` ||
        item.name.toLowerCase() === `configuration ${index}`,
    )
  )
    index += 1;
  return { id: `configuration-${index}`, name: `Configuration ${index}` };
}
