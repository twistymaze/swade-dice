/**
 * Multi-client sync tests through the OBR mock (test plan section 3.2, sync safety 7b).
 *
 * Model: one process = one room. Client A runs the real app sender (`DiceRollSync` + dice store, as
 * the current client). The receivers of other clients (`RollHistoryTray`, `NotificationPopover`) are
 * mounted while their client is current; after mount they make no lazy OBR calls for known senders,
 * so they stay bound to their own client. Other senders that do not need the dice store (attacker,
 * old client) send raw payloads with their mock client.
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { createClient, flushObr, hub, ObrClient, resetObrMock } from "./obrMock";

vi.mock("@owlbear-rodeo/sdk", () => import("./obrMock").then((m) => m.createSdkModule()));

import { RollHistoryTray } from "../plugin/RollHistoryTray";
import { NotificationPopover } from "../plugin/NotificationPopover";
import { DiceRollSync } from "../plugin/DiceRollSync";
import { createPartyDirectory } from "../plugin/partyDirectory";
import {
  buildRollBroadcast,
  HISTORY_METADATA_KEY,
  parseRollResult,
  resetInvalidWarnings,
  ROLL_CHANNEL,
} from "../plugin/rollWire";
import { REVISION_TOAST_DELAY_MS, TOAST_DURATION_MS } from "../plugin/toastTiming";
import { useDiceRollStore } from "../dice/store";
import { useDiceControlsStore } from "../controls/store";
import { createWildDie } from "../helpers/wildDie";
import { generateDiceId } from "../helpers/generateDiceId";
import { DiceTransform } from "../types/DiceTransform";
import { SavageRollResult } from "../types/SavageWorldsTypes";

import popoverOpenFixture from "./fixtures/golden/popover.notification.open.json";
import traitWildDie from "./fixtures/golden/broadcast.rollResult.traitWildDie.json";
import modifierChanged from "./fixtures/golden/broadcast.rollResult.traitWildDie.modifierChanged.json";
import damage from "./fixtures/golden/broadcast.rollResult.damage.json";

const T: DiceTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const POPOVER = popoverOpenFixture.id;

let gm: ObrClient;
let a: ObrClient;
let b: ObrClient;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  gm = resetObrMock({ id: "u-gm", connectionId: "gm-conn", name: "GM", color: "#222222", role: "GM" }).currentClient;
  a = createClient({ id: "u-a", connectionId: "a-conn", name: "Ava", color: "#aa0000" });
  b = createClient({ id: "u-b", connectionId: "b-conn", name: "Bram", color: "#00aa00", actionOpen: false });
  hub().setCurrentClient(a);
  resetInvalidWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  act(() => {
    useDiceRollStore.getState().clearRoll();
    useDiceControlsStore.setState({ targetNumber: 4, traitModifier: 0, damageModifier: 0, wildDieEnabled: true });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Mount `ui` as `client` (its subscriptions bind to that client), then make A current again. */
async function mountAs(client: ObrClient, ui: ReactElement) {
  hub().setCurrentClient(client);
  const view = render(ui);
  await act(flushObr);
  hub().setCurrentClient(a);
  return view;
}

/** A finishes a TRAIT d6 + Wild Die roll with these faces through the real dice store. */
async function rollOnA(traitFace: number, wildFace: number, hidden = false) {
  const trait = { id: generateDiceId(), type: "D6" as const, style: "GALAXY" as const };
  const wild = createWildDie();
  await act(async () => {
    useDiceRollStore.getState().startRoll({ dice: [trait, wild], hidden }, { mode: "TRAIT" });
    useDiceRollStore.getState().checkAndProcessExplosion(trait.id, traitFace, T);
    useDiceRollStore.getState().checkAndProcessExplosion(wild.id, wildFace, T);
    await flushObr();
  });
}

/** A raw roll sent by a mock client (a client that does not run the dice store here). */
async function sendRaw(from: ObrClient, data: unknown) {
  await act(async () => {
    await from.broadcast.sendMessage(ROLL_CHANNEL, data, { destination: "ALL" }).catch(() => {});
    await flushObr();
  });
}

