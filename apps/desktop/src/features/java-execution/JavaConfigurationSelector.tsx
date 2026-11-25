import React, { useState } from "react";
import { MAX_JAVA_CONFIGURATIONS } from "./javaLaunchConfigurations";
import type { JavaExecutionController } from "./useJavaExecutionController";

export function JavaConfigurationSelector({ controller }: { controller: JavaExecutionController }) {
  const selected = controller.configurations.find(
    (item) => item.id === controller.selectedConfigurationId,
  )!;
  const [name, setName] = useState(selected.name);
  const inputClass =
    "w-full rounded border border-[var(--border-default)] bg-[var(--surface-editor)] p-1";
  const buttonClass = "rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-40";
  return (
    <fieldset disabled={controller.running || controller.pending} className="flex flex-col gap-2">
      <legend>Saved configurations</legend>
      <label>
        Java configuration
        <select
          className={inputClass}
          value={controller.selectedConfigurationId}
          onChange={(event) => controller.selectConfiguration(event.target.value)}
        >
          {controller.configurations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Configuration name
        <input
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} onClick={() => controller.renameConfiguration(name)}>
          Rename configuration
        </button>
        <button
          className={buttonClass}
          disabled={controller.configurations.length >= MAX_JAVA_CONFIGURATIONS}
          onClick={() => controller.createConfiguration()}
        >
          New configuration
        </button>
        <button
          className={buttonClass}
          disabled={controller.configurations.length >= MAX_JAVA_CONFIGURATIONS}
          onClick={() => controller.createConfiguration(true)}
        >
          Duplicate configuration
        </button>
        <button
          className={buttonClass}
          disabled={controller.configurations.length === 1}
          onClick={() => controller.deleteConfiguration()}
        >
          Delete configuration
        </button>
      </div>
      <p className="text-xs">
        Changes are saved for this workspace. Run and test actions use the selected configuration.
      </p>
    </fieldset>
  );
}
