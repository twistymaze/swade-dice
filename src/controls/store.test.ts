import { afterEach, describe, expect, it, vi } from "vitest";
import { computeRollMode, getDiceToRoll, parseTargetNumber, parseWildDieEnabled } from "./store";
import { Die } from "../types/Die";

async function freshStore(storage: Record<string, string>) {
  localStorage.clear();
  for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  vi.resetModules();
  const mod = await import("./store");
  return mod.useDiceControlsStore;
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("T-20 controls store: localStorage parsing (A-11, C-08)", () => {
  it.each([
    ["abc", 4],
    ["", 4],
    ["NaN", 4],
    ["0", 1],
    ["-5", 1],
    ["150", 99],
    ["7.9", 7],
    [" 8", 8],
    ["6", 6],
  ])("swade-targetNumber = %j -> TN %i", async (stored, expected) => {
    const store = await freshStore({ "swade-targetNumber": stored });
    expect(store.getState().targetNumber).toBe(expected);
  });

  it("parseTargetNumber: numbers are truncated and clamped, NaN/Infinity -> 4", () => {
    expect(parseTargetNumber(150)).toBe(99);
    expect(parseTargetNumber(0)).toBe(1);
    expect(parseTargetNumber(5.7)).toBe(5);
    expect(parseTargetNumber(Number.NaN)).toBe(4);
    expect(parseTargetNumber(Number.POSITIVE_INFINITY)).toBe(4);
    expect(parseTargetNumber(undefined)).toBe(4);
  });

  it("swade-wildDieEnabled: only \"true\" is on; missing -> on", () => {
    expect(parseWildDieEnabled(null)).toBe(true);
    expect(parseWildDieEnabled("true")).toBe(true);
    for (const v of ["TRUE", "1", "", "false"]) expect(parseWildDieEnabled(v)).toBe(false);
  });

  it("swade-diceSetId NEBULA_STANDARD, all or bogus -> the default set", async () => {
    const def = (await freshStore({})).getState().diceSet.id;
    for (const id of ["NEBULA_STANDARD", "all", "bogus"]) {
      expect((await freshStore({ "swade-diceSetId": id })).getState().diceSet.id).toBe(def);
    }
  });

  it("localStorage.getItem throws -> defaults, no throw", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = await freshStore({});
    expect(store.getState()).toMatchObject({ targetNumber: 4, wildDieEnabled: true });
  });

  it("setTargetNumber writes the clamped value: 150 -> \"99\", 0 -> \"1\", NaN -> \"4\" (not \"NaN\")", async () => {
    const store = await freshStore({});
    store.getState().setTargetNumber(150);
    expect(localStorage.getItem("swade-targetNumber")).toBe("99");
    store.getState().setTargetNumber(0);
    expect(localStorage.getItem("swade-targetNumber")).toBe("1");
    store.getState().setTargetNumber(Number.NaN);
    expect(store.getState().targetNumber).toBe(4);
    expect(localStorage.getItem("swade-targetNumber")).toBe("4");
  });

  it("setItem throws -> state still changes", async () => {
    const store = await freshStore({});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    store.getState().setTargetNumber(9);
    expect(store.getState().targetNumber).toBe(9);
  });
});

