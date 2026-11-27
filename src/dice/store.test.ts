import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectIsRolling, selectPendingDiceIds, useDiceRollStore } from "./store";
import { useDiceControlsStore, getDiceToRoll } from "../controls/store";
import { Die } from "../types/Die";
import { DiceTransform } from "../types/DiceTransform";
import { MAX_EXPLOSIONS } from "../helpers/explosionHelpers";
import { createWildDie } from "../helpers/wildDie";
import { generateDiceId } from "../helpers/generateDiceId";

const T: DiceTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const store = () => useDiceRollStore.getState();
const die = (type: Die["type"], style: Die["style"] = "GALAXY"): Die => ({ id: generateDiceId(), type, style });
const finish = (id: string, value: number) => store().checkAndProcessExplosion(id, value, T);
const SETTINGS = { targetNumber: 4, traitModifier: 1, damageModifier: 2, wildDieEnabled: true };

/** D-07 invariant: pending empty <=> every value set <=> result set. */
function expectProgressInvariant() {
  const s = store();
  const pending = selectPendingDiceIds(s);
  const allSet = Object.values(s.rollValues).every((v) => v !== null);
  expect(pending.length === 0).toBe(allSet);
  if (s.roll) expect(s.currentRollResult !== null).toBe(allSet && Object.keys(s.rollValues).length > 0);
  expect([...s.finishedDice].sort()).toEqual(Object.keys(s.rollValues).filter((id) => s.rollValues[id] !== null).sort());
}

beforeEach(() => {
  store().clearRoll();
});

describe("T-23 start / clear state shape", () => {
  it("startRoll marks all dice pending, one throw per die, the flagged die as wild (D-12)", () => {
    const trait = die("D8");
    const wild = createWildDie();
    store().startRoll({ dice: [trait, wild] }, { mode: "TRAIT", settings: SETTINGS });
    const s = store();
    expect(selectPendingDiceIds(s)).toEqual([trait.id, wild.id]);
    expect(Object.keys(s.rollThrows)).toEqual([trait.id, wild.id]);
    expect(s.dieInfo[wild.id].isWildDie).toBe(true);
    expect(s.dieInfo[trait.id].isWildDie).toBe(false);
    expect(s.currentRollResult).toBeNull();
    expectProgressInvariant();
  });

  it("D-12 a NEBULA D6 without the flag is not the Wild Die", () => {
    const nebula = die("D6", "NEBULA");
    store().startRoll({ dice: [nebula] }, { mode: "TRAIT" });
    expect(store().dieInfo[nebula.id].isWildDie).toBe(false);
  });

  it("roll with 0 dice -> no pending, no result, no throw", () => {
    expect(() => store().startRoll({ dice: [] }, { mode: "DAMAGE" })).not.toThrow();
    expect(selectIsRolling(store())).toBe(false);
    expect(store().currentRollResult).toBeNull();
  });

  it("nested Dice groups are flattened", () => {
    const a = die("D6");
    const b = die("D8");
    store().startRoll({ dice: [a, { dice: [b] }] }, { mode: "DAMAGE" });
    expect(selectPendingDiceIds(store())).toEqual([a.id, b.id]);
  });

  it("T-B8 clearRoll resets rollMode and settings", () => {
    store().startRoll({ dice: [die("D4")] }, { mode: "STANDARD", settings: SETTINGS });
    store().clearRoll();
    expect(store().rollMode).toBe("TRAIT");
    expect(store().roll).toBeNull();
    expect(store().rollSettings).toEqual({ targetNumber: 4, traitModifier: 0, damageModifier: 0, wildDieEnabled: true });
  });
});

