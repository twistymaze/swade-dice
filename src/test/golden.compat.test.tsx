/**
 * Golden compatibility tests: the cross-client and persisted CONTRACT of the app.
 *
 * Fixtures: src/test/fixtures/golden/ (see docs/app-owlbear-integration.md section 13). These tests run against the current code and
 * must keep passing after refactors, unless a verified finding changes the contract on purpose.
 *
 * Contract:
 * - One broadcast channel, `rodeo.owlbear.savage-worlds-dice/roll-result`, sent with destination ALL.
 * - Payload = the golden `{ playerId, player, result }` with the key structure of the fixtures, plus the
 *   new top-level keys `v`, `rollId`, `rev` (old readers ignore unknown keys).
 * - Only finished, not hidden rolls are broadcast.
 * - Receivers (roll history tray, notification popover) accept every fixture payload.
 * - Settings persist in three localStorage keys with string values.
 * - No room/scene metadata is written.
 *
 * Deliberate contract changes (verified findings), each with a test below:
 * - OD-5 / A-04: DAMAGE outcomes no longer carry `success`/`raises`. Old payloads with them are still read.
 * - A-03: STANDARD results have `modifier: 0` (result and outcomes), whatever the damage modifier.
 * - A-01 / A-02 / A-09: TRAIT outcomes may carry `criticalFailure: true` (then `success: false`,
 *   `raises: 0`) or `possibleCriticalFailure: true`, plus `criticalFailureReason`. The keys are absent
 *   otherwise, so non-crit payloads keep the golden key structure. Old payloads without them are read
 *   and the crit status is computed locally.
 * - OD-2: each player writes its last 10 rolls to ONE player metadata key, `.../history`.
 * - C-02: receivers take the sender name/color from OBR (the remote client here is named "Wren", like the
 *   fixtures), not from the payload `player` block, which is still sent for old readers.
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushObr, hub, obr, resetObrMock } from "./obrMock";

vi.mock("@owlbear-rodeo/sdk", () => import("./obrMock").then((m) => m.createSdkModule()));

import { RollHistoryTray } from "../plugin/RollHistoryTray";
import { NotificationPopover } from "../plugin/NotificationPopover";
import { DiceRollSync } from "../plugin/DiceRollSync";
import { getPluginId } from "../plugin/getPluginId";
import { HISTORY_METADATA_KEY } from "../plugin/rollWire";
import { useDiceRollStore } from "../dice/store";
import { useDiceControlsStore } from "../controls/store";

import ids from "./fixtures/golden/ids.json";
import popoverOpenFixture from "./fixtures/golden/popover.notification.open.json";
import eventFixture from "./fixtures/golden/broadcast.event.traitWildDie.json";
import localStorageControls from "./fixtures/golden/localStorage.controls.json";
import localStorageEmpty from "./fixtures/golden/localStorage.empty.json";
import rollHistoryEntries from "./fixtures/golden/rollHistory.entries.json";
import storeCleared from "./fixtures/golden/diceStore.cleared.json";
import storeInProgress from "./fixtures/golden/diceStore.inProgress.traitWildDie.json";
import storeExplosionPending from "./fixtures/golden/diceStore.explosionPending.json";
import storeFinishedTraitWild from "./fixtures/golden/diceStore.finished.traitWildDie.json";
import storeFinishedExploding from "./fixtures/golden/diceStore.finished.explodingChain.json";

type Json = unknown;
type RollFixture = {
  playerId: string;
  player: { name: string; color: string };
  result: { timestamp: number; isComplete: boolean; outcomes: { total: number }[]; [k: string]: Json };
};

const CHANNEL = "rodeo.owlbear.savage-worlds-dice/roll-result";
const NOTIFICATION_POPOVER = "rodeo.owlbear.savage-worlds-dice/notification-popover";

const broadcastFixtures = import.meta.glob<RollFixture>("./fixtures/golden/broadcast.rollResult.*.json", {
  eager: true,
  import: "default",
});
const fixture = (name: string): RollFixture => {
  const f = broadcastFixtures[`./fixtures/golden/broadcast.rollResult.${name}.json`];
  if (!f) throw new Error(`missing fixture ${name}`);
  return structuredClone(f);
};

/** Recursive key structure: objects -> sorted keys with child shapes, arrays -> element shapes. */
function shape(value: Json): Json {
  if (Array.isArray(value)) return value.map(shape);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, shape((value as Record<string, Json>)[k])])
    );
  }
  return value === null ? "null" : typeof value;
}