const v1 = (rollId: string, rev: number, result: unknown, from: ObrClient, player?: object) =>
  ({
    ...buildRollBroadcast(rollId, rev, parseRollResult(result) as SavageRollResult, {
      id: from.state.player.id,
      connectionId: from.state.player.connectionId,
      name: from.state.player.name,
      color: from.state.player.color,
      role: from.state.player.role,
    }),
    ...(player ? { player } : {}),
  });

const pills = (container: HTMLElement, name: string) =>
  within(container).queryAllByText(name).map((el) => el.parentElement as HTMLElement);

describe("T-04 a roll on one client reaches all clients with the same result", () => {
  it("GM, A and B each show one entry with identical text; A sent once", async () => {
    const trays = {
      gm: await mountAs(gm, <RollHistoryTray />),
      a: await mountAs(a, <RollHistoryTray />),
      b: await mountAs(b, <RollHistoryTray />),
    };
    await mountAs(a, <DiceRollSync />);
    await rollOnA(3, 5);

    expect(a.broadcast.sendMessage).toHaveBeenCalledTimes(1);
    const texts = Object.values(trays).map((view) => {
      const list = pills(view.container, "Ava");
      expect(list).toHaveLength(1); // A gets its own roll once (ALL + metadata echo deduped)
      return list[0]!.textContent;
    });
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toContain("5");
    expect(texts[0]).toContain("✓");
  });

  it("rolls in turn appear in the same order on every client", async () => {
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    const bTray = await mountAs(b, <RollHistoryTray />);
    await mountAs(a, <DiceRollSync />);
    await rollOnA(2, 1);
    await sendRaw(b, v1("b-roll", 0, damage.result, b));
    await rollOnA(4, 1);
    const order = (c: HTMLElement) =>
      within(c).getAllByText(/^(Ava|Bram)$/).map((el) => el.textContent);
    expect(order(gmTray.container)).toEqual(["Ava", "Bram", "Ava"]);
    expect(order(bTray.container)).toEqual(["Ava", "Bram", "Ava"]);
  });
});

describe("T-46 / OD-1 a post-roll edit reaches every client", () => {
  it("TN 4 -> 8 and modifier +1: one revision, one entry, new values, 'vs TN 8' (OD-6)", async () => {
    vi.useFakeTimers();
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    const bTray = await mountAs(b, <RollHistoryTray />);
    await mountAs(a, <DiceRollSync />);
    await rollOnA(6, 2); // d6 aces in this test? no: faces are set directly, no explosion die for 6 here
    // a 6 on a d6 explodes in TRAIT mode: finish the explosion die
    const explosion = useDiceRollStore.getState().explosionDice[0];
    if (explosion) {
      await act(async () => {
        useDiceRollStore.getState().checkAndProcessExplosion(explosion.id, 1, T);
        await flushObr();
      });
    }
    expect(within(bTray.container).queryByText(/vs TN/)).not.toBeInTheDocument();

    act(() => {
      useDiceControlsStore.getState().setTargetNumber(8);
      useDiceControlsStore.getState().setTraitModifier(1);
    });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(a.broadcast.sendMessage).toHaveBeenCalledTimes(2);
    for (const view of [gmTray, bTray]) {
      const [pill] = pills(view.container, "Ava");
      expect(pills(view.container, "Ava")).toHaveLength(1);
      expect(pill!.textContent).toContain("vs TN 8");
      expect(pill!.textContent).toContain("[d6+1]");
      expect(pill!.textContent).toContain("8"); // 6 + 1 explosion + 1 modifier
    }
    // The stored history has the revision too (late joiners see the edited values)
    const stored = a.state.player.metadata[HISTORY_METADATA_KEY] as { rolls: { rev: number; tn: number; mod: number }[] };
    expect(stored.rolls.at(-1)).toMatchObject({ rev: 1, tn: 8, mod: 1 });
  });

  it("T-16 clearing the roll sends nothing and remote histories keep the entry; a later TN change sends nothing", async () => {
    const bTray = await mountAs(b, <RollHistoryTray />);
    await mountAs(a, <DiceRollSync />);
    await rollOnA(3, 2);
    act(() => useDiceRollStore.getState().clearRoll());
    act(() => useDiceControlsStore.getState().setTargetNumber(6));
    await act(flushObr);
    expect(a.broadcast.sendMessage).toHaveBeenCalledTimes(1);
    expect(pills(bTray.container, "Ava")).toHaveLength(1);
  });
});

