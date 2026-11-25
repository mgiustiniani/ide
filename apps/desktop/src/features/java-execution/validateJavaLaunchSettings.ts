import type { JavaExecutionOperation, JavaLaunchConfiguration } from "@ide/contracts";

const bytes = (value: string) => new TextEncoder().encode(value).length;
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && !value.includes("\0") && bytes(value) <= limit;

export function validateLaunchSettings(
  config: JavaLaunchConfiguration,
  allowIncomplete = false,
  operation: JavaExecutionOperation = "run",
): string | null {
  if (config.applicationInput !== undefined && typeof config.applicationInput !== "boolean")
    return "Choose a valid application input mode.";
  if (bytes(JSON.stringify(config)) > 128 * 1024)
    return "Launch settings exceed the 128 KiB configuration limit.";
  if (
    config.projectModule !== undefined &&
    (!config.projectModule ||
      typeof config.projectModule !== "object" ||
      Array.isArray(config.projectModule) ||
      !["moduleId,sourceSetId", "moduleId,providerId,sourceSetId"].includes(
        Object.keys(config.projectModule).sort().join(","),
      ) ||
      ![config.projectModule.moduleId, config.projectModule.sourceSetId].every(
        (v) => text(v, 1024) && v.length > 0,
      ) ||
      (config.projectModule.providerId !== undefined &&
        (!text(config.projectModule.providerId, 1024) || !config.projectModule.providerId)))
  )
    return "Choose a valid module and source set from Java Project.";
  if (config.debuggerAttach !== undefined && !config.debuggerAttach)
    return "Invalid JDWP connection settings.";
  if (config.launchAsModule !== undefined && typeof config.launchAsModule !== "boolean")
    return "Choose a valid Java module launch mode.";
  if (config.launchAsModule === true && !config.projectModule)
    return "Named-module launch requires a synchronized Java project module.";
  if (config.workingDirectory !== undefined) {
    if (!text(config.workingDirectory, 4096)) return "Application working directory exceeds its text limit.";
    if (!allowIncomplete && ["run", "debug"].includes(operation) && config.workingDirectory !== "" &&
        (/[\\:\u0000-\u001f\u007f-\u009f]/.test(config.workingDirectory) || config.workingDirectory.startsWith("/") ||
         (config.workingDirectory !== "." && config.workingDirectory.split("/").some((part) => !part || part === "." || part === ".."))))
      return "Choose an existing workspace-relative application working directory, or leave it empty for the selected project.";
  }
  const attach = config.debuggerAttach ?? { host: "127.0.0.1", port: "5005" };
  if (!attach || !text(attach.host, 255) || !text(attach.port, 5))
    return "JDWP connection settings exceed their text limits.";
  if (!allowIncomplete && operation === "attach") {
    if (config.debuggerMode !== "jdi") return "Attach requires Structured Java debugger (JDI).";
    if (!attach.host || !/^[A-Za-z0-9._:\[\]-]+$/.test(attach.host))
      return "Enter a JDWP host name or IP address without spaces, paths or a wildcard.";
    if (!/^[0-9]{1,5}$/.test(attach.port) || Number(attach.port) < 1 || Number(attach.port) > 65535)
      return "Enter a decimal JDWP port from 1 to 65535.";
  }
  const args = config.programArguments;
  if (
    args !== undefined &&
    (!Array.isArray(args) ||
      args.length > 128 ||
      args.some((value) => !text(value, 4096)) ||
      args.reduce((total, value) => total + bytes(value), 0) > 16384)
  )
    return "Application arguments exceed their count, size or text limits.";
  const variables = config.environment;
  for (const [options, active, name] of [
    [config.jvmOptions, operation === "run" || operation === "debug", "Application"],
    [
      config.testJvmOptions,
      ["test", "integration-test", "integration-coverage", "coverage", "discover"].includes(
        operation,
      ),
      "Test",
    ],
  ] as const) {
    if (options !== undefined) {
      if (
        !Array.isArray(options) ||
        options.length > 128 ||
        options.some((value) => !text(value, 4096)) ||
        options.reduce((total, value) => total + bytes(value), 0) > 16384
      )
        return `${name} JVM options exceed their count, size or text limits.`;
      if (!allowIncomplete && active) {
        for (const option of options) {
          if (!option.startsWith("-") || option === "-")
            return "Use one JVM option per row, with --option=value for values. Empty rows are incomplete settings.";
          if (
            [
              "-cp",
              "-classpath",
              "--class-path",
              "-jar",
              "-m",
              "--module",
              "-p",
              "--module-path",
              "--source",
              "--",
            ].includes(option.split("=", 1)[0])
          )
            return "Use the main class and classpath controls instead of JVM launcher selectors.";
          if (name === "Test" && option.split("=", 1)[0] === "-Dide.test.jvm.options")
            return "The ide.test.jvm.options property is reserved for test JVM verification.";
        }
      }
    }
  }
  if (variables !== undefined) {
    if (!Array.isArray(variables) || variables.length > 64)
      return "Too many or invalid environment variables (limit 64).";
    const names = new Set<string>();
    let size = 0;
    for (const variable of variables) {
      if (
        !variable ||
        !text(variable.name, 128) ||
        (!allowIncomplete && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name)) ||
        !text(variable.value, 4096)
      )
        return "Use valid environment names and bounded values without NUL characters.";
      if (!allowIncomplete && /^(JAVA_HOME|IDE_JAVA_HOME)$/i.test(variable.name))
        return "Choose the JDK directory instead of overriding JAVA_HOME or IDE_JAVA_HOME.";
      if (!allowIncomplete && names.has(variable.name))
        return "Environment variable names must be unique.";
      names.add(variable.name);
      size += bytes(variable.name) + bytes(variable.value);
    }
    if (size > 32768) return "Environment overrides exceed the 32 KiB limit.";
  }
  if (
    config.jdkHome !== undefined &&
    (!text(config.jdkHome, 4096) ||
      /[\r\n]/.test(config.jdkHome) ||
      (!allowIncomplete &&
        config.jdkHome !== "" &&
        !/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(config.jdkHome)))
  )
    return "Choose an absolute full-JDK directory.";
  return null;
}