/** Another client in the room sends `data` on the roll channel, the way DiceRollSync does. */
async function sendFromRemote(data: Json) {
  const remote =
    hub().clients.find((c) => c !== obr()) ?? hub().createClient({ name: "Wren", color: "#4e9a06" });
  await act(async () => {
    await remote.broadcast.sendMessage(CHANNEL, data, { destination: "ALL" });
    await flushObr();
  });
  return remote;
}

/** Render the history tray and let it read the party. */
async function mountTray() {
  const view = render(<RollHistoryTray />);
  await act(flushObr);
  return view;
}

/** The pill of each history entry, in display order. */
function historyPills(name: string) {
  return screen.getAllByText(name).map((el) => el.parentElement as HTMLElement);
}

beforeEach(() => {
  resetObrMock({ id: "self", connectionId: "self-conn", name: "Self", role: "PLAYER" });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ids", () => {
  it("broadcast channel and popover ids come from getPluginId", () => {
    expect(getPluginId("roll-result")).toBe(CHANNEL);
    expect(ids.broadcastChannels.rollResult).toBe(CHANNEL);
    expect(getPluginId("notification-popover")).toBe(NOTIFICATION_POPOVER);
    expect(ids.popovers.notification).toBe(NOTIFICATION_POPOVER);
  });

  it("the golden app wrote no OBR metadata; OD-2 adds one player metadata key", () => {
    expect(ids.playerMetadataKeys).toEqual([]);
    expect(HISTORY_METADATA_KEY).toBe("rodeo.owlbear.savage-worlds-dice/history");
    expect(ids.roomMetadataKeys).toEqual([]);
    expect(ids.sceneMetadataKeys).toEqual([]);
  });

  it("every broadcast fixture has the RollBroadcast key structure", () => {
    const expectedTop = ["player", "playerId", "result"];
    const expectedPlayer = ["color", "connectionId", "id", "metadata", "name", "role", "syncView"];
    const requiredResult = ["dieChains", "isComplete", "mode", "modifier", "outcomes", "targetNumber", "timestamp", "wildDieEnabled"];
    for (const [file, f] of Object.entries(broadcastFixtures)) {
      expect(Object.keys(f).sort(), file).toEqual(expectedTop);
      expect(Object.keys(f.player).sort(), file).toEqual(expectedPlayer);
      expect(Object.keys(f.result).sort(), file).toEqual(requiredResult);
      expect(f.result.isComplete, file).toBe(true);
    }
    expect(Object.keys(broadcastFixtures)).toHaveLength(9);
  });

  it("the delivered event is { data, connectionId } with the payload as data", () => {
    expect(Object.keys(eventFixture).sort()).toEqual(["connectionId", "data"]);
    expect(eventFixture.data).toEqual(fixture("traitWildDie"));
  });
});

describe("background page", () => {
  it("opens the notification popover on ready with the golden arguments", async () => {
    const client = resetObrMock({ ready: false }).currentClient;
    await import("../background");
    expect(client.popover.open).not.toHaveBeenCalled();
    client.setReady();
    expect(client.popover.open).toHaveBeenCalledTimes(1);
    expect(client.popover.open).toHaveBeenCalledWith(popoverOpenFixture);
  });
});

describe("RollHistoryTray receives golden broadcasts", () => {
  it.each(Object.keys(broadcastFixtures).map((k) => k.replace(/^.*broadcast\.rollResult\.|\.json$/g, "")))(
    "%s: shows one entry with the player name and every outcome total",
    async (name) => {
      await mountTray();
      expect(screen.getByText("Party dice rolls appear here")).toBeInTheDocument();
      const f = fixture(name);
      await sendFromRemote(f);
      const pills = historyPills(f.player.name);
      expect(pills).toHaveLength(1);
      for (const o of f.result.outcomes) {
        expect(within(pills[0]!).getAllByText(String(o.total)).length).toBeGreaterThan(0);
      }
    }
  );

  it("a re-broadcast with the same playerId and timestamp replaces the entry (rollHistory.entries)", async () => {
    await mountTray();
    for (const name of ["traitWildDie", "traitNoWild", "damage", "explodingChain", "traitWildDie.modifierChanged"]) {
      await sendFromRemote(fixture(name));
    }
    const pills = historyPills("Wren");
    expect(pills).toHaveLength(rollHistoryEntries.length);
    rollHistoryEntries.forEach((entry, i) => {
      for (const o of entry.result.outcomes) {
        expect(within(pills[i]!).getAllByText(String(o.total)).length).toBeGreaterThan(0);
      }
    });
  });

  it("ignores incomplete results", async () => {
    await mountTray();
    const f = fixture("traitWildDie");
    f.result.isComplete = false;
    await sendFromRemote(f);
    expect(screen.queryByText("Wren")).not.toBeInTheDocument();
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = await mountTray();
    unmount();
    expect(obr().emitters.broadcast.get(CHANNEL)?.size ?? 0).toBe(0);
  });
});

