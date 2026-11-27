import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The real Canvas needs WebGL. This stand-in renders a <canvas>, calls onCreated
// like R3F does, and can be told to throw like a failing 3D subtree.
const canvasState = vi.hoisted(() => ({
  mounts: 0,
  throwError: false,
  invalidate: (() => {}) as () => void,
}));

vi.mock("@react-three/fiber", () => ({
  Canvas: ({
    onCreated,
  }: {
    onCreated?: (state: { gl: { domElement: HTMLCanvasElement }; invalidate: () => void }) => void;
  }) => {
    if (canvasState.throwError) throw new Error("3D subtree failed");
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
      canvasState.mounts += 1;
      if (ref.current) onCreated?.({ gl: { domElement: ref.current }, invalidate: canvasState.invalidate });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <canvas data-testid="tray-canvas" ref={ref} />;
  },
}));
vi.mock("@react-three/drei", () => ({
  ContactShadows: () => null,
  Environment: () => null,
  OrbitControls: () => null,
}));
vi.mock("../environment.hdr", () => ({ default: "environment.hdr" }));
vi.mock("../audio/AudioListenerProvider", () => ({ AudioListenerProvider: () => null }));
vi.mock("./Tray", () => ({ Tray: () => null }));
vi.mock("../dice/PreviewDiceRoll", () => ({ PreviewDiceRoll: () => null }));
vi.mock("../dice/InteractiveDiceRoll", () => ({ InteractiveDiceRoll: () => null }));
vi.mock("../fairness/FairnessTester", () => ({ FairnessTester: () => <p>fairness tester</p> }));
vi.mock("../controls/DiceRollControls", () => ({ DiceRollControls: () => <p>roll controls</p> }));
vi.mock("../debug/store", () => ({
  useDebugStore: (select: (s: { allowOrbit: boolean }) => unknown) => select({ allowOrbit: false }),
}));
const controls = vi.hoisted(() => ({ fairnessTesterOpen: false }));
vi.mock("../controls/store", () => ({
  useDiceControlsStore: (select: (s: typeof controls) => unknown) => select(controls),
}));

import { InteractiveTray } from "./InteractiveTray";

const canvas = () => screen.getByTestId("tray-canvas") as HTMLCanvasElement;
const lose = () => {
  act(() => {
    canvas().dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  });
};

beforeEach(() => {
  canvasState.mounts = 0;
  canvasState.throwError = false;
  canvasState.invalidate = vi.fn();
  controls.fairnessTesterOpen = false;
});

describe("T-52 InteractiveTray context loss (E-02)", () => {
  it("T-52 a lost context shows one Reload tray overlay; restore hides it and invalidates", () => {
    render(<InteractiveTray />);
    expect(screen.queryByText("Reload tray")).toBeNull();

    lose();
    lose();
    expect(screen.getAllByText("Reload tray")).toHaveLength(1);

    act(() => {
      canvas().dispatchEvent(new Event("webglcontextrestored"));
    });
    expect(screen.queryByText("Reload tray")).toBeNull();
    expect(canvasState.invalidate).toHaveBeenCalledTimes(1);
  });

  it("T-52 Reload tray remounts the Canvas", () => {
    render(<InteractiveTray />);
    expect(canvasState.mounts).toBe(1);
    lose();
    fireEvent.click(screen.getByText("Reload tray"));
    expect(canvasState.mounts).toBe(2);
    expect(screen.queryByText("Reload tray")).toBeNull();
    // The new canvas is watched too.
    lose();
    expect(screen.getByText("Reload tray")).toBeInTheDocument();
  });

  it("T-52 after unmount a context event does nothing", () => {
    const { unmount } = render(<InteractiveTray />);
    const el = canvas();
    const remove = vi.spyOn(el, "removeEventListener");
    unmount();
    expect(remove).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
    expect(() => el.dispatchEvent(new Event("webglcontextlost", { cancelable: true }))).not.toThrow();
  });
});

describe("T-51 InteractiveTray error boundary (D-02)", () => {
  it("T-51 a 3D error shows the fallback, the roll controls stay, Reload tray recovers", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    canvasState.throwError = true;
    render(<InteractiveTray />);

    expect(screen.getByText(/stopped because of an error/)).toBeInTheDocument();
    expect(screen.getByText("roll controls")).toBeInTheDocument();

    canvasState.throwError = false;
    fireEvent.click(screen.getByText("Reload tray"));
    expect(screen.getByTestId("tray-canvas")).toBeInTheDocument();
    expect(screen.queryByText(/stopped because of an error/)).toBeNull();
    consoleError.mockRestore();
  });
});