describe("T-21 roll mode is derived from mode choice and counts (D-08)", () => {
  it("computeRollMode: AUTO 0 -> DAMAGE, 1 -> TRAIT, 2 -> DAMAGE; explicit choices win", () => {
    expect(computeRollMode("AUTO", {})).toBe("DAMAGE");
    expect(computeRollMode("AUTO", { a: 1 })).toBe("TRAIT");
    expect(computeRollMode("AUTO", { a: 1, b: 1 })).toBe("DAMAGE");
    expect(computeRollMode("TRAIT", { a: 3 })).toBe("TRAIT");
    expect(computeRollMode("DAMAGE", { a: 1 })).toBe("DAMAGE");
    expect(computeRollMode("STANDARD", { a: 1 })).toBe("STANDARD");
  });

  it("every action keeps rollMode equal to computeRollMode(modeChoice, diceCounts)", async () => {
    const store = await freshStore({});
    const check = () => {
      const s = store.getState();
      expect(s.rollMode).toBe(computeRollMode(s.modeChoice, s.diceCounts));
    };
    const [a, b] = Object.keys(store.getState().diceCounts);
    store.getState().incrementDieCount(a!);
    check();
    store.getState().incrementDieCount(b!);
    check();
    store.getState().setModeChoice("TRAIT");
    check();
    store.getState().decrementDieCount(b!);
    check();
    store.getState().changeDieCount(a!, 4);
    check();
    store.getState().resetDiceCounts(true);
    expect(store.getState().modeChoice).toBe("TRAIT");
    check();
    store.getState().resetDiceCounts();
    expect(store.getState().modeChoice).toBe("AUTO");
    check();
  });

  it("decrementDieCount at 0 stays 0; unknown ids are ignored", async () => {
    const store = await freshStore({});
    const [a] = Object.keys(store.getState().diceCounts);
    store.getState().decrementDieCount(a!);
    store.getState().incrementDieCount("nope");
    expect(store.getState().diceCounts[a!]).toBe(0);
    expect(store.getState().diceCounts).not.toHaveProperty("nope");
  });
});

describe("T-22 building the dice for a roll (D-12)", () => {
  const byId: Record<string, Die> = {
    a: { id: "a", type: "D8", style: "GALAXY" },
    b: { id: "b", type: "D6", style: "GALAXY" },
  };

  it("TRAIT + Wild Die on -> one die per count plus a flagged NEBULA D6", () => {
    const dice = getDiceToRoll({ a: 2 }, byId, true, undefined, true) as Die[];
    expect(dice).toHaveLength(3);
    expect(dice.filter((d) => d.isWildDie)).toEqual([expect.objectContaining({ type: "D6", style: "NEBULA" })]);
    expect(new Set(dice.map((d) => d.id)).size).toBe(3);
  });

  it("no wild die for empty counts, TRAIT + wild off, or DAMAGE + wild on; missing ids skipped", () => {
    expect(getDiceToRoll({}, byId, true, undefined, true)).toEqual([]);
    expect(getDiceToRoll({ a: 0 }, byId, true, undefined, true)).toEqual([]);
    expect((getDiceToRoll({ a: 1 }, byId, false, undefined, true) as Die[]).some((d) => d.isWildDie)).toBe(false);
    expect((getDiceToRoll({ a: 1, b: 1 }, byId, true, undefined, false) as Die[]).some((d) => d.isWildDie)).toBe(false);
    expect(getDiceToRoll({ zz: 2 }, byId, true, undefined, true)).toEqual([]);
  });
});

describe("T-57 / B-08 limits the receivers accept", () => {
  it("the dice count per roll stops at MAX_DICE_PER_ROLL; changeDieCount clamps", async () => {
    const store = await freshStore({});
    const { MAX_DICE_PER_ROLL } = await import("./store");
    const ids = Object.keys(store.getState().diceCounts);
    for (const id of ids) store.getState().changeDieCount(id, 0);
    for (let i = 0; i < MAX_DICE_PER_ROLL + 5; i++) store.getState().incrementDieCount(ids[0]!);
    expect(store.getState().diceCounts[ids[0]!]).toBe(MAX_DICE_PER_ROLL);
    store.getState().changeDieCount(ids[0]!, 10);
    store.getState().changeDieCount(ids[1]!, 999);
    expect(store.getState().diceCounts[ids[1]!]).toBe(MAX_DICE_PER_ROLL - 10);
  });

  it("modifiers are clamped to -99..99 integers", async () => {
    const store = await freshStore({});
    store.getState().setTraitModifier(150);
    store.getState().setDamageModifier(-150);
    expect(store.getState().traitModifier).toBe(99);
    expect(store.getState().damageModifier).toBe(-99);
    store.getState().setTraitModifier(NaN);
    expect(store.getState().traitModifier).toBe(0);
  });
});

