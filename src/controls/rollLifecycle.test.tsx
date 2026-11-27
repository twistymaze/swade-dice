/**
 * The roll lifecycle in the UI: the Roll button, the dice picker,
 * the recent-roll replay and the fairness tester while dice still roll.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushObr, obr, resetObrMock } from "../test/obrMock";

vi.mock("@owlbear-rodeo/sdk", () => import("../test/obrMock").then((m) => m.createSdkModule()));

import { DiceRollControls } from "./DiceRollControls";
import { DicePicker } from "./DicePicker";
import { DiceHistory } from "./DiceHistory";
import { FairnessTester } from "../fairness/FairnessTester";
import { DiceRollSync } from "../plugin/DiceRollSync";
import { useDiceControlsStore } from "./store";
import { useDiceHistoryStore } from "./history";
import { useDiceRollStore } from "../dice/store";
import { Die } from "../types/Die";
import { DiceTransform } from "../types/DiceTransform";
import { getDieFromDice } from "../helpers/getDieFromDice";

const T: DiceTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const controls = () => useDiceControlsStore.getState();
const dice = () => useDiceRollStore.getState();
const rolledDice = (): Die[] => (dice().roll ? getDieFromDice(dice().roll!) : []);
const sends = () => obr().broadcast.sendMessage.mock.calls.map((c) => c[1] as { rollId: string; rev: number });

let now = 0;

beforeEach(() => {
  resetObrMock({ id: "u1", connectionId: "c1", name: "Ava", color: "#aa0000", role: "PLAYER" });
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(console, "error").mockImplementation(() => {});
  act(() => {
    dice().clearRoll();
    controls().resetDiceCounts();
    controls().setTargetNumber(4);
    controls().setTraitModifier(0);
    controls().setDamageModifier(0);
    useDiceControlsStore.setState({ wildDieEnabled: true, diceHidden: false, fairnessTesterOpen: false });
    useDiceHistoryStore.setState({ recentRolls: [] });
  });
});
afterEach(() => vi.restoreAllMocks());

const ids = () => Object.keys(controls().diceCounts);

/** Finish every pending die with face 2 (no explosions). */
function finishAll() {
  act(() => {
    for (const id of Object.keys(dice().rollValues)) {
      if (dice().rollValues[id] === null) dice().checkAndProcessExplosion(id, 2, T);
    }
  });
}

function pressRoll(seconds: number) {
  const button = screen.getByRole("button", { name: /^Roll/ });
  fireEvent.pointerDown(button);
  now += seconds * 1000;
  fireEvent.pointerUp(button);
}

describe("the Roll button builds the roll (component part)", () => {
  it.each([
    [0, 1],
    [0.2, 1],
    [2, 4],
    [10, 10],
    [60, 10],
  ])("press for %f s -> speedMultiplier %f (clamped 1..10)", (seconds, multiplier) => {
    act(() => controls().changeDieCount(ids()[2]!, 1));
    render(<DiceRollControls />);
    pressRoll(seconds);
    expect(dice().rollSpeedMultiplier).toBe(multiplier);
  });

  it("the roll gets the mode and settings, pushRecentRoll gets the same settings, counts reset with the mode kept", () => {
    act(() => {
      controls().changeDieCount(ids()[2]!, 1);
      controls().setModeChoice("TRAIT");
      controls().setTargetNumber(6);
      controls().setTraitModifier(2);
      controls().setDamageModifier(-1);
    });
    render(<DiceRollControls />);
    pressRoll(1);
    expect(dice().rollMode).toBe("TRAIT");
    expect(dice().rollSettings).toEqual({ targetNumber: 6, traitModifier: 2, damageModifier: -1, wildDieEnabled: true });
    expect(rolledDice().map((d) => [d.type, d.isWildDie === true])).toEqual([
      ["D8", false],
      ["D6", true],
    ]);
    const recent = useDiceHistoryStore.getState().recentRolls;
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      rollMode: "TRAIT",
      targetNumber: 6,
      traitModifier: 2,
      damageModifier: -1,
      wildDieEnabled: true,
    });
    expect(recent[0]!.counts[ids()[2]!]).toBe(1);
    expect(Object.values(controls().diceCounts).every((n) => n === 0)).toBe(true);
    expect(controls().modeChoice).toBe("TRAIT");
  });

  it("pointer up without a press time -> no roll, nothing pushed", () => {
    act(() => controls().changeDieCount(ids()[2]!, 1));
    render(<DiceRollControls />);
    fireEvent.pointerUp(screen.getByRole("button", { name: /^Roll/ }));
    expect(dice().roll).toBeNull();
    expect(useDiceHistoryStore.getState().recentRolls).toEqual([]);
    expect(controls().diceCounts[ids()[2]!]).toBe(1);
  });

  it("hidden on -> the roll is hidden", () => {
    act(() => {
      controls().changeDieCount(ids()[1]!, 1);
      useDiceControlsStore.setState({ diceHidden: true });
    });
    render(<DiceRollControls />);
    pressRoll(1);
    expect(dice().roll?.hidden).toBe(true);
  });
});