describe("T-09 explosion processing", () => {
  it("d4 explodes on 4: chain 4, 4, 1 -> rolls [4,4,1], total 9, ids X_explosion_1, X_explosion_2", () => {
    const d4 = die("D4");
    store().startRoll({ dice: [d4] }, { mode: "DAMAGE", settings: SETTINGS });
    finish(d4.id, 4);
    expect(store().explosionDice.map((d) => d.id)).toEqual([`${d4.id}_explosion_1`]);
    expectProgressInvariant();
    finish(`${d4.id}_explosion_1`, 4);
    finish(`${d4.id}_explosion_2`, 1);
    const s = store();
    expect(s.explosionResults[d4.id]).toMatchObject({ rolls: [4, 4, 1], total: 9, exploded: true });
    expect(s.currentRollResult?.outcomes[0].total).toBe(9 + 2);
    expectProgressInvariant();
  });

  it.each([
    ["D8", 8],
    ["D10", 10],
    ["D12", 12],
  ] as const)("%s explodes on %i; a lower value does not", (type, max) => {
    const d = die(type);
    store().startRoll({ dice: [d] }, { mode: "DAMAGE" });
    finish(d.id, max - 1);
    expect(store().explosionDice).toHaveLength(0);
    expect(store().currentRollResult).not.toBeNull();
    const d2 = die(type);
    store().startRoll({ dice: [d2] }, { mode: "DAMAGE" });
    finish(d2.id, max);
    expect(store().explosionDice).toHaveLength(1);
  });

  it("STANDARD never explodes", () => {
    const d = die("D12");
    store().startRoll({ dice: [d] }, { mode: "STANDARD" });
    finish(d.id, 12);
    expect(store().explosionDice).toHaveLength(0);
    expect(store().currentRollResult?.outcomes[0]).toMatchObject({ total: 12, modifier: 0 });
  });

  it("the Wild Die explodes: the explosion die is wild, the chain stays the wild chain", () => {
    const t = die("D8");
    const w = createWildDie();
    store().startRoll({ dice: [t, w] }, { mode: "TRAIT", settings: SETTINGS });
    finish(t.id, 3);
    finish(w.id, 6);
    const explosionId = `${w.id}_explosion_1`;
    expect(store().dieInfo[explosionId]).toMatchObject({ isWildDie: true, parentDieId: w.id });
    finish(explosionId, 2);
    const result = store().currentRollResult!;
    expect(result.dieChains.find((c) => c.isWildDie)).toMatchObject({ rolls: [6, 2], total: 8 });
    expect(result.outcomes[0]).toMatchObject({ total: 9, replacedByWild: true });
  });

  it("finish order: an explosion die settles before the other original die -> result only after both", () => {
    const a = die("D6");
    const b = die("D6");
    store().startRoll({ dice: [a, b] }, { mode: "DAMAGE" });
    finish(a.id, 6);
    finish(`${a.id}_explosion_1`, 2);
    expect(store().currentRollResult).toBeNull();
    finish(b.id, 3);
    expect(store().currentRollResult?.outcomes[0].total).toBe(11);
  });

  it("MAX_EXPLOSIONS: after 50 aces the 51st roll is stored, no further die spawns, the roll completes", () => {
    const d = die("D4");
    store().startRoll({ dice: [d] }, { mode: "DAMAGE" });
    finish(d.id, 4);
    for (let i = 1; i <= MAX_EXPLOSIONS; i++) finish(`${d.id}_explosion_${i}`, 4);
    const s = store();
    expect(s.explosionResults[d.id].rolls).toHaveLength(MAX_EXPLOSIONS + 1);
    expect(s.explosionDice).toHaveLength(MAX_EXPLOSIONS);
    expect(s.currentRollResult).not.toBeNull();
  });

  it("unknown die id -> ignored, no state change", () => {
    const d = die("D6");
    store().startRoll({ dice: [d] }, { mode: "DAMAGE" });
    const before = store();
    finish("nope", 3);
    expect(store()).toBe(before);
  });
});

describe("T-18 duplicate 'die finished' calls are idempotent (A-05)", () => {
  it("same id twice with value 3 -> rolls [3], not [3,3]", () => {
    const a = die("D6");
    const b = die("D6");
    store().startRoll({ dice: [a, b] }, { mode: "DAMAGE" });
    finish(a.id, 3);
    finish(a.id, 3);
    expect(store().explosionResults[a.id].rolls).toEqual([3]);
  });

  it("same id twice with max value -> only one explosion die", () => {
    const a = die("D6");
    store().startRoll({ dice: [a] }, { mode: "DAMAGE" });
    finish(a.id, 6);
    finish(a.id, 6);
    expect(store().explosionDice).toHaveLength(1);
    expect(store().explosionResults[a.id].rolls).toEqual([6]);
  });

  it("call after clearRoll (stale die) and for a previous roll's die after startRoll -> ignored", () => {
    const old = die("D6");
    store().startRoll({ dice: [old] }, { mode: "DAMAGE" });
    store().clearRoll();
    finish(old.id, 3);
    expect(store().rollValues).toEqual({});
    const next = die("D6");
    store().startRoll({ dice: [next] }, { mode: "DAMAGE" });
    finish(old.id, 3);
    expect(store().explosionResults).toEqual({});
    expect(selectPendingDiceIds(store())).toEqual([next.id]);
  });

  it("a second report after completion does not recompute the result", () => {
    const a = die("D6");
    store().startRoll({ dice: [a] }, { mode: "DAMAGE" });
    finish(a.id, 3);
    const result = store().currentRollResult;
    finish(a.id, 5);
    expect(store().currentRollResult).toBe(result);
  });
});

describe("T-56 face value validation when a die finishes (A-08)", () => {
  it.each([0, Number.NaN, -1, 2.5, 7])("value %s for a D6 -> rejected, not stored, die stays pending", (value) => {
    const a = die("D6");
    store().startRoll({ dice: [a] }, { mode: "DAMAGE" });
    expect(finish(a.id, value)).toBe(false);
    expect(store().rollValues[a.id]).toBeNull();
    expect(selectPendingDiceIds(store())).toEqual([a.id]);
  });

  it("a valid value afterwards is accepted and the roll completes", () => {
    const a = die("D6");
    store().startRoll({ dice: [a] }, { mode: "DAMAGE" });
    expect(finish(a.id, 0)).toBe(false);
    expect(finish(a.id, 4)).toBe(true);
    expect(store().currentRollResult?.outcomes[0].total).toBe(4);
  });
});