describe("old payloads are still read after the contract changes", () => {
  it("OD-5: the old damage payload (with success/raises) shows its total and no success mark", async () => {
    await mountTray();
    const f = fixture("damage");
    expect(f.result.outcomes[0]).toHaveProperty("success", true);
    await sendFromRemote(f);
    const [pill] = historyPills(f.player.name);
    expect(within(pill!).getAllByText("13").length).toBeGreaterThan(0);
    expect(within(pill!).queryByText("✓")).not.toBeInTheDocument();
  });

  it("A-01: the old traitNoWild.rolledOne payload (no crit fields) shows the possible crit, computed locally", async () => {
    await mountTray();
    const f = fixture("traitNoWild.rolledOne");
    await sendFromRemote(f);
    const [pill] = historyPills(f.player.name);
    expect(within(pill!).getByText("??")).toBeInTheDocument();
  });
});

describe("NotificationPopover receives golden broadcasts", () => {
  async function mount(actionOpen: boolean) {
    const client = resetObrMock({ id: "self", name: "Self", actionOpen }).currentClient;
    await client.popover.open(popoverOpenFixture);
    render(<NotificationPopover />);
    await act(flushObr);
    return client;
  }

  it.each(Object.keys(broadcastFixtures).map((k) => k.replace(/^.*broadcast\.rollResult\.|\.json$/g, "")))(
    "%s: shows a toast with the player name and totals while the action is closed",
    async (name) => {
      const client = await mount(false);
      const f = fixture(name);
      await sendFromRemote(f);
      expect(await screen.findByText(`${f.player.name}:`)).toBeInTheDocument();
      for (const o of f.result.outcomes) {
        expect(screen.getAllByText(String(o.total)).length).toBeGreaterThan(0);
      }
      expect(client.state.popovers.get(NOTIFICATION_POPOVER)).toMatchObject({ width: 600, height: 160 });
    }
  );

  it("shows nothing while the action popover is open", async () => {
    const client = await mount(true);
    await sendFromRemote(fixture("traitWildDie"));
    expect(screen.queryByText("Wren:")).not.toBeInTheDocument();
    expect(client.state.popovers.get(NOTIFICATION_POPOVER)).toMatchObject({ width: 0, height: 0 });
  });
});

