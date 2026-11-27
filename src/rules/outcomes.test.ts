import { describe, expect, it } from "vitest";
import {
  computeOutcomes,
  computeRollResult,
  countRaises,
  getCriticalFailureStatusForChains,
  getOutcomeCriticalStatus,
  isMoreThanHalf,
  RollSettings,
} from "./outcomes";
import { DieChain, SavageRollMode, SavageRollResult } from "../types/SavageWorldsTypes";
import { DiceType } from "../types/DiceType";

import traitWildDie from "../test/fixtures/golden/broadcast.rollResult.traitWildDie.json";
import modifierChanged from "../test/fixtures/golden/broadcast.rollResult.traitWildDie.modifierChanged.json";
import multiTraitWildDie from "../test/fixtures/golden/broadcast.rollResult.multiTraitWildDie.json";
import rolledOne from "../test/fixtures/golden/broadcast.rollResult.traitNoWild.rolledOne.json";
import damage from "../test/fixtures/golden/broadcast.rollResult.damage.json";
import damageExploding from "../test/fixtures/golden/broadcast.rollResult.damageExploding.json";
import standard from "../test/fixtures/golden/broadcast.rollResult.standard.json";
import explodingChain from "../test/fixtures/golden/broadcast.rollResult.explodingChain.json";

let nextId = 1;
function chain(dieType: DiceType, rolls: number[], isWildDie = false): DieChain {
  return { dieId: String(nextId++), dieType, rolls, total: rolls.reduce((a, b) => a + b, 0), isWildDie };
}
const wild = (...rolls: number[]) => chain("D6", rolls, true);
const settings = (s: Partial<RollSettings> = {}): RollSettings => ({
  targetNumber: 4,
  traitModifier: 0,
  damageModifier: 0,
  wildDieEnabled: true,
  ...s,
});
const trait = (chains: DieChain[], s: Partial<RollSettings> = {}) => computeOutcomes("TRAIT", chains, settings(s));

describe("SWADE helpers", () => {
  it("T-06 raises: TN exactly -> 0, TN+3 -> 0, TN+4 -> 1, TN+8 -> 2, failure -> 0", () => {
    expect(countRaises(4, 4)).toBe(0);
    expect(countRaises(7, 4)).toBe(0);
    expect(countRaises(8, 4)).toBe(1);
    expect(countRaises(12, 4)).toBe(2);
    expect(countRaises(3, 4)).toBe(0);
    expect(countRaises(-6, 4)).toBe(0);
  });

  it("OD-4 threshold is MORE than half, not half or more", () => {
    expect(isMoreThanHalf(2, 4)).toBe(false);
    expect(isMoreThanHalf(3, 4)).toBe(true);
    expect(isMoreThanHalf(2, 3)).toBe(true);
    expect(isMoreThanHalf(1, 2)).toBe(false);
  });
});