describe("T-19 / T-55 reroll (A-06, A-07, D-06)", () => {
  it("reroll is synchronous: new ids, hidden kept, mode kept, no timer", () => {
    vi.useFakeTimers();
    try {
      const t = die("D8");
      const w = createWildDie();
      store().startRoll({ dice: [t, w], hidden: true }, { mode: "TRAIT", speedMultiplier: 3, settings: SETTINGS });
      finish(t.id, 3);
      finish(w.id, 2);
      store().reroll({ wildDieEnabled: true });
      expect(vi.getTimerCount()).toBe(0);
      const s = store();
      const ids = selectPendingDiceIds(s);
      expect(ids).toHaveLength(2);
      expect(ids).not.toContain(t.id);
      expect(ids).not.toContain(w.id);
      expect(s.roll?.hidden).toBe(true);
      expect(s.rollMode).toBe("TRAIT");
      expect(s.rollSpeedMultiplier).toBe(3);
      expect(s.rollSettings).toEqual(SETTINGS);
      expect(s.currentRollResult).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reroll, then a new roll right away -> only the new roll's dice; it completes", () => {
    const a = die("D6");
    store().startRoll({ dice: [a] }, { mode: "DAMAGE" });
    finish(a.id, 3);
    store().reroll();
    const b = die("D10");
    store().startRoll({ dice: [b] }, { mode: "DAMAGE" });
    expect(selectPendingDiceIds(store())).toEqual([b.id]);
    finish(b.id, 5);
    expect(store().currentRollResult?.dieChains.map((c) => c.dieId)).toEqual([b.id]);
  });

  it("reroll, then clear -> stays cleared; reroll twice -> one roll, no merged dice", () => {
    const a = die("D6");
    store().startRoll({ dice: [a] }, { mode: "DAMAGE" });
    store().reroll();
    store().clearRoll();
    expect(store().roll).toBeNull();
    store().startRoll({ dice: [a] }, { mode: "DAMAGE" });
    store().reroll();
    store().reroll();
    expect(selectPendingDiceIds(store())).toHaveLength(1);
  });

  it("A-07 reroll after the Wild Die was turned off -> no wild die thrown", () => {
    const t = die("D8");
    const w = createWildDie();
    store().startRoll({ dice: [t, w] }, { mode: "TRAIT" });
    store().reroll({ wildDieEnabled: false });
    const infos = Object.values(store().dieInfo);
    expect(infos).toHaveLength(1);
    expect(infos[0].isWildDie).toBe(false);
    expect(infos[0].die.type).toBe("D8");
  });

  it("reroll after the Wild Die was turned on -> a wild die is added (TRAIT only)", () => {
    store().startRoll({ dice: [die("D8")] }, { mode: "TRAIT" });
    store().reroll({ wildDieEnabled: true });
    expect(Object.values(store().dieInfo).filter((i) => i.isWildDie)).toHaveLength(1);
    store().startRoll({ dice: [die("D8"), die("D6")] }, { mode: "DAMAGE" });
    store().reroll({ wildDieEnabled: true });
    expect(Object.values(store().dieInfo).some((i) => i.isWildDie)).toBe(false);
  });

  it("reroll with no roll -> no-op", () => {
    store().reroll();
    expect(store().roll).toBeNull();
  });
});

describe("T-61 / D-05 the roll records its own mode", () => {
  it("changing the controls rollMode after startRoll does not change the result mode", () => {
    const d = die("D8");
    store().startRoll({ dice: [d] }, { mode: "TRAIT", settings: SETTINGS });
    useDiceControlsStore.getState().setModeChoice("DAMAGE");
    finish(d.id, 5);
    expect(store().currentRollResult?.mode).toBe("TRAIT");
    useDiceControlsStore.getState().setModeChoice("AUTO");
  });

  it("the stored result uses the roll's settings: TRAIT +1 vs TN 4", () => {
    const dice = getDiceToRoll({ a: 1 }, { a: { id: "a", type: "D8", style: "GALAXY" } }, true, undefined, true);
    store().startRoll({ dice }, { mode: "TRAIT", settings: SETTINGS });
    const [traitDie, wildDie] = Object.keys(store().rollValues);
    finish(traitDie, 3);
    finish(wildDie, 5);
    expect(store().currentRollResult).toMatchObject({
      mode: "TRAIT",
      modifier: 1,
      targetNumber: 4,
      wildDieEnabled: true,
      isComplete: true,
      outcomes: [{ total: 6, replacedByWild: true, success: true, raises: 0 }],
    });
  });
});
