import { useState } from "react";
import ReactDOM from "react-dom/client";

import {
  DEFAULT_PANEL_LAYOUT,
  type PanelLayout as PanelLayoutContract,
} from "../../../../packages/contracts/src/panel";
import {
  BottomPanel,
  LeftSidebar,
  PanelLayout,
} from "../../../../packages/ui/src/components/PanelLayout";
import "../../../../packages/ui/src/styles/globals.css";

function DesktopPanelLayoutContractHarness(): JSX.Element {
  const [layout, setLayout] = useState<PanelLayoutContract>(() => ({
    visibility: {
      leftSidebar: { ...DEFAULT_PANEL_LAYOUT.visibility.leftSidebar },
      mainArea: { ...DEFAULT_PANEL_LAYOUT.visibility.mainArea },
      bottomPanel: { ...DEFAULT_PANEL_LAYOUT.visibility.bottomPanel },
    },
    sizes: { ...DEFAULT_PANEL_LAYOUT.sizes },
    minSizes: { ...DEFAULT_PANEL_LAYOUT.minSizes },
  }));
  const toggleVisibility = (panel: "leftSidebar" | "bottomPanel"): void => {
    setLayout((current) => ({
      ...current,
      visibility: {
        ...current.visibility,
        [panel]: {
          ...current.visibility[panel],
          visible: !current.visibility[panel].visible,
        },
      },
    }));
  };

  return (
    <div
      className="dark"
      style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw" }}
      data-story-layout-ready
    >
      <header
        data-story-top-level-chrome
        style={{
          alignItems: "center",
          background: "var(--surface-header)",
          borderBottom: "1px solid var(--border-default)",
          boxSizing: "border-box",
          color: "var(--text-primary)",
          display: "flex",
          flex: "0 0 40px",
          height: 40,
          padding: "0 12px",
        }}
      >
        Desktop IDE structural harness — not packaged GUI evidence
      </header>
      <div
        style={{
          flex: "0 0 calc(100vh - 40px)",
          height: "calc(100vh - 40px)",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <PanelLayout
          layout={layout}
          onResizeLeft={(width) => {
            setLayout((current) => ({
              ...current,
              sizes: { ...current.sizes, leftSidebarWidth: width },
            }));
          }}
          onResizeBottom={(height) => {
            setLayout((current) => ({
              ...current,
              sizes: { ...current.sizes, bottomPanelHeight: height },
            }));
          }}
          onToggleLeftSidebar={() => toggleVisibility("leftSidebar")}
          onToggleBottomPanel={() => toggleVisibility("bottomPanel")}
          leftSidebar={
            <LeftSidebar
              isVisible={layout.visibility.leftSidebar.visible}
              onToggle={() => toggleVisibility("leftSidebar")}
            >
              <div>Desktop workspace files</div>
            </LeftSidebar>
          }
          mainContent={<div style={{ height: "100%" }}>Desktop editor area</div>}
          bottomContent={
            <BottomPanel
              tabs={[{ id: "terminal", label: "Terminal", isActive: true, scope: "core" }]}
              onTabActivate={() => undefined}
            >
              <div>Desktop terminal</div>
            </BottomPanel>
          }
        />
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Desktop PanelLayout Story harness root is unavailable");
ReactDOM.createRoot(root).render(<DesktopPanelLayoutContractHarness />);