describe("T-03 / OD-3 hidden rolls", () => {
  it("are never sent or stored, also after an edit; receivers show nothing", async () => {
    vi.useFakeTimers();
    const bTray = await mountAs(b, <RollHistoryTray />);
    await mountAs(a, <DiceRollSync />);
    await rollOnA(3, 2, true);
    act(() => useDiceControlsStore.getState().setTargetNumber(6));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(a.broadcast.sendMessage).not.toHaveBeenCalled();
    expect(a.player.setMetadata).not.toHaveBeenCalled();
    expect(a.state.player.metadata).not.toHaveProperty(HISTORY_METADATA_KEY);
    expect(within(bTray.container).getByText("Party dice rolls appear here")).toBeInTheDocument();
  });

  it("a visible roll, then a hidden one: only the visible one is ever sent", async () => {
    await mountAs(a, <DiceRollSync />);
    await rollOnA(3, 2);
    await rollOnA(4, 2, true);
    expect(a.broadcast.sendMessage).toHaveBeenCalledTimes(1);
    const stored = a.state.player.metadata[HISTORY_METADATA_KEY] as { rolls: unknown[] };
    expect(stored.rolls).toHaveLength(1);
  });
});

describe("T-15 / OD-2 history rebuilt from player metadata; players joining and leaving", () => {
  it("a late joiner and a reload see the earlier rolls in order; the roller's own remount too", async () => {
    await mountAs(a, <DiceRollSync />);
    await rollOnA(2, 1);
    await rollOnA(3, 1);
    await rollOnA(4, 1);

    const c = createClient({ id: "u-c", connectionId: "c-conn", name: "Cy" });
    const cTray = await mountAs(c, <RollHistoryTray />);
    const totals = (container: HTMLElement) =>
      pills(container, "Ava").map((p) => p.textContent?.match(/\]\s*(\d+)/)?.[1]);
    expect(totals(cTray.container)).toEqual(["2", "3", "4"]);

    const bTray = await mountAs(b, <RollHistoryTray />);
    bTray.unmount();
    const bAgain = await mountAs(b, <RollHistoryTray />);
    expect(totals(bAgain.container)).toEqual(["2", "3", "4"]);

    const aTray = await mountAs(a, <RollHistoryTray />);
    expect(totals(aTray.container)).toEqual(["2", "3", "4"]);
  });

  it("a player who leaves keeps their entries (and name); later rolls still arrive", async () => {
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    await mountAs(a, <DiceRollSync />);
    await sendRaw(b, v1("b1", 0, damage.result, b));
    await act(async () => {
      b.leave();
      await flushObr();
    });
    await rollOnA(3, 1);
    expect(pills(gmTray.container, "Bram")).toHaveLength(1);
    expect(pills(gmTray.container, "Ava")).toHaveLength(1);
  });

  it("history metadata written by another player shows up on a party change (no broadcast needed)", async () => {
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    const result = parseRollResult(traitWildDie.result) as SavageRollResult;
    await act(async () => {
      await b.player.setMetadata({
        [HISTORY_METADATA_KEY]: { v: 1, rolls: [{ id: "m1", rev: 0, t: result.timestamp, m: "TRAIT", tn: 4, mod: 1, w: 1, c: [["D8", 0, 3], ["D6", 1, 5]] }] },
      });
      await flushObr();
    });
    expect(pills(gmTray.container, "Bram")).toHaveLength(1);
    expect(pills(gmTray.container, "Bram")[0]!.textContent).toContain("6");
  });

  it("invalid history metadata is dropped with one warning; the tray keeps working", async () => {
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    await act(async () => {
      await b.player.setMetadata({ [HISTORY_METADATA_KEY]: { v: 1, rolls: [{ id: "x", c: "boom" }] } });
      await b.player.setMetadata({ [HISTORY_METADATA_KEY]: "garbage" });
      await flushObr();
    });
    expect(warn).toHaveBeenCalledTimes(1);
    await sendRaw(b, v1("ok", 0, damage.result, b));
    expect(pills(gmTray.container, "Bram")).toHaveLength(1);
  });
});