describe("DiceRollSync sends the golden payload", () => {
  type StoreFixture = Record<string, Json>;
  /** The finished result carries its own identity (rollId, and hidden copied from the roll, B-12). */
  const withIdentity = (s: StoreFixture) => {
    const state = structuredClone(s) as Record<string, unknown> & {
      roll?: { hidden?: boolean } | null;
      currentRollResult?: Record<string, unknown> | null;
    };
    if (state.currentRollResult) {
      state.currentRollResult = { ...state.currentRollResult, rollId: "golden-roll", hidden: state.roll?.hidden === true };
    }
    return state;
  };
  const setStore = (s: StoreFixture) => act(() => useDiceRollStore.setState(withIdentity(s) as never));
  /** The payload without the keys this change adds (v, rollId, rev): must keep the golden shape. */
  const legacyPart = (p: object) => {
    const { v: _v, rollId: _r, rev: _rev, ...rest } = p as Record<string, unknown>;
    return rest;
  };

  beforeEach(() => {
    act(() => {
      useDiceRollStore.setState(structuredClone(storeCleared) as never);
      useDiceControlsStore.setState({ traitModifier: 1, damageModifier: 0, targetNumber: 4, wildDieEnabled: true });
    });
  });

  async function mountSync() {
    const client = obr();
    render(<DiceRollSync />);
    await act(flushObr);
    return client;
  }

  const lastSend = (client: ReturnType<typeof obr>) => {
    const calls = client.broadcast.sendMessage.mock.calls;
    return calls[calls.length - 1] as unknown as [string, RollFixture, { destination: string }];
  };

  it("T-02 a finished roll is sent on the roll channel with destination ALL and the golden key structure", async () => {
    const client = await mountSync();
    const received = vi.fn();
    hub().createClient({ name: "Other" }).broadcast.onMessage(CHANNEL, received);
    await setStore(storeFinishedTraitWild);
    await act(flushObr);

    expect(client.broadcast.sendMessage).toHaveBeenCalledTimes(1);
    const [channel, payload, options] = lastSend(client);
    const golden = fixture("traitWildDie");
    expect(channel).toBe(CHANNEL);
    expect(options).toEqual({ destination: "ALL" });
    expect(shape(legacyPart(payload))).toEqual(shape(golden));
    expect(payload).toMatchObject({ v: 1, rollId: "golden-roll", rev: 0 });
    // The result is fully determined by the store + controls, so it matches the golden values.
    expect(payload.result).toEqual(golden.result);
    // B-10: real role and connection id from OBR (the block is kept for old readers)
    expect(payload.player).toMatchObject({ name: "Self", role: "PLAYER", connectionId: "self-conn" });
    expect(payload.playerId).toBe("self-conn");
    // Other clients get it as { data, connectionId } with the sender's connection id.
    expect(received).toHaveBeenCalledWith({ data: payload, connectionId: client.state.player.connectionId });
  });

  it("T-02 changing the modifier after the roll re-sends the same timestamp, rev + 1 (modifierChanged fixture)", async () => {
    vi.useFakeTimers();
    try {
      const client = await mountSync();
      await setStore(storeFinishedTraitWild);
      await act(flushObr);
      act(() => useDiceControlsStore.setState({ traitModifier: -2 }));
      await act(() => vi.advanceTimersByTimeAsync(500));
      const [, payload] = lastSend(client);
      const golden = fixture("traitWildDie.modifierChanged");
      expect(shape(legacyPart(payload))).toEqual(shape(golden));
      expect(payload.result).toEqual(golden.result);
      expect(payload).toMatchObject({ rollId: "golden-roll", rev: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  /** A finished store state with the given result (the result fields not set by settings are kept). */
  function finishedStoreWith(golden: RollFixture) {
    const result = golden.result as unknown as { mode: string; dieChains: { dieId: string; rolls: number[] }[] };
    const state = structuredClone(storeFinishedTraitWild) as StoreFixture & Record<string, unknown>;
    state.rollMode = result.mode;
    state.rollValues = Object.fromEntries(result.dieChains.map((c) => [c.dieId, c.rolls[0]]));
    state.currentRollResult = structuredClone(golden.result);
    return state;
  }

  it("OD-5 contract change: a finished DAMAGE roll is sent without success/raises, other fields as golden", async () => {
    act(() => useDiceControlsStore.setState({ traitModifier: 0, damageModifier: 2 }));
    const client = await mountSync();
    const golden = fixture("damage");
    await setStore(finishedStoreWith(golden));
    await act(flushObr);
    const [, payload] = lastSend(client);
    const outcomes = (golden.result.outcomes as unknown as Record<string, unknown>[]).map(
      ({ success: _s, raises: _r, ...rest }) => rest
    );
    expect(payload.result).toEqual({ ...golden.result, outcomes });
    expect(payload.result.outcomes[0]).not.toHaveProperty("success");
    expect(payload.result.outcomes[0]).not.toHaveProperty("raises");
  });

  it("A-03 contract change: a STANDARD roll is sent with modifier 0 even with a damage modifier set", async () => {
    act(() => useDiceControlsStore.setState({ traitModifier: 0, damageModifier: 3 }));
    const client = await mountSync();
    const golden = fixture("standard");
    await setStore(finishedStoreWith(golden));
    await act(flushObr);
    const [, payload] = lastSend(client);
    expect(payload.result).toEqual(golden.result);
  });

  it("A-01 contract addition: a double-1 trait roll is sent as a crit failure, even when the modifier reaches the TN", async () => {
    act(() => useDiceControlsStore.setState({ traitModifier: 3 }));
    const client = await mountSync();
    const golden = fixture("traitWildDie");
    const result = golden.result as unknown as { dieChains: { rolls: number[]; total: number }[] };
    for (const c of result.dieChains) {
      c.rolls = [1];
      c.total = 1;
    }
    await setStore(finishedStoreWith(golden));
    await act(flushObr);
    const [, payload] = lastSend(client);
    expect(payload.result.outcomes[0]).toMatchObject({
      total: 4,
      success: false,
      raises: 0,
      criticalFailure: true,
      criticalFailureReason: "Both trait and wild die rolled 1",
    });
  });

  it("an exploding chain keeps the golden key structure", async () => {
    act(() => useDiceControlsStore.setState({ traitModifier: 0 }));
    const client = await mountSync();
    await setStore(storeFinishedExploding);
    await act(flushObr);
    const [, payload] = lastSend(client);
    expect(shape(legacyPart(payload))).toEqual(shape(fixture("explodingChain")));
  });

  it.each([
    ["in progress", storeInProgress],
    ["explosion pending", storeExplosionPending],
    ["cleared", storeCleared],
  ])("does not send while the roll is %s", async (_label, state) => {
    const client = await mountSync();
    await setStore(state as StoreFixture);
    await act(flushObr);
    expect(client.broadcast.sendMessage).not.toHaveBeenCalled();
  });

  it("T-03 does not send or store a hidden roll (the roll's own flag)", async () => {
    const client = await mountSync();
    const hidden = structuredClone(storeFinishedTraitWild) as StoreFixture & { roll: { hidden: boolean } };
    hidden.roll.hidden = true;
    await setStore(hidden);
    await act(flushObr);
    expect(client.broadcast.sendMessage).not.toHaveBeenCalled();
    expect(client.player.setMetadata).not.toHaveBeenCalled();
  });

  it("OD-2 contract addition: writes only the history key to player metadata", async () => {
    const client = await mountSync();
    await setStore(storeFinishedTraitWild);
    await act(flushObr);
    expect(client.player.setMetadata).toHaveBeenCalled();
    for (const [patch] of client.player.setMetadata.mock.calls) {
      expect(Object.keys(patch as object)).toEqual([HISTORY_METADATA_KEY]);
    }
  });
});

describe("localStorage contract", () => {
  async function freshControlsStore(storage: Record<string, string>) {
    localStorage.clear();
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    vi.resetModules();
    const { useDiceControlsStore: store } = await import("../controls/store");
    const { diceSets } = await import("../sets/diceSets");
    return { store, diceSets };
  }

  it("the golden key list is the three swade-* keys", () => {
    expect([...ids.localStorageKeys].sort()).toEqual(Object.keys(localStorageControls).sort());
    expect(ids.sessionStorageKeys).toEqual([]);
  });

  it("reads localStorage.controls.json", async () => {
    const { store } = await freshControlsStore(localStorageControls);
    const s = store.getState();
    expect(s.diceSet.id).toBe("IRON_STANDARD");
    expect(s.wildDieEnabled).toBe(false);
    expect(s.targetNumber).toBe(6);
  });

  it("applies defaults for localStorage.empty.json", async () => {
    const { store, diceSets } = await freshControlsStore(localStorageEmpty);
    const s = store.getState();
    const firstValid = diceSets.find((d) => d.id !== "NEBULA_STANDARD" && d.id !== "all");
    expect(s.diceSet.id).toBe(firstValid?.id);
    expect(s.wildDieEnabled).toBe(true);
    expect(s.targetNumber).toBe(4);
  });

  it("writes exactly localStorage.controls.json (string values) after the golden user actions", async () => {
    const { store, diceSets } = await freshControlsStore(localStorageEmpty);
    const iron = diceSets.find((d) => d.id === "IRON_STANDARD");
    expect(iron).toBeDefined();
    store.getState().changeDiceSet(iron!);
    store.getState().toggleWildDie();
    store.getState().setTargetNumber(6);
    const written = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
    expect(written).toEqual(localStorageControls);
    expect(sessionStorage.length).toBe(0);
  });

  it("modifiers are not persisted", async () => {
    const { store } = await freshControlsStore(localStorageEmpty);
    store.getState().setTraitModifier(2);
    store.getState().setDamageModifier(3);
    expect(localStorage.length).toBe(0);
  });
});