describe("T-07 single-die trait test with Wild Die", () => {
  it("wild higher (d8 3, wild 5, +1, TN 4) -> wild used, total 6, success, 0 raises (golden)", () => {
    const [o] = trait([chain("D8", [3]), wild(5)], { traitModifier: 1 });
    expect(o).toMatchObject({ total: 6, replacedByWild: true, success: true, raises: 0, modifier: 1 });
    expect(o.chains[0].isWildDie).toBe(true);
  });

  it("wild lower (d8 7, wild 2) -> trait used", () => {
    const [o] = trait([chain("D8", [7]), wild(2)]);
    expect(o).toMatchObject({ total: 7, replacedByWild: false, success: true, raises: 0 });
  });

  it("tie (4 vs 4) -> trait kept, replacedByWild false", () => {
    const [o] = trait([chain("D8", [4]), wild(4)]);
    expect(o.replacedByWild).toBe(false);
    expect(o.chains[0].isWildDie).toBe(false);
  });

  it("wild exploded chain (6,6,2 = 14) vs trait 8 -> wild, 2 raises at TN 4", () => {
    const [o] = trait([chain("D8", [8, 3]), wild(6, 6, 2)]);
    expect(o).toMatchObject({ total: 14, replacedByWild: true, raises: 2 });
  });

  it("no wild chain -> trait only", () => {
    expect(trait([chain("D10", [9])])).toEqual([
      expect.objectContaining({ total: 9, replacedByWild: false, success: true, raises: 1 }),
    ]);
  });

  it("T-06 wild higher only after modifier: trait 3, wild 4, modifier -10 -> wild wins, total -6, failure, 0 raises", () => {
    const [o] = trait([chain("D8", [3]), wild(4)], { traitModifier: -10 });
    expect(o).toMatchObject({ total: -6, replacedByWild: true, success: false, raises: 0 });
  });

  it("T-06 Wild Die on, but the roll was made without a wild chain -> no wild outcome appears", () => {
    const outcomes = trait([chain("D8", [2])], { wildDieEnabled: true });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].replacedByWild).toBe(false);
  });

  it("T-06 Wild Die turned off after the roll -> the wild chain is ignored", () => {
    const [o] = trait([chain("D8", [2]), wild(6)], { wildDieEnabled: false });
    expect(o).toMatchObject({ total: 2, replacedByWild: false, success: false });
  });

  it("regular chains empty in TRAIT (only a wild chain) -> no outcomes", () => {
    expect(trait([wild(5)])).toEqual([]);
  });
});

describe("T-08 multi-die trait test, Wild Die replaces the worst die", () => {
  it("2d8 [2, 6] + wild 4 -> [wild 4, 6] (golden)", () => {
    const out = trait([chain("D8", [2]), chain("D8", [6]), wild(4)]);
    expect(out.map((o) => [o.total, o.replacedByWild])).toEqual([
      [4, true],
      [6, false],
    ]);
  });

  it("wild equal to worst -> no replacement", () => {
    const out = trait([chain("D8", [3]), chain("D8", [6]), wild(3)]);
    expect(out.some((o) => o.replacedByWild)).toBe(false);
  });

  it("two dice tie for worst ([3,3], wild 5) -> only the first is replaced", () => {
    const out = trait([chain("D8", [3]), chain("D8", [3]), wild(5)]);
    expect(out.map((o) => o.replacedByWild)).toEqual([true, false]);
  });

  it("wild lower than all -> no replacement", () => {
    const out = trait([chain("D8", [5]), chain("D8", [6]), wild(2)]);
    expect(out.some((o) => o.replacedByWild)).toBe(false);
  });

  it("3 dice + wild, mixed explosions ([8,3]=11, 1, 5), wild 6 -> replaces the 1", () => {
    const out = trait([chain("D8", [8, 3]), chain("D8", [1]), chain("D8", [5]), wild(6)]);
    expect(out.map((o) => o.total)).toEqual([11, 6, 5]);
    expect(out[1].replacedByWild).toBe(true);
  });

  it("A-10 one Wild Die per roll: it replaces at most one trait die and adds no extra outcome", () => {
    const out = trait([chain("D8", [1]), chain("D8", [1]), chain("D8", [2]), wild(6)]);
    expect(out).toHaveLength(3);
    expect(out.filter((o) => o.replacedByWild)).toHaveLength(1);
  });
});

