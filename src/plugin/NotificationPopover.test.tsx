/** Notification popover timing and size (fake timers). */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, flushObr, ObrClient, resetObrMock } from "../test/obrMock";

vi.mock("@owlbear-rodeo/sdk", () => import("../test/obrMock").then((m) => m.createSdkModule()));

import { NotificationPopover } from "./NotificationPopover";
import { ROLL_CHANNEL } from "./rollWire";
import { TOAST_DURATION_MS } from "./toastTiming";
import popoverOpen from "../test/fixtures/golden/popover.notification.open.json";
import traitWildDie from "../test/fixtures/golden/broadcast.rollResult.traitWildDie.json";
import damage from "../test/fixtures/golden/broadcast.rollResult.damage.json";

let self: ObrClient;
let remote: ObrClient;
const size = () => self.state.popovers.get(popoverOpen.id);

beforeEach(async () => {
  vi.useFakeTimers();
  self = resetObrMock({ id: "self", connectionId: "self-conn", name: "Self", actionOpen: false }).currentClient;
  remote = createClient({ name: "Wren", color: "#4e9a06" });
  await self.popover.open(structuredClone(popoverOpen));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function send(data: unknown) {
  await act(async () => {
    await remote.broadcast.sendMessage(ROLL_CHANNEL, structuredClone(data), { destination: "ALL" });
    await flushObr();
  });
}
async function mount() {
  const view = render(<NotificationPopover />);
  await act(flushObr);
  return view;
}
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("notification popover", () => {
  it("before any roll the popover stays 0 x 0", async () => {
    await mount();
    expect(size()).toMatchObject({ width: 0, height: 0 });
  });

  it("toast -> 600 x 160; after 10 s it hides and goes back to 0 x 0", async () => {
    await mount();
    await send(traitWildDie);
    expect(screen.getByText("Wren:")).toBeInTheDocument();
    expect(size()).toMatchObject({ width: 600, height: 160 });
    await advance(TOAST_DURATION_MS - 100);
    expect(screen.getByText("Wren:")).toBeInTheDocument();
    await advance(200);
    expect(screen.queryByText("Wren:")).not.toBeInTheDocument();
    expect(size()).toMatchObject({ width: 0, height: 0 });
  });

  it("a second roll at 5 s replaces the toast and restarts the 10 s timer", async () => {
    await mount();
    await send(traitWildDie);
    await advance(5000);
    await send({ ...damage, player: traitWildDie.player });
    expect(screen.getByText("Wren:").parentElement?.textContent).toContain("13");
    await advance(TOAST_DURATION_MS - 1000); // 14 s after the first roll
    expect(screen.getByText("Wren:")).toBeInTheDocument();
    await advance(1100);
    expect(screen.queryByText("Wren:")).not.toBeInTheDocument();
  });

  it("the action opens while a toast shows -> it hides at once; no toast while open", async () => {
    await mount();
    await send(traitWildDie);
    expect(screen.getByText("Wren:")).toBeInTheDocument();
    await act(async () => {
      self.setActionOpen(true);
      await flushObr();
    });
    expect(screen.queryByText("Wren:")).not.toBeInTheDocument();
    expect(size()).toMatchObject({ width: 0, height: 0 });
    await send({ ...damage, player: traitWildDie.player });
    expect(screen.queryByText("Wren:")).not.toBeInTheDocument();
  });

  it("an incomplete result is ignored", async () => {
    await mount();
    await send({ ...traitWildDie, result: { ...traitWildDie.result, isComplete: false } });
    expect(screen.queryByText("Wren:")).not.toBeInTheDocument();
    expect(size()).toMatchObject({ width: 0, height: 0 });
  });

  it("unmount clears the timer and the subscriptions: no warnings, no late state updates", async () => {
    const error = vi.spyOn(console, "error");
    const { unmount } = await mount();
    await send(traitWildDie);
    unmount();
    await advance(TOAST_DURATION_MS + 100);
    expect(vi.getTimerCount()).toBe(0);
    expect(self.emitters.actionOpen.size).toBe(0);
    expect(self.emitters.broadcast.get(ROLL_CHANNEL)?.size ?? 0).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });
});
