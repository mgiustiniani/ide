import type { JavaDatabasePort } from "@ide/web-core/ports";
import { JavaDatabasePanel } from "./JavaDatabasePanel";
import { useJavaDatabaseController } from "./useJavaDatabaseController";

export interface JavaDatabaseFeatureProps {
  port: JavaDatabasePort;
  workspaceId: string | null;
  generation: number;
  jdkHome: string;
  workspaceSwitching?: boolean;
  onTransitionBlockReason?(reason: string | null): void;
}

export function JavaDatabaseFeature({
  port,
  workspaceId,
  generation,
  jdkHome,
  workspaceSwitching = false,
  onTransitionBlockReason,
}: JavaDatabaseFeatureProps): JSX.Element {
  const controller = useJavaDatabaseController(
    port,
    workspaceId,
    generation,
    jdkHome,
    workspaceSwitching,
    onTransitionBlockReason,
  );
  return (
    <JavaDatabasePanel
      key={workspaceId ?? "no-workspace"}
      {...controller}
      resultExportPort={port}
      workspaceId={workspaceId}
      generation={generation}
      jdkHome={jdkHome}
      onConnect={controller.connect}
      onDisconnect={controller.disconnect}
      onExecute={controller.execute}
      onExplain={controller.explain}
      onRefreshSchema={controller.refreshSchema}
      onTransaction={controller.controlTransaction}
      onCancel={controller.cancel}
    />
  );
}
