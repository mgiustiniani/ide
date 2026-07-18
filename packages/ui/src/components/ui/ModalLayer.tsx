import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ModalLayerProps {
  readonly children: ReactNode;
  readonly className?: string;
}

const BLOCKED_BACKGROUND_EVENTS = [
  "click",
  "contextmenu",
  "dblclick",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "touchend",
  "touchstart",
] as const;

/**
 * Owns the top-level stacking and pointer-isolation boundary for an open modal.
 */
export function ModalLayer({ children, className = "" }: ModalLayerProps): JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const previousInertAttributes = new Map<Element, string | null>();
    const isolate = (element: Element): void => {
      if (element === layer || previousInertAttributes.has(element)) return;
      previousInertAttributes.set(element, element.getAttribute("inert"));
      element.setAttribute("inert", "");
    };

    for (const child of document.body.children) isolate(child);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) isolate(node);
        }
      }
    });
    observer.observe(document.body, { childList: true });

    const blockBackgroundPointerInteraction = (event: Event): void => {
      if (!(event.target instanceof Node) || layer.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const eventName of BLOCKED_BACKGROUND_EVENTS) {
      document.addEventListener(eventName, blockBackgroundPointerInteraction, true);
    }

    return () => {
      observer.disconnect();
      for (const eventName of BLOCKED_BACKGROUND_EVENTS) {
        document.removeEventListener(eventName, blockBackgroundPointerInteraction, true);
      }
      for (const [element, previousValue] of previousInertAttributes) {
        if (previousValue === null) element.removeAttribute("inert");
        else element.setAttribute("inert", previousValue);
      }
    };
  }, []);

  return createPortal(
    <div
      ref={layerRef}
      data-dialog-layer="modal"
      className={`fixed inset-0 isolate z-[2147483647] pointer-events-auto ${className}`}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
