import type { HttpFileDocument } from "./httpRequestFile";
import type { HttpClientPort } from "@ide/web-core/ports";
import { useHttpClientLibrary } from "./useHttpClientLibrary";
import { HttpClientPanel } from "./HttpClientPanel";
import { useHttpClientController } from "./useHttpClientController";

interface HttpClientFeatureProps {
  port: HttpClientPort;
  workspaceId: string | null;
  generation: number;
  activeDocument?: HttpFileDocument | null;
  getActiveDocument?(): HttpFileDocument | null;
}

export function HttpClientFeature({
  port,
  workspaceId,
  generation,
  activeDocument = null,
  getActiveDocument,
}: HttpClientFeatureProps): JSX.Element {
  const controller = useHttpClientController(port, workspaceId, generation);
  const library = useHttpClientLibrary(port, workspaceId, generation);
  return (
    <HttpClientPanel
      key={JSON.stringify([workspaceId, generation])}
      {...controller}
      oauthPort={port}
      activeDocument={activeDocument}
      getActiveDocument={getActiveDocument}
      supportsExplicitHttp11={port.supportsExplicitHttp11 === true}
      collections={library}
      workspaceId={workspaceId}
      generation={generation}
      onSend={controller.send}
      onLoadOpenApi={controller.loadOpenApi}
    />
  );
}
