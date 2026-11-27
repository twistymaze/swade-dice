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
    store.getState().incrementDieCount(a);
    check();
    store.getState().incrementDieCount(b);
    check();
    store.getState().setModeChoice("TRAIT");
    check();
    store.getState().decrementDieCount(b);
    check();
    store.getState().changeDieCount(a, 4);
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
    store.getState().decrementDieCount(a);
    store.getState().incrementDieCount("nope");
    expect(store.getState().diceCounts[a]).toBe(0);
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
