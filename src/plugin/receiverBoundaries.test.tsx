/** Error boundaries around the receivers: one bad render hides only itself. */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, flushObr, hub, ObrClient, resetObrMock } from "../test/obrMock";

vi.mock("@owlbear-rodeo/sdk", () => import("../test/obrMock").then((m) => m.createSdkModule()));

const flags = vi.hoisted(() => ({ throwToast: false, throwPillTotal: -1 }));

vi.mock("./RollNotification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./RollNotification")>();
  return {
    RollNotification: (props: Parameters<typeof actual.RollNotification>[0]) => {
      if (flags.throwToast) throw new Error("toast render failed");
      return actual.RollNotification(props);
    },
  };
});
vi.mock("./PlayerRollPill", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./PlayerRollPill")>();
  return {
    PlayerRollPill: (props: Parameters<typeof actual.PlayerRollPill>[0]) => {
      if (props.result?.outcomes[0]?.total === flags.throwPillTotal) throw new Error("pill render failed");
      return actual.PlayerRollPill(props);
    },
  };
});

import { NotificationPopover } from "./NotificationPopover";
import { RollHistoryTray } from "./RollHistoryTray";
import { ROLL_CHANNEL } from "./rollWire";
import popoverOpenFixture from "../test/fixtures/golden/popover.notification.open.json";
import traitWildDie from "../test/fixtures/golden/broadcast.rollResult.traitWildDie.json";
import damage from "../test/fixtures/golden/broadcast.rollResult.damage.json";

let remote: ObrClient;

beforeEach(() => {
  resetObrMock({ id: "self", connectionId: "self-conn", name: "Self", actionOpen: false });
  remote = createClient({ name: "Wren", color: "#4e9a06" });
  flags.throwToast = false;
  flags.throwPillTotal = -1;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function send(data: unknown) {
  await act(async () => {
    await remote.broadcast.sendMessage(ROLL_CHANNEL, data, { destination: "ALL" });
    await flushObr();
  });
}

describe("receiver error boundaries", () => {
  it("a history entry that throws hides only itself; the other entries and later rolls show", async () => {
    flags.throwPillTotal = 13; // the damage fixture
    render(<RollHistoryTray />);
    await act(flushObr);
    await send(structuredClone(traitWildDie));
    await send(structuredClone(damage));
    await send({ ...structuredClone(traitWildDie), result: { ...traitWildDie.result, timestamp: 1764250099999 } });
    expect(screen.getAllByText("Wren")).toHaveLength(2);
  });

  it("a toast that throws collapses the popover (no empty iframe blocks clicks); the next toast shows", async () => {
    const self = hub().currentClient;
    await self.popover.open(popoverOpenFixture);
    render(<NotificationPopover />);
    await act(flushObr);
    flags.throwToast = true;
    await send(structuredClone(traitWildDie));
    await act(flushObr);
    expect(self.state.popovers.get(popoverOpenFixture.id)).toMatchObject({ width: 0, height: 0 });
    flags.throwToast = false;
    await send(structuredClone(damage));
    expect(await screen.findByText("Wren:")).toBeInTheDocument();
    expect(self.state.popovers.get(popoverOpenFixture.id)).toMatchObject({ width: 600, height: 160 });
  });
});
