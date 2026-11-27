import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { attachContextLossHandlers, useWebGLContextLoss } from "./contextLoss";

const lose = (canvas: HTMLCanvasElement) => {
  const event = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(event);
  return event;
};
const restore = (canvas: HTMLCanvasElement) =>
  canvas.dispatchEvent(new Event("webglcontextrestored"));

describe("T-52 WebGL context-loss handler (E-02)", () => {
  it("T-52 lost: preventDefault and onLost; restored: onRestored then invalidate", () => {
    const canvas = document.createElement("canvas");
    const cb = { invalidate: vi.fn(), onLost: vi.fn(), onRestored: vi.fn() };
    attachContextLossHandlers(canvas, cb);

    const event = lose(canvas);
    expect(event.defaultPrevented).toBe(true);
    expect(cb.onLost).toHaveBeenCalledTimes(1);
    expect(cb.invalidate).not.toHaveBeenCalled();

    restore(canvas);
    expect(cb.onRestored).toHaveBeenCalledTimes(1);
    expect(cb.invalidate).toHaveBeenCalledTimes(1);
  });

  it("T-52 the returned cleanup removes both listeners", () => {
    const canvas = document.createElement("canvas");
    const cb = { invalidate: vi.fn(), onLost: vi.fn(), onRestored: vi.fn() };
    const detach = attachContextLossHandlers(canvas, cb);
    detach();
    lose(canvas);
    restore(canvas);
    expect(cb.onLost).not.toHaveBeenCalled();
    expect(cb.onRestored).not.toHaveBeenCalled();
    expect(cb.invalidate).not.toHaveBeenCalled();
  });

  it("T-52 hook: lost flag, two losses stay one flag, restore clears it and invalidates", () => {
    const canvas = document.createElement("canvas");
    const invalidate = vi.fn();
    const { result } = renderHook(() => useWebGLContextLoss());
    act(() => result.current.onCreated({ gl: { domElement: canvas }, invalidate }));
    expect(result.current.lost).toBe(false);

    act(() => {
      lose(canvas);
      lose(canvas);
    });
    expect(result.current.lost).toBe(true);

    act(() => {
      restore(canvas);
    });
    expect(result.current.lost).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("T-52 hook: reload clears the flag, changes the canvas key and detaches the old canvas", () => {
    const canvas = document.createElement("canvas");
    const { result } = renderHook(() => useWebGLContextLoss());
    act(() => result.current.onCreated({ gl: { domElement: canvas }, invalidate: vi.fn() }));
    act(() => {
      lose(canvas);
    });
    const key = result.current.canvasKey;

    act(() => result.current.reload());
    expect(result.current.lost).toBe(false);
    expect(result.current.canvasKey).toBe(key + 1);

    // The old canvas no longer drives the state.
    act(() => {
      lose(canvas);
    });
    expect(result.current.lost).toBe(false);
  });

  it("T-52 hook: unmount removes the listeners", () => {
    const canvas = document.createElement("canvas");
    const remove = vi.spyOn(canvas, "removeEventListener");
    const { result, unmount } = renderHook(() => useWebGLContextLoss());
    act(() => result.current.onCreated({ gl: { domElement: canvas }, invalidate: vi.fn() }));
    unmount();
    expect(remove).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("webglcontextrestored", expect.any(Function));
    expect(() => lose(canvas)).not.toThrow();
  });
});