describe("T-10 / T-54 Critical Failure (OD-4 book rule)", () => {
  const status = (chains: DieChain[], wildDieEnabled: boolean | undefined = true, mode: SavageRollMode = "TRAIT") =>
    getCriticalFailureStatusForChains(mode, chains, wildDieEnabled);

  it("T-10 single trait 1 + wild 1, wild enabled -> critical", () => {
    expect(status([chain("D8", [1]), wild(1)]).isCritical).toBe(true);
  });

  it("T-10 trait 1 + wild 2 -> not critical, not possible", () => {
    expect(status([chain("D8", [1]), wild(2)])).toEqual({ isCritical: false, isPossible: false });
  });

  it("T-10 trait 1, no wild chain -> possible", () => {
    expect(status([chain("D8", [1])])).toMatchObject({ isCritical: false, isPossible: true });
  });

  it("T-10 trait 1, wild chain present but Wild Die off -> possible", () => {
    expect(status([chain("D8", [1]), wild(1)], false)).toMatchObject({ isCritical: false, isPossible: true });
  });

  it("T-10 trait 1 with wildDieEnabled undefined (old payload) -> possible", () => {
    const chains = [chain("D8", [1]), wild(1)];
    expect(getCriticalFailureStatusForChains("TRAIT", chains, undefined)).toMatchObject({ isPossible: true });
  });

  it("T-10 / T-54 DAMAGE and STANDARD with 1s -> never crit", () => {
    expect(status([chain("D6", [1]), chain("D6", [1])], true, "DAMAGE")).toEqual({ isCritical: false, isPossible: false });
    expect(status([chain("D6", [1])], true, "STANDARD")).toEqual({ isCritical: false, isPossible: false });
    for (const mode of ["DAMAGE", "STANDARD"] as const) {
      for (const o of computeOutcomes(mode, [chain("D6", [1]), chain("D6", [1])], settings())) {
        expect(o.criticalFailure).toBeUndefined();
        expect(o.possibleCriticalFailure).toBeUndefined();
      }
    }
  });

  it("T-54 trait 1 + wild 1, +3, TN 4 -> success false, raises 0, criticalFailure true", () => {
    const [o] = trait([chain("D6", [1]), wild(1)], { traitModifier: 3 });
    expect(o).toMatchObject({ total: 4, success: false, raises: 0, criticalFailure: true });
  });

  it("T-54 both 1, TN 1, no modifier -> crit (a crit fail is a failure even at the TN)", () => {
    const [o] = trait([chain("D6", [1]), wild(1)], { targetNumber: 1 });
    expect(o).toMatchObject({ success: false, raises: 0, criticalFailure: true });
  });

  it("T-54 crit lifted by a high modifier stays a failure", () => {
    const [o] = trait([chain("D6", [1]), wild(1)], { traitModifier: 20 });
    expect(o).toMatchObject({ total: 21, success: false, raises: 0, criticalFailure: true });
  });

  it.each([
    ["[1,1] + wild 6 -> no crit", [1, 1], 6, false],
    ["[1,1] + wild 1 -> crit", [1, 1], 1, true],
    ["[1,5] + wild 1 -> crit (2 of 3)", [1, 5], 1, true],
    ["[1,5,5] + wild 1 -> no crit (2 of 4 is not more than half)", [1, 5, 5], 1, false],
    ["[1,1,4] + wild 1 -> crit (3 of 4)", [1, 1, 4], 1, true],
    ["[1,4,5] + wild 1 -> no crit", [1, 4, 5], 1, false],
  ])("T-54 multi-die with Wild Die (A-02): %s", (_label, rolls, wildRoll, expected) => {
    const chains = [...(rolls as number[]).map((r) => chain("D8", [r])), wild(wildRoll as number)];
    expect(status(chains).isCritical).toBe(expected);
    const outcomes = trait(chains, { targetNumber: 1 });
    if (expected) {
      expect(outcomes.every((o) => o.success === false && o.raises === 0 && o.criticalFailure === true)).toBe(true);
    } else {
      expect(outcomes.some((o) => o.criticalFailure)).toBe(false);
    }
  });

  it.each([
    ["[1,1,5] -> possible", [1, 1, 5], true],
    ["[1,5] -> possible", [1, 5], true],
    ["[1,5,5] -> none", [1, 5, 5], false],
    ["[1,1,1] -> possible", [1, 1, 1], true],
  ])("T-54 Extras, no Wild Die (A-09): %s", (_label, rolls, expected) => {
    const chains = (rolls as number[]).map((r) => chain("D8", [r]));
    expect(status(chains, false)).toMatchObject({ isCritical: false, isPossible: expected });
    const outcomes = trait(chains, { wildDieEnabled: false });
    expect(outcomes.every((o) => (o.possibleCriticalFailure === true) === expected)).toBe(true);
  });

  it("a natural 1 counts, an exploded chain does not start with 1", () => {
    expect(status([chain("D4", [4, 1]), wild(1)]).isCritical).toBe(false);
  });
});

