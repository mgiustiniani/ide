import type { JavaLaunchConfiguration } from "@ide/contracts";

export function JavaDebuggerAttachSettings({
  configuration,
  disabled,
  update,
}: {
  configuration: JavaLaunchConfiguration;
  disabled: boolean;
  update(value: JavaLaunchConfiguration): void;
}) {
  const target = configuration.debuggerAttach ?? { host: "127.0.0.1", port: "5005" };
  const fieldClass =
    "w-full rounded border border-[var(--border-default)] bg-[var(--surface-editor)] p-1 font-mono";
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2">
      <legend>Attach to an existing JVM</legend>
      <label>
        JDWP host
        <input
          className={fieldClass}
          value={target.host}
          maxLength={255}
          onChange={(event) =>
            update({ ...configuration, debuggerAttach: { ...target, host: event.target.value } })
          }
        />
      </label>
      <label>
        JDWP port
        <input
          className={fieldClass}
          value={target.port}
          maxLength={5}
          inputMode="numeric"
          onChange={(event) =>
            update({ ...configuration, debuggerAttach: { ...target, port: event.target.value } })
          }
        />
      </label>
      <p>
        Attach connects to a JVM already listening for JDWP. It does not build, launch or save
        project files. Main class, classpath and application launch options apply to Run and Debug.
      </p>
      <p>
        Detach closes this debugger connection and leaves the external JVM running. Application
        output stays with that process. Saved Java files under the selected project path can be
        matched to JDI source paths for frame locations and line breakpoints. This does not verify
        that a local file produced the bytecode loaded by the external JVM; review the source before
        relying on line locations.
      </p>
    </fieldset>
  );
}
