import { useCallback, useEffect, useRef, useState } from "react";

export interface ContextLossCallbacks {
  /** Request a new frame (R3F `invalidate`, needed with `frameloop="demand"`) */
  invalidate: () => void;
  onLost: () => void;
  onRestored: () => void;
}

/**
 * Listen for WebGL context loss and restore on a canvas.
 * `preventDefault()` on the lost event tells the browser that the page can
 * handle a restore. Returns a function that removes the listeners.
 */
export function attachContextLossHandlers(
  canvas: HTMLCanvasElement,
  { invalidate, onLost, onRestored }: ContextLossCallbacks
) {
  const handleLost = (event: Event) => {
    event.preventDefault();
    onLost();
  };
  const handleRestored = () => {
    onRestored();
    // With frameloop="demand" nothing draws again until a frame is requested.
    invalidate();
  };
  canvas.addEventListener("webglcontextlost", handleLost);
  canvas.addEventListener("webglcontextrestored", handleRestored);
  return () => {
    canvas.removeEventListener("webglcontextlost", handleLost);
    canvas.removeEventListener("webglcontextrestored", handleRestored);
  };
}

/** The parts of the R3F root state that `onCreated` needs */
export interface ContextLossRootState {
  gl: { domElement: HTMLCanvasElement };
  invalidate: () => void;
}

/**
 * State for a Canvas that can lose its WebGL context.
 * - pass `onCreated` to the Canvas and `canvasKey` as its `key`
 * - show a "Reload tray" overlay while `lost`; `reload` remounts the Canvas
 */
export function useWebGLContextLoss() {
  const [lost, setLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const detachRef = useRef<(() => void) | null>(null);

  const detach = useCallback(() => {
    detachRef.current?.();
    detachRef.current = null;
  }, []);

  const onCreated = useCallback(
    (state: ContextLossRootState) => {
      detach();
      detachRef.current = attachContextLossHandlers(state.gl.domElement, {
        invalidate: state.invalidate,
        onLost: () => setLost(true),
        onRestored: () => setLost(false),
      });
    },
    [detach]
  );

  const reload = useCallback(() => {
    detach();
    setLost(false);
    setCanvasKey((key) => key + 1);
  }, [detach]);

  useEffect(() => detach, [detach]);

  return { lost, canvasKey, onCreated, reload };
}