describe("T-11 damage roll results (OD-5: no success/raises)", () => {
  it("d6 + d8 + 2 (golden values) -> one outcome, total 13, no success/raises keys", () => {
    const out = computeOutcomes("DAMAGE", [chain("D6", [4]), chain("D8", [7])], settings({ damageModifier: 2, traitModifier: 5 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ total: 13, modifier: 2, replacedByWild: false });
    expect(out[0]).not.toHaveProperty("success");
    expect(out[0]).not.toHaveProperty("raises");
  });

  it("2d6 with one ace [6,2] + [3] = 11", () => {
    const [o] = computeOutcomes("DAMAGE", [chain("D6", [6, 2]), chain("D6", [3])], settings());
    expect(o.total).toBe(11);
  });

  it("negative modifier can make the total <= 0", () => {
    const [o] = computeOutcomes("DAMAGE", [chain("D4", [1])], settings({ damageModifier: -3 }));
    expect(o.total).toBe(-2);
  });

  it("T-11 single die in forced DAMAGE mode -> one outcome, die + damage modifier", () => {
    const out = computeOutcomes("DAMAGE", [chain("D8", [5])], settings({ damageModifier: 1 }));
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(6);
    expect(out[0]).not.toHaveProperty("success");
  });

  it("T-11 a wild chain in DAMAGE data (remote payload) is counted in the total", () => {
    const [o] = computeOutcomes("DAMAGE", [chain("D6", [4]), wild(3)], settings({ damageModifier: 1 }));
    expect(o.total).toBe(8);
    expect(o.replacedByWild).toBe(false);
  });
});

describe("T-25 raises and success math", () => {
  const one = (total: number, targetNumber: number) => {
    // a d12 chain of 6, the modifier brings it to the wanted total
    const [o] = trait([chain("D12", [6])], { traitModifier: total - 6, targetNumber, wildDieEnabled: false });
    return o;
  };

  it.each([
    [4, 4, true, 0],
    [7, 4, true, 0],
    [8, 4, true, 1],
    [11, 4, true, 1],
    [12, 4, true, 2],
    [3, 4, false, 0],
    [-4, 4, false, 0],
    [1, 1, true, 0],
    [5, 1, true, 1],
    [0, 1, false, 0],
  ])("total %i vs TN %i -> success %s, raises %i", (total, tn, success, raises) => {
    const o = one(total, tn);
    expect(o.total).toBe(total);
    expect(o.success).toBe(success);
    expect(o.raises).toBe(raises);
    expect(countRaises(total, tn)).toBe(raises);
  });

  it("negative TN math: countRaises(-4, -8) -> 1 (total 4 over the TN)", () => {
    expect(countRaises(-4, -8)).toBe(1);
  });

  it("the damage modifier is applied once to a multi-chain DAMAGE outcome", () => {
    const [o] = computeOutcomes("DAMAGE", [chain("D6", [3]), chain("D8", [4]), chain("D4", [2])], settings({ damageModifier: 2 }));
    expect(o.total).toBe(11);
    expect(o.modifier).toBe(2);
  });

  it("the trait modifier is applied to each multi-die TRAIT outcome once", () => {
    const out = trait([chain("D8", [3]), chain("D8", [5])], { traitModifier: 2, wildDieEnabled: false });
    expect(out.map((o) => o.total)).toEqual([5, 7]);
  });
});

describe("T-12 STANDARD mode results (A-03: no modifier)", () => {
  it("d4 + d12 showing 12 -> one raw outcome per die, modifier 0, no TN fields", () => {
    const out = computeOutcomes("STANDARD", [chain("D4", [3]), chain("D12", [12])], settings({ damageModifier: 2, traitModifier: 1 }));
    expect(out.map((o) => [o.total, o.modifier])).toEqual([
      [3, 0],
      [12, 0],
    ]);
    for (const o of out) {
      expect(o).not.toHaveProperty("success");
      expect(o).not.toHaveProperty("raises");
    }
  });

  it("T-06 STANDARD with damage modifier +2 -> the result modifier is 0 and total - modifier = raw value", () => {
    const r = computeRollResult(
      { mode: "STANDARD", dieChains: [chain("D4", [3])], isComplete: true, timestamp: 1 },
      settings({ damageModifier: 2 })
    );
    expect(r.modifier).toBe(0);
    expect(r.outcomes[0].total - r.modifier).toBe(3);
  });
});

type Fixture = { result: SavageRollResult };
const asResult = (f: unknown) => structuredClone((f as Fixture).result);
const settingsOf = (r: SavageRollResult): RollSettings => ({
  targetNumber: r.targetNumber,
  traitModifier: r.mode === "TRAIT" ? r.modifier : 0,
  damageModifier: r.mode === "DAMAGE" ? r.modifier : 0,
  wildDieEnabled: r.wildDieEnabled,
});

describe("golden broadcasts recalculated by the engine", () => {
  it.each([
    ["traitWildDie", traitWildDie],
    ["traitWildDie.modifierChanged", modifierChanged],
    ["multiTraitWildDie", multiTraitWildDie],
    ["standard", standard],
    ["explodingChain", explodingChain],
  ])("%s: the engine gives the golden result", (_name, fixture) => {
    const golden = asResult(fixture);
    expect(computeRollResult(golden, settingsOf(golden))).toEqual(golden);
  });

  it("traitNoWild.rolledOne (A-01 contract addition): golden fields kept, possibleCriticalFailure added", () => {
    const golden = asResult(rolledOne);
    const result = computeRollResult(golden, settingsOf(golden));
    expect(result.outcomes[0]).toEqual({
      ...golden.outcomes[0],
      possibleCriticalFailure: true,
      criticalFailureReason: "Trait die rolled 1 (no wild die)",
    });
  });

  it.each([
    ["damage", damage],
    ["damageExploding", damageExploding],
  ])("%s (OD-5 contract change): same totals, success and raises removed", (_name, fixture) => {
    const golden = asResult(fixture);
    const result = computeRollResult(golden, settingsOf(golden));
    const expected = {
      ...golden,
      outcomes: golden.outcomes.map(({ success: _s, raises: _r, ...rest }) => rest),
    };
    expect(result).toEqual(expected);
  });

  it("T-06 TRAIT + wild: modifier +1 -> -2 gives the modifierChanged golden (total 3, failure, 0 raises), timestamp kept", () => {
    const golden = asResult(traitWildDie);
    const changed = computeRollResult(golden, { ...settingsOf(golden), traitModifier: -2 });
    expect(changed).toEqual(asResult(modifierChanged));
    expect(changed.timestamp).toBe(golden.timestamp);
  });

  it("T-06 TRAIT + wild: TN 4 -> 8 changes success and raises", () => {
    const golden = asResult(explodingChain);
    const r = computeRollResult(golden, { ...settingsOf(golden), targetNumber: 8 });
    expect(r.targetNumber).toBe(8);
    expect(r.outcomes[0]).toMatchObject({ total: 15, success: true, raises: 1 });
    const r2 = computeRollResult(golden, { ...settingsOf(golden), targetNumber: 16 });
    expect(r2.outcomes[0]).toMatchObject({ success: false, raises: 0 });
  });

  it("T-06 trait modifier change during a DAMAGE result -> no change (and damage modifier during TRAIT)", () => {
    const d = asResult(damage);
    const base = settingsOf(d);
    expect(computeRollResult(d, { ...base, traitModifier: 7 })).toEqual(computeRollResult(d, base));
    const t = asResult(traitWildDie);
    const tb = settingsOf(t);
    expect(computeRollResult(t, { ...tb, damageModifier: 7 })).toEqual(computeRollResult(t, tb));
  });
});

describe("T-54 receivers: crit status from the payload field, or computed for old payloads", () => {
  it("old payload without crit fields (golden traitNoWild.rolledOne) -> computed locally: possible", () => {
    const r = asResult(rolledOne);
    expect(getOutcomeCriticalStatus(r, 0)).toMatchObject({ isCritical: false, isPossible: true });
  });

  it("old payload with a modifier-lifted crit that says success -> computed locally: critical", () => {
    const r = asResult(traitWildDie);
    r.dieChains = [chain("D8", [1]), wild(1)];
    r.outcomes = [{ ...r.outcomes[0], chains: [r.dieChains[0]], total: 4, success: true, raises: 0 }];
    expect(getOutcomeCriticalStatus(r, 0).isCritical).toBe(true);
  });

  it("new payload -> rendered from the field, not from the chains", () => {
    const r = asResult(traitWildDie);
    r.outcomes[0] = { ...r.outcomes[0], criticalFailure: true, success: false, raises: 0, criticalFailureReason: "x" };
    expect(getOutcomeCriticalStatus(r, 0)).toEqual({ isCritical: true, isPossible: false, reason: "x" });
  });

  it("out-of-range outcome index and non-TRAIT results -> none", () => {
    expect(getOutcomeCriticalStatus(asResult(traitWildDie), 5)).toEqual({ isCritical: false, isPossible: false });
    expect(getOutcomeCriticalStatus(asResult(damage), 0)).toEqual({ isCritical: false, isPossible: false });
  });
});

/** Small seeded PRNG (mulberry32), so failures are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("T-46 / T-61 invariants on 2000 seeded generated rolls", () => {
  const types: DiceType[] = ["D4", "D6", "D8", "D10", "D12"];
  const max: Record<DiceType, number> = { D4: 4, D6: 6, D8: 8, D10: 10, D12: 12 };

  it("total = sum of chains + modifier; success = total >= TN; raises = floor((total - TN) / 4); crit forces failure", () => {
    const random = rng(42);
    const int = (n: number) => Math.floor(random() * n);
    const genChain = (type: DiceType, isWild = false) => {
      const rolls: number[] = [];
      let explosions = 0;
      for (;;) {
        const v = 1 + int(max[type]);
        rolls.push(v);
        if (v !== max[type] || explosions++ >= 4) break;
      }
      return chain(type, rolls, isWild);
    };

    for (let i = 0; i < 2000; i++) {
      const mode = (["TRAIT", "DAMAGE", "STANDARD"] as const)[int(3)];
      const chains = Array.from({ length: 1 + int(4) }, () => genChain(types[int(5)]));
      const wildState = int(3); // 0 absent, 1 present+on, 2 present+off
      if (mode === "TRAIT" && wildState > 0) chains.push(genChain("D6", true));
      const s = settings({
        targetNumber: 1 + int(12),
        traitModifier: int(13) - 6,
        damageModifier: int(13) - 6,
        wildDieEnabled: wildState !== 2,
      });
      const r = computeRollResult({ mode, dieChains: chains, isComplete: true, timestamp: i }, s);
      const crit = getCriticalFailureStatusForChains(mode, chains, s.wildDieEnabled);

      expect(r.wildDieEnabled).toBe(s.wildDieEnabled);
      expect(r.targetNumber).toBe(s.targetNumber);
      for (const o of r.outcomes) {
        expect(o.total).toBe(o.chains.reduce((sum, c) => sum + c.total, 0) + o.modifier);
        expect(o.modifier).toBe(r.modifier);
        if (mode === "TRAIT") {
          expect(o.success).toBe(!crit.isCritical && o.total >= s.targetNumber);
          expect(o.raises).toBe(o.success ? Math.floor((o.total - s.targetNumber) / 4) : 0);
          expect(o.criticalFailure === true).toBe(crit.isCritical);
        } else {
          expect(o).not.toHaveProperty("success");
          expect(o).not.toHaveProperty("raises");
        }
      }
      if (mode === "TRAIT") {
        expect(r.outcomes).toHaveLength(chains.filter((c) => !c.isWildDie).length);
        expect(r.outcomes.filter((o) => o.replacedByWild).length).toBeLessThanOrEqual(1);
        if (!s.wildDieEnabled) expect(r.outcomes.some((o) => o.replacedByWild)).toBe(false);
      }
      if (mode === "DAMAGE") expect(r.outcomes).toHaveLength(1);
      if (mode === "STANDARD") expect(r.modifier).toBe(0);
    }
  });
});
