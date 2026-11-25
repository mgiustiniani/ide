import React from "react";
import type { JavaExecutionCapabilities, JavaLaunchConfiguration } from "@ide/contracts";

export function JavaLaunchSettings({
  configuration,
  capabilities,
  disabled,
  update,
  projectJdkHome,
}: {
  configuration: JavaLaunchConfiguration;
  capabilities: JavaExecutionCapabilities | null;
  disabled: boolean;
  update(value: JavaLaunchConfiguration): void;
  projectJdkHome?: string;
}) {
  const args = configuration.programArguments ?? [];
  const options = configuration.jvmOptions ?? [];
  const testOptions = configuration.testJvmOptions ?? [];
  const variables = configuration.environment ?? [];
  const fieldClass =
    "w-full rounded border border-[var(--border-default)] bg-[var(--surface-editor)] p-1 font-mono";
  const buttonClass = "rounded border px-2 py-1 disabled:opacity-40";
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2">
      <legend className="font-semibold">Launch settings</legend>
      <label>
        Application working directory (workspace-relative; optional)
        <input className={fieldClass} value={configuration.workingDirectory ?? ""}
          placeholder="Selected project directory"
          onChange={(event) => update({ ...configuration, workingDirectory: event.target.value })} />
      </label>
      <p className="text-xs">
        Run and Debug use this existing workspace directory. Empty uses the selected project;
        a single dot uses the workspace root. Build, tests and discovery keep their project directory.
      </p>
      <label>
        JDK directory (absolute; optional)
        <input
          className={fieldClass}
          value={projectJdkHome ?? configuration.jdkHome ?? ""}
          disabled={projectJdkHome !== undefined}
          placeholder="IDE default JDK"
          onChange={(event) => update({ ...configuration, jdkHome: event.target.value })}
        />
      </label>
      {capabilities?.effectiveJdkHome && (
        <p className="text-xs break-all">Selected JDK: {capabilities.effectiveJdkHome}</p>
      )}
      {projectJdkHome !== undefined ? (
        <p className="text-xs">Project JDK is selected in Java Project.</p>
      ) : (
        <p className="text-xs">
          Build-tool project toolchains can select their own compiler or runtime.
        </p>
      )}
      <p className="font-medium">Application JVM options (Run and Debug)</p>
      <p className="text-xs">
        One option per row, such as -Xmx512m or -Dmode=local. Use --option=value when a value is
        required. These options apply to the application JVM. Run tests has separate options below.
        {projectJdkHome !== undefined
          ? " The selected main class runs with the project runtime classpath and these launch options."
          : " Gradle appends them to the application's JVM defaults. Maven uses a separate JVM and the application arguments entered here when JVM options or a working directory are supplied."}
      </p>
      {options.map((value, index) => (
        <div key={index} className="flex items-start gap-1">
          <label className="flex-1">
            JVM option {index + 1}
            <textarea
              className={fieldClass}
              rows={1}
              value={value}
              onChange={(event) =>
                update({
                  ...configuration,
                  jvmOptions: options.map((old, position) =>
                    position === index ? event.target.value : old,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            className={buttonClass}
            aria-label={`Remove JVM option ${index + 1}`}
            onClick={() =>
              update({
                ...configuration,
                jvmOptions: options.filter((_, position) => position !== index),
              })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className={buttonClass}
        disabled={options.length >= 128}
        onClick={() => update({ ...configuration, jvmOptions: [...options, ""] })}
      >
        Add JVM option
      </button>
      <p className="font-medium">Test JVM options (unit and integration tests)</p>
      <p className="text-xs">
        One literal option per row, such as -Xmx512m or -Dmode=test. Gradle adds these to the test
        task's JVM settings. Maven passes these through the Surefire/Failsafe argLine property;
        include any required agent options here. A project argLine or in-process tests can prevent
        safe application; unconfirmed settings are reported as a configuration failure. No rows
        retain the project's test JVM settings. Build, Run and Debug ignore these options.
      </p>
      {testOptions.map((value, index) => (
        <div key={index} className="flex items-start gap-1">
          <label className="flex-1">
            Test JVM option {index + 1}
            <textarea
              className={fieldClass}
              rows={1}
              value={value}
              onChange={(event) =>
                update({
                  ...configuration,
                  testJvmOptions: testOptions.map((old, position) =>
                    position === index ? event.target.value : old,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            className={buttonClass}
            aria-label={`Remove test JVM option ${index + 1}`}
            onClick={() =>
              update({
                ...configuration,
                testJvmOptions: testOptions.filter((_, position) => position !== index),
              })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className={buttonClass}
        disabled={testOptions.length >= 128}
        onClick={() => update({ ...configuration, testJvmOptions: [...testOptions, ""] })}
      >
        Add test JVM option
      </button>
      <p className="font-medium">Application arguments</p>
      <p className="text-xs">
        One literal value per row for Run and Debug. Spaces and quotes stay in the value; an empty
        row passes an empty argument. With no rows, build-tool argument defaults apply except Maven
        Run with explicit JVM options.
      </p>
      {args.map((value, index) => (
        <div key={index} className="flex items-start gap-1">
          <label className="flex-1">
            Argument {index + 1}
            <textarea
              className={fieldClass}
              rows={1}
              value={value}
              onChange={(event) =>
                update({
                  ...configuration,
                  programArguments: args.map((old, position) =>
                    position === index ? event.target.value : old,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            className={buttonClass}
            aria-label={`Remove argument ${index + 1}`}
            onClick={() =>
              update({
                ...configuration,
                programArguments: args.filter((_, position) => position !== index),
              })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className={buttonClass}
        disabled={args.length >= 128}
        onClick={() => update({ ...configuration, programArguments: [...args, ""] })}
      >
        Add argument
      </button>
      <p className="font-medium">Environment overrides</p>
      <p className="text-xs">
        Values apply to the child compiler, build tool, application and debugger. Use the JDK
        directory field for JAVA_HOME. Settings are saved locally on this device.
      </p>
      {variables.map((variable, index) => (
        <div key={index} className="flex flex-col gap-1 rounded border p-1">
          <label>
            Variable {index + 1} name
            <input
              className={fieldClass}
              value={variable.name}
              onChange={(event) =>
                update({
                  ...configuration,
                  environment: variables.map((old, position) =>
                    position === index ? { ...old, name: event.target.value } : old,
                  ),
                })
              }
            />
          </label>
          <label>
            Variable {index + 1} value
            <textarea
              className={fieldClass}
              rows={1}
              value={variable.value}
              onChange={(event) =>
                update({
                  ...configuration,
                  environment: variables.map((old, position) =>
                    position === index ? { ...old, value: event.target.value } : old,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            className={buttonClass}
            aria-label={`Remove variable ${index + 1}`}
            onClick={() =>
              update({
                ...configuration,
                environment: variables.filter((_, position) => position !== index),
              })
            }
          >
            Remove variable
          </button>
        </div>
      ))}
      <button
        type="button"
        className={buttonClass}
        disabled={variables.length >= 64}
        onClick={() =>
          update({ ...configuration, environment: [...variables, { name: "", value: "" }] })
        }
      >
        Add environment variable
      </button>
    </fieldset>
  );
}
