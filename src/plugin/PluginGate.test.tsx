/** Plugin gate, plugin theme and action width. */
import { act, render, screen } from "@testing-library/react";
import { useTheme } from "@mui/material/styles";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, flushObr, obr, resetObrMock } from "../test/obrMock";

vi.mock("@owlbear-rodeo/sdk", () => import("../test/obrMock").then((m) => m.createSdkModule()));

import { PluginGate } from "./PluginGate";
import { PluginThemeProvider } from "./PluginThemeProvider";
import { ResizeObserver } from "./ResizeObserver";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Mode() {
  const theme = useTheme();
  return <p>mode {theme.palette.mode} {theme.palette.primary.main}</p>;
}

describe("plugin gate", () => {
  it("not available -> children hidden", () => {
    resetObrMock({ available: false });
    render(<PluginGate><p>inside</p></PluginGate>);
    expect(screen.queryByText("inside")).not.toBeInTheDocument();
  });

  it("available, before ready -> hidden; after onReady -> shown", () => {
    resetObrMock({ ready: false });
    render(<PluginGate><p>inside</p></PluginGate>);
    expect(screen.queryByText("inside")).not.toBeInTheDocument();
    act(() => obr().setReady());
    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("available and ready -> shown", () => {
    resetObrMock();
    render(<PluginGate><p>inside</p></PluginGate>);
    expect(screen.getByText("inside")).toBeInTheDocument();
  });
});

describe("plugin theme", () => {
  it("outside OBR -> the default dark theme, no OBR theme call", () => {
    resetObrMock({ available: false, ready: false });
    render(<PluginThemeProvider><Mode /></PluginThemeProvider>);
    expect(screen.getByText("mode dark #bb99ff")).toBeInTheDocument();
    expect(obr().theme.getTheme).not.toHaveBeenCalled();
  });

  it("OBR theme LIGHT -> MUI light; theme.onChange updates; unmount unsubscribes", async () => {
    resetObrMock();
    act(() => obr().setTheme({ ...DEFAULT_THEME, mode: "LIGHT", primary: { ...DEFAULT_THEME.primary, main: "#123456" } }));
    const { unmount } = render(<PluginThemeProvider><Mode /></PluginThemeProvider>);
    await act(flushObr);
    expect(screen.getByText("mode light #123456")).toBeInTheDocument();
    expect(obr().emitters.theme.size).toBe(1);
    await act(async () => {
      obr().setTheme({ ...DEFAULT_THEME, mode: "DARK" });
      await flushObr();
    });
    expect(screen.getByText("mode dark #bb99ff")).toBeInTheDocument();
    unmount();
    expect(obr().emitters.theme.size).toBe(0);
  });

  it("waits for ready before reading the theme", async () => {
    resetObrMock({ ready: false });
    render(<PluginThemeProvider><Mode /></PluginThemeProvider>);
    expect(obr().theme.getTheme).not.toHaveBeenCalled();
    act(() => obr().setTheme({ ...DEFAULT_THEME, mode: "LIGHT" }));
    await act(async () => {
      obr().setReady();
      await flushObr();
    });
    expect(screen.getByText(/^mode light/)).toBeInTheDocument();
  });

  it("getTheme rejects -> a warning only, the default theme stays", async () => {
    resetObrMock();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error");
    obr().theme.getTheme.mockRejectedValueOnce(new Error("boom"));
    render(<PluginThemeProvider><Mode /></PluginThemeProvider>);
    await act(flushObr);
    expect(warn).toHaveBeenCalledWith("Failed to get OBR theme:", expect.any(Error));
    expect(error).not.toHaveBeenCalled();
    expect(screen.getByText("mode dark #bb99ff")).toBeInTheDocument();
  });
});

describe("action width", () => {
  beforeEach(() => {
    resetObrMock();
    vi.useFakeTimers();
  });

  it("mount -> setWidth(innerHeight / 2 + 40)", () => {
    window.innerHeight = 800;
    render(<ResizeObserver />);
    expect(obr().action.setWidth).toHaveBeenCalledTimes(1);
    expect(obr().action.setWidth).toHaveBeenLastCalledWith(440);
  });

  it("a resize burst is throttled to at most one call per 100 ms, the last size wins", () => {
    window.innerHeight = 800;
    render(<ResizeObserver />);
    obr().action.setWidth.mockClear();
    vi.advanceTimersByTime(200);
    for (let i = 0; i < 10; i++) {
      window.innerHeight = 600 + i * 10;
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(200);
    const calls = obr().action.setWidth.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2); // 100 ms window over a 100 ms burst: leading + trailing
    expect(obr().action.setWidth).toHaveBeenLastCalledWith(690 / 2 + 40);
  });

  it("unmount removes the resize listener", () => {
    const { unmount } = render(<ResizeObserver />);
    unmount();
    vi.advanceTimersByTime(200);
    obr().action.setWidth.mockClear();
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(200);
    expect(obr().action.setWidth).not.toHaveBeenCalled();
  });
});
