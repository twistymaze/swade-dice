/** T-32 recent-rolls menu (max 6) and replay. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DiceHistory } from "./DiceHistory";
import { RecentRoll, useDiceHistoryStore } from "./history";
import { useDiceControlsStore } from "./store";
import { useDiceRollStore } from "../dice/store";
import { getDieFromDice } from "../helpers/getDieFromDice";
import recentRollsFixture from "../test/fixtures/golden/diceHistory.recentRolls.json";

const golden = () => structuredClone(recentRollsFixture) as RecentRoll[];
const history = () => useDiceHistoryStore.getState();
const controls = () => useDiceControlsStore.getState();
const dice = () => useDiceRollStore.getState();
const rolled = () => getDieFromDice(dice().roll!);

beforeEach(() => {
  act(() => {
    useDiceHistoryStore.setState({ recentRolls: [] });
    dice().clearRoll();
    controls().resetDiceCounts();
    controls().setTargetNumber(4);
    controls().setTraitModifier(0);
    controls().setDamageModifier(0);
    useDiceControlsStore.setState({ wildDieEnabled: true, diceHidden: false });
  });
});

function openMenu() {
  render(<DiceHistory />);
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  return screen.getByRole("menu");
}
const chips = (menu: HTMLElement) => Array.from(menu.querySelectorAll(".MuiChip-root")) as HTMLElement[];

describe("T-32 recent-rolls store (max 6)", () => {
  it("the 7th push drops the oldest", () => {
    const rolls = golden();
    for (let i = 0; i < 7; i++) history().pushRecentRoll({ ...rolls[i % rolls.length]!, targetNumber: i + 1 });
    expect(history().recentRolls.map((r) => r.targetNumber)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("removeRecentRoll(i) removes that entry only", () => {
    for (const r of golden()) history().pushRecentRoll(r);
    history().removeRecentRoll(2);
    expect(history().recentRolls.map((r) => r.rollMode)).toEqual(["TRAIT", "TRAIT", "TRAIT", "DAMAGE", "STANDARD"]);
  });
});

describe("T-32 recent-rolls menu", () => {
  it("empty -> 'No History'", () => {
    const menu = openMenu();
    expect(within(menu).getByText("No History")).toBeInTheDocument();
  });

  it("golden recent rolls render one chip each with 🎯 for TRAIT, ⚔️ otherwise, dice previews and the Wild Die", () => {
    act(() => useDiceHistoryStore.setState({ recentRolls: golden() }));
    const list = chips(openMenu());
    expect(list).toHaveLength(6);
    expect(list.map((c) => (c.textContent!.includes("🎯") ? "T" : c.textContent!.includes("⚔️") ? "D" : "?"))).toEqual([
      "T",
      "T",
      "D",
      "T",
      "D",
      "D",
    ]);
    const alts = (c: HTMLElement) => Array.from(c.querySelectorAll("img")).map((i) => i.alt);
    expect(alts(list[0]!)).toEqual(["GALAXY D6 preview"]); // wild off
    expect(alts(list[1]!)).toEqual(["GALAXY D8 preview", "GALAXY D8 preview", "NEBULA D6 preview"]);
    expect(alts(list[2]!)).toEqual(["GALAXY D6 preview", "GALAXY D8 preview"]); // DAMAGE: no wild
    expect(alts(list[5]!)).toEqual(["GALAXY D4 preview", "GALAXY D12 preview"]);
  });

  it("more than 6 dice of one type show 'N×' and one preview", () => {
    const [r] = golden();
    r!.counts = { GALAXY_STANDARD_D6: 8 };
    r!.rollMode = "DAMAGE";
    act(() => useDiceHistoryStore.setState({ recentRolls: [r!] }));
    const [chip] = chips(openMenu());
    expect(chip).toHaveTextContent("8×");
    expect(chip!.querySelectorAll("img")).toHaveLength(1);
  });

  it("the delete icon removes the entry", () => {
    act(() => useDiceHistoryStore.setState({ recentRolls: golden() }));
    const menu = openMenu();
    fireEvent.click(chips(menu)[0]!.querySelector(".MuiChip-deleteIcon")!);
    expect(history().recentRolls).toHaveLength(5);
    expect(history().recentRolls[0]!.counts.GALAXY_STANDARD_D8).toBe(2);
  });
});

describe("T-32 replay", () => {
  function replay(roll: RecentRoll) {
    act(() => useDiceHistoryStore.setState({ recentRolls: [roll] }));
    fireEvent.click(chips(openMenu())[0]!);
  }

  it("TRAIT: restores trait modifier, TN and Wild Die (toggled because different); starts with the roll's mode and settings", () => {
    const [r] = golden(); // TRAIT d6, wild off
    replay({ ...r!, traitModifier: 2, damageModifier: 3, targetNumber: 8 });
    expect(controls()).toMatchObject({ traitModifier: 2, damageModifier: 0, targetNumber: 8, wildDieEnabled: false });
    expect(dice().rollMode).toBe("TRAIT");
    expect(dice().rollSettings).toEqual({ targetNumber: 8, traitModifier: 2, damageModifier: 0, wildDieEnabled: false });
    expect(rolled().map((d) => d.type)).toEqual(["D6"]);
    expect(rolled().some((d) => d.isWildDie)).toBe(false);
  });

  it("DAMAGE: restores the damage modifier only (TN stays), no Wild Die", () => {
    act(() => controls().setTargetNumber(6));
    replay(golden()[2]!); // DAMAGE d6 + d8, +2
    expect(controls()).toMatchObject({ damageModifier: 2, targetNumber: 6, traitModifier: 0 });
    expect(dice().rollMode).toBe("DAMAGE");
    expect(rolled().map((d) => d.type).sort()).toEqual(["D6", "D8"]);
    expect(rolled().some((d) => d.isWildDie)).toBe(false);
  });

  it("Wild Die the same as now -> not toggled", () => {
    replay(golden()[3]!); // TRAIT, wild on; current on
    expect(controls().wildDieEnabled).toBe(true);
    expect(rolled().filter((d) => d.isWildDie)).toHaveLength(1);
  });

  it("wildDieEnabled undefined -> uses the current setting", () => {
    const r = golden()[3];
    delete r!.wildDieEnabled;
    act(() => useDiceControlsStore.setState({ wildDieEnabled: false }));
    replay(r!);
    expect(controls().wildDieEnabled).toBe(false);
    expect(rolled().some((d) => d.isWildDie)).toBe(false);
  });

  it("hidden is taken from the current setting; counts and mode choice reset after the replay", () => {
    act(() => {
      useDiceControlsStore.setState({ diceHidden: true });
      controls().changeDieCount(Object.keys(controls().diceCounts)[0]!, 2);
      controls().setModeChoice("DAMAGE");
    });
    replay(golden()[0]!);
    expect(dice().roll?.hidden).toBe(true);
    expect(Object.values(controls().diceCounts).every((n) => n === 0)).toBe(true);
    expect(controls().modeChoice).toBe("AUTO");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
