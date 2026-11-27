import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushObr, resetObrMock } from "../test/obrMock";

vi.mock("@owlbear-rodeo/sdk", () => import("../test/obrMock").then((m) => m.createSdkModule()));

import { obrSafe } from "./obrSafe";
import { ResizeObserver } from "./ResizeObserver";

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("D-02 OBR promises are caught", () => {
  it("obrSafe passes a value through and turns a rejection into a log and undefined", async () => {
    await expect(obrSafe(Promise.resolve(3), "x")).resolves.toBe(3);
    await expect(obrSafe(Promise.reject(new Error("RateLimitHit")), "x")).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("background page: a rejected popover.open is logged, not an unhandled rejection", async () => {
    const client = resetObrMock({ ready: false }).currentClient;
    client.popover.open.mockImplementationOnce(async () => Promise.reject(new Error("room closed")));
    vi.resetModules();
    await import("../background");
    client.setReady();
    await flushObr();
    expect(client.popover.open).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[savage-worlds-dice] opening the notification popover failed",
      expect.any(Error)
    );
  });

  it("action resize: a rejected setWidth is logged, not an unhandled rejection", async () => {
    const client = resetObrMock().currentClient;
    client.action.setWidth.mockImplementation(async () => Promise.reject(new Error("timeout")));
    render(<ResizeObserver />);
    await flushObr();
    expect(client.action.setWidth).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("[savage-worlds-dice] resizing the action popover failed", expect.any(Error));
  });
});