describe("roll lifecycle in the UI: no partial or stale roll is ever sent", () => {
  async function mountSync() {
    render(<DiceRollSync />);
    await act(flushObr);
  }

  it("picking a die while dice roll clears the roll, mode back to AUTO, late finishes ignored, nothing sent", async () => {
    await mountSync();
    const d8 = { id: "old-1", type: "D8" as const, style: "GALAXY" as const };
    act(() => {
      controls().setModeChoice("TRAIT");
      dice().startRoll({ dice: [d8] }, { mode: "TRAIT" });
    });
    render(<DicePicker />);
    fireEvent.click(screen.getByAltText("GALAXY D6 preview"));
    expect(dice().roll).toBeNull();
    expect(controls().modeChoice).toBe("AUTO");
    expect(controls().diceCounts[ids()[1]!]).toBe(1);
    act(() => {
      dice().checkAndProcessExplosion("old-1", 3, T);
    });
    await act(flushObr);
    expect(dice().currentRollResult).toBeNull();
    expect(sends()).toEqual([]);
  });

  it("a recent-roll replay while dice roll: the old roll is never sent, late old dice ignored, the new roll sends once", async () => {
    await mountSync();
    act(() => {
      useDiceHistoryStore.getState().pushRecentRoll({
        counts: { [ids()[2]!]: 2 },
        diceById: controls().diceById,
        rollMode: "DAMAGE",
        damageModifier: 1,
      });
      dice().startRoll({ dice: [{ id: "old-1", type: "D8", style: "GALAXY" }] }, { mode: "TRAIT" });
    });
    render(<DiceHistory />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(screen.getAllByAltText("GALAXY D8 preview")[0]!);
    expect(dice().rollMode).toBe("DAMAGE");
    expect(rolledDice()).toHaveLength(2);
    act(() => {
      dice().checkAndProcessExplosion("old-1", 3, T);
    });
    expect(dice().rollValues).not.toHaveProperty("old-1");
    finishAll();
    await act(flushObr);
    expect(sends()).toHaveLength(1);
    expect(sends()[0]!.rollId).toBe(dice().currentRollResult!.rollId);
  });

  it("fairness tester start while a normal roll runs -> the old roll is cleared and not sent", async () => {
    await mountSync();
    act(() => {
      dice().startRoll({ dice: [{ id: "old-1", type: "D8", style: "GALAXY" }] }, { mode: "TRAIT" });
      controls().changeDieCount(ids()[1]!, 1);
      useDiceControlsStore.setState({ fairnessTesterOpen: true });
    });
    render(<FairnessTester />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(dice().roll?.hidden).toBe(true);
    expect(dice().rollMode).toBe("STANDARD");
    expect(dice().rollValues).not.toHaveProperty("old-1");
    act(() => {
      dice().checkAndProcessExplosion("old-1", 3, T);
    });
    await act(flushObr);
    expect(sends()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    act(() => dice().clearRoll());
  });

  it("a new hidden roll after a shared result: the hidden roll is never sent", async () => {
    await mountSync();
    act(() => controls().changeDieCount(ids()[2]!, 1));
    render(<DiceRollControls />);
    pressRoll(1);
    finishAll();
    await act(flushObr);
    expect(sends()).toHaveLength(1);
    act(() => {
      useDiceControlsStore.setState({ diceHidden: true });
      controls().changeDieCount(ids()[2]!, 1);
    });
    pressRoll(1);
    expect(dice().roll?.hidden).toBe(true);
    finishAll();
    await act(flushObr);
    expect(dice().currentRollResult?.hidden).toBe(true);
    expect(sends()).toHaveLength(1);
  });

  it("10 rolls back to back with Date.now frozen -> 10 sends with 10 different roll ids", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1764250001800);
    await mountSync();
    render(<DiceRollControls />);
    for (let i = 0; i < 10; i++) {
      act(() => controls().changeDieCount(ids()[3]!, 1));
      pressRoll(1);
      finishAll();
      await act(flushObr);
    }
    expect(sends()).toHaveLength(10);
    expect(new Set(sends().map((s) => s.rollId)).size).toBe(10);
  });
});

describe("an edit with no finished roll sends nothing", () => {
  async function mountSync() {
    render(<DiceRollSync />);
    await act(flushObr);
  }

  it("TN, modifier and Wild Die edits while dice still roll -> 0 sends; the finished roll then sends once with the live values", async () => {
    await mountSync();
    act(() => dice().startRoll({ dice: [{ id: "r-1", type: "D8", style: "GALAXY" }] }, { mode: "TRAIT", settings: { ...controls() } }));
    act(() => {
      controls().setTargetNumber(8);
      controls().setTraitModifier(2);
      controls().toggleWildDie();
    });
    await act(flushObr);
    expect(sends()).toEqual([]);
    finishAll();
    await act(flushObr);
    expect(sends()).toHaveLength(1);
    const payload = obr().broadcast.sendMessage.mock.calls[0]![1] as { result: { targetNumber: number; modifier: number } };
    expect(payload.result).toMatchObject({ targetNumber: 8, modifier: 2 });
  });

  it("an edit after picking new dice (the picker cleared the roll) -> 0 new sends", async () => {
    await mountSync();
    act(() => controls().changeDieCount(ids()[2]!, 1));
    render(<DiceRollControls />);
    pressRoll(1);
    finishAll();
    await act(flushObr);
    expect(sends()).toHaveLength(1);
    render(<DicePicker />);
    fireEvent.click(screen.getByAltText("GALAXY D6 preview"));
    expect(dice().roll).toBeNull();
    act(() => controls().setTargetNumber(10));
    await act(flushObr);
    expect(sends()).toHaveLength(1);
  });
});
