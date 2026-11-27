import { describe, expect, it } from "vitest";
import { getMaxValueForDie, isValidFaceValue, shouldDieExplode } from "./explosionHelpers";
import { getMaxValue } from "./explosionDisplay";
import { getParentDieId, createExplosionDie, createDieChains } from "../dice/storeHelpers";

describe("explosion helpers", () => {
  it("one max-value function: D4..D12, 0 (no throw) for unknown types", () => {
    expect(["D4", "D6", "D8", "D10", "D12"].map(getMaxValueForDie)).toEqual([4, 6, 8, 10, 12]);
    for (const t of ["D20", "D100", "__proto__", "constructor", ""]) {
      expect(getMaxValueForDie(t)).toBe(0);
      expect(getMaxValue(t)).toBe(0);
    }
  });

  it("shouldDieExplode(4, D4) true, (3, D4) false", () => {
    expect(shouldDieExplode(4, "D4")).toBe(true);
    expect(shouldDieExplode(3, "D4")).toBe(false);
  });

  it("valid face values are integers in 1..max", () => {
    expect(isValidFaceValue(1, "D6")).toBe(true);
    expect(isValidFaceValue(6, "D6")).toBe(true);
    for (const v of [0, 7, -1, 2.5, Number.NaN]) expect(isValidFaceValue(v, "D6")).toBe(false);
  });

  it("getParentDieId and createExplosionDie ids; the style is copied, no lowercase fallback", () => {
    expect(getParentDieId("5_explosion_2")).toBe("5");
    expect(getParentDieId("5")).toBe("5");
    const { die } = createExplosionDie("5", 2, { id: "5", type: "D8", style: "IRON" });
    expect(die).toEqual({ id: "5_explosion_3", type: "D8", style: "IRON" });
  });

  it("createDieChains copies the chains with a boolean isWildDie", () => {
    const chains = createDieChains({
      "3": { dieId: "3", dieType: "D6", rolls: [6, 2], total: 8, exploded: true, isWildDie: false },
    });
    expect(chains).toEqual([{ dieId: "3", dieType: "D6", rolls: [6, 2], total: 8, isWildDie: false }]);
  });
});