describe("T-05 bad and hostile payloads: rejected without crashing, valid rolls still shown", () => {
  const valid = structuredClone(traitWildDie);
  const bad: [string, unknown][] = [
    ["null", null],
    ["string", "str"],
    ["array", []],
    ["no result", { playerId: "x", player: valid.player }],
    ["outcomes string", { ...valid, result: { ...valid.result, outcomes: "abc" } }],
    ["outcomes [null]", { ...valid, result: { ...valid.result, outcomes: [null] } }],
    ["chains empty", { ...valid, result: { ...valid.result, outcomes: [{ ...valid.result.outcomes[0], chains: [] }] } }],
    ["dieType __proto__", { ...valid, result: { ...valid.result, mode: "DAMAGE", dieChains: [{ ...valid.result.dieChains[0], dieType: "__proto__" }] } }],
    ["7000-roll chain", { ...valid, result: { ...valid.result, dieChains: [{ dieId: "1", dieType: "D8", rolls: Array(7000).fill(1), total: 7000 }] } }],
    ["timestamp NaN-ish", { ...valid, result: { ...valid.result, timestamp: "abc" } }],
    ["forged future timestamp + bad v", { ...valid, v: "9", result: { ...valid.result, timestamp: 8.64e15 } }],
  ];

  it("table: each bad payload is dropped; one warning per sender; then a valid roll shows", async () => {
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    for (const [, data] of bad) await sendRaw(b, data);
    expect(within(gmTray.container).getByText("Party dice rolls appear here")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(1);
    await sendRaw(b, valid);
    expect(pills(gmTray.container, "Bram")).toHaveLength(1);
  });

  it("the popover survives the same table and still toasts the valid roll", async () => {
    await b.popover.open(popoverOpenFixture);
    await mountAs(b, <NotificationPopover />);
    hub().setCurrentClient(b);
    for (const [, data] of bad) await sendRaw(a, data);
    expect(b.state.popovers.get(POPOVER)).toMatchObject({ width: 0, height: 0 });
    await sendRaw(a, valid);
    expect(await screen.findByText("Ava:")).toBeInTheDocument();
  });

  it("C-03/C-07 payload name and CSS color are ignored: OBR name and color are shown", async () => {
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    await sendRaw(b, { ...valid, player: { ...valid.player, name: "<img src=x onerror=alert(1)>", color: "#000;background-image:url(https://evil)}body{display:none" } });
    const [pill] = pills(gmTray.container, "Bram");
    expect(pill).toBeDefined();
    expect(gmTray.container.querySelector("img")).toBeNull();
    expect(document.head.innerHTML).not.toContain("evil");
  });
});

describe("T-49 sender identity from event.connectionId (C-02, B-05, B-10)", () => {
  it("B cannot pose as the GM or overwrite A's entry", async () => {
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    await mountAs(a, <DiceRollSync />);
    await rollOnA(3, 5);
    const aPayload = a.broadcast.sendMessage.mock.calls[0]![1] as { rollId: string };
    await sendRaw(b, v1(aPayload.rollId, 9, damage.result, b, { ...valid().player, name: "GM", color: "#222222" }));
    await sendRaw(b, { ...valid(), playerId: "a-conn" });
    expect(pills(gmTray.container, "Ava")).toHaveLength(1);
    expect(pills(gmTray.container, "Ava")[0]!.textContent).toContain("✓");
    expect(pills(gmTray.container, "Bram")).toHaveLength(2);
    expect(within(gmTray.container).queryAllByText("GM")).toHaveLength(0);
  });

  it("an unknown connection (not in the party) is dropped with a warning", async () => {
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    await act(async () => {
      gm.emitters.broadcast.get(ROLL_CHANNEL)?.emit({ data: valid(), connectionId: "ghost" });
      await flushObr();
    });
    expect(within(gmTray.container).getByText("Party dice rolls appear here")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("two tabs of one user rolling at the same ms are two entries", async () => {
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    const a2 = createClient({ id: "u-a", connectionId: "a2-conn", name: "Ava", color: "#aa0000" });
    await act(flushObr);
    await sendRaw(a, valid());
    await sendRaw(a2, valid());
    expect(pills(gmTray.container, "Ava")).toHaveLength(2);
  });

  it("the role comes from OBR, not from the payload", async () => {
    hub().setCurrentClient(b);
    const directory = createPartyDirectory();
    await directory.ready;
    expect(directory.resolve("gm-conn")).toMatchObject({ name: "GM", role: "GM", isSelf: false });
    expect(directory.resolve("b-conn")).toMatchObject({ isSelf: true });
    directory.dispose();
  });

  function valid() {
    return structuredClone(traitWildDie);
  }
});

describe("T-60 mixed versions in one room", () => {
  it("an old client's payload and a new client's roll both show, in arrival order; old revisions replace", async () => {
    const gmTray = await mountAs(gm, <RollHistoryTray />);
    await mountAs(a, <DiceRollSync />);
    await sendRaw(b, structuredClone(traitWildDie)); // old client: no v, no rollId
    await rollOnA(3, 1);
    await sendRaw(b, structuredClone(modifierChanged)); // old client's revision: same timestamp
    const names = within(gmTray.container).getAllByText(/^(Ava|Bram)$/).map((el) => el.textContent);
    expect(names).toEqual(["Bram", "Ava"]);
    expect(pills(gmTray.container, "Bram")[0]!.textContent).toContain("[d8-2]");
  });
});

describe("T-59 / T-26 / OD-7 notification popover", () => {
  async function mountPopover() {
    await b.popover.open(popoverOpenFixture);
    await mountAs(b, <NotificationPopover />);
    hub().setCurrentClient(b);
  }
  const toastCount = () => b.popover.setWidth.mock.calls.filter((c) => c[1] === 600).length;

  it("a new roll toasts once; three quick revisions toast once more, marked revised, after they settle", async () => {
    vi.useFakeTimers();
    await mountPopover();
    await sendRaw(a, v1("r1", 0, traitWildDie.result, a));
    expect(screen.getByText("Ava:")).toBeInTheDocument();
    expect(toastCount()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(TOAST_DURATION_MS + 10));
    expect(screen.queryByText("Ava:")).not.toBeInTheDocument();

    await sendRaw(a, v1("r1", 1, modifierChanged.result, a));
    await sendRaw(a, v1("r1", 2, traitWildDie.result, a));
    await sendRaw(a, v1("r1", 3, modifierChanged.result, a));
    await sendRaw(a, v1("r1", 3, modifierChanged.result, a)); // retry duplicate
    await sendRaw(a, v1("r1", 1, traitWildDie.result, a)); // older revision
    expect(toastCount()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(REVISION_TOAST_DELAY_MS + 10));
    expect(toastCount()).toBe(2);
    expect(screen.getByText("(revised)")).toBeInTheDocument();
    expect(screen.getByText("Ava:").parentElement?.textContent).toContain("[d8-2]");
  });

  it("OD-6 shows 'vs TN n' only when the TN is not 4", async () => {
    await mountPopover();
    await sendRaw(a, v1("r4", 0, traitWildDie.result, a));
    expect(screen.queryByText(/vs TN/)).not.toBeInTheDocument();
    await sendRaw(a, v1("r6", 0, { ...traitWildDie.result, targetNumber: 6 }, a));
    expect(screen.getByText(/vs TN 6/)).toBeInTheDocument();
  });

  it("B-11 no toast for this client's own roll; one broadcast subscription over 5 open/close toggles", async () => {
    await mountPopover();
    await sendRaw(b, v1("mine", 0, traitWildDie.result, b));
    expect(screen.queryByText("Bram:")).not.toBeInTheDocument();
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        b.setActionOpen(i % 2 === 0);
        await flushObr();
      });
    }
    expect(b.emitters.broadcast.get(ROLL_CHANNEL)?.size).toBe(1);
  });

  it("C-07 a long name is cut (CSS ellipsis) and capped at 64 characters", async () => {
    await act(async () => {
      a.setName("N".repeat(200));
      await flushObr();
    });
    await mountPopover();
    await sendRaw(a, v1("long", 0, traitWildDie.result, a));
    const name = screen.getByText(/^N+…:$/);
    expect(Array.from(name.textContent ?? "")).toHaveLength(65);
  });
});