describe("T-21 controls store actions", () => {
  it("changeDiceSet GALAXY -> IRON keeps counts by index and type (2 d8 stay 2 d8) and saves the set id", async () => {
    const store = await freshStore({ "swade-diceSetId": "GALAXY_STANDARD" });
    const { diceSets } = await import("../sets/diceSets");
    store.getState().changeDieCount("GALAXY_STANDARD_D8", 2);
    store.getState().changeDieCount("GALAXY_STANDARD_D12", 1);
    store.getState().changeDiceSet(diceSets.find((s) => s.id === "IRON_STANDARD")!);
    const s = store.getState();
    expect(s.diceSet.id).toBe("IRON_STANDARD");
    expect(s.diceCounts).toEqual({
      IRON_STANDARD_D4: 0,
      IRON_STANDARD_D6: 0,
      IRON_STANDARD_D8: 2,
      IRON_STANDARD_D10: 0,
      IRON_STANDARD_D12: 1,
    });
    expect(Object.keys(s.diceById)).toEqual(Object.keys(s.diceCounts));
    expect(s.defaultDiceCounts).toEqual(Object.fromEntries(Object.keys(s.diceCounts).map((id) => [id, 0])));
    expect(s.rollMode).toBe("DAMAGE");
    expect(localStorage.getItem("swade-diceSetId")).toBe("IRON_STANDARD");
  });

  it("changeDiceSet to a set with another layout resets the counts whose type does not match", async () => {
    const store = await freshStore({ "swade-diceSetId": "GALAXY_STANDARD" });
    store.getState().changeDieCount("GALAXY_STANDARD_D4", 1);
    store.getState().changeDieCount("GALAXY_STANDARD_D6", 3);
    store.getState().changeDiceSet({
      id: "CUSTOM",
      name: "custom",
      previewImage: "",
      dice: [
        { id: "c4", type: "D4", style: "GLASS" },
        { id: "c8", type: "D8", style: "GLASS" },
      ],
    });
    expect(store.getState().diceCounts).toEqual({ c4: 1, c8: 0 });
    expect(store.getState().rollMode).toBe("TRAIT");
  });

  it("setTraitModifier(-4) and setDamageModifier(+99) are stored as is, not in localStorage", async () => {
    const store = await freshStore({});
    store.getState().setTraitModifier(-4);
    store.getState().setDamageModifier(99);
    expect(store.getState().traitModifier).toBe(-4);
    expect(store.getState().damageModifier).toBe(99);
    expect(Object.keys(localStorage).filter((k) => /modifier/i.test(k))).toEqual([]);
  });

  it("toggleDiceHidden, toggleFairnessTester, setResultsDetailsHovered, setDiceRollPressTime change only their field", async () => {
    const store = await freshStore({});
    const actions = [
      ["diceHidden", () => store.getState().toggleDiceHidden(), true],
      ["fairnessTesterOpen", () => store.getState().toggleFairnessTester(), true],
      ["resultsDetailsHovered", () => store.getState().setResultsDetailsHovered(true), true],
      ["diceRollPressTime", () => store.getState().setDiceRollPressTime(1234), 1234],
    ] as const;
    for (const [field, act, value] of actions) {
      const before = store.getState();
      act();
      const after = store.getState();
      for (const key of Object.keys(before) as (keyof typeof before)[]) {
        if (key === field) expect(after[key]).toBe(value);
        else expect(after[key]).toBe(before[key]);
      }
    }
    store.getState().toggleDiceHidden();
    store.getState().toggleFairnessTester();
    expect(store.getState().diceHidden).toBe(false);
    expect(store.getState().fairnessTesterOpen).toBe(false);
  });
});
