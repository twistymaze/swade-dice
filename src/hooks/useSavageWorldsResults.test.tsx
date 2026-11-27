import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSavageWorldsResults } from "./useSavageWorldsResults";
import { useDiceRollStore } from "../dice/store";
import { useDiceControlsStore } from "../controls/store";
import { computeRollResult } from "../rules/outcomes";
import { createWildDie } from "../helpers/wildDie";
import { generateDiceId } from "../helpers/generateDiceId";
import { DiceTransform } from "../types/DiceTransform";
import { SavageRollResult } from "../types/SavageWorldsTypes";

import damageFixture from "../test/fixtures/golden/broadcast.rollResult.damage.json";
import standardFixture from "../test/fixtures/golden/broadcast.rollResult.standard.json";

const T: DiceTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const controls = () => useDiceControlsStore.getState();
const dice = () => useDiceRollStore.getState();

/** A finished TRAIT d6 + Wild Die roll with the given faces. */
function rollTrait(traitFace: number, wildFace: number) {
  const trait = { id: generateDiceId(), type: "D6" as const, style: "GALAXY" as const };
  const wild = createWildDie();
  act(() => {
    dice().startRoll({ dice: [trait, wild] }, { mode: "TRAIT" });
    dice().checkAndProcessExplosion(trait.id, traitFace, T);
    dice().checkAndProcessExplosion(wild.id, wildFace, T);
  });
}

function setStoredResult(result: SavageRollResult) {
  act(() => useDiceRollStore.setState({ currentRollResult: { ...structuredClone(result), rollId: "r1", hidden: false } }));
}

beforeEach(() => {
  act(() => {
    dice().clearRoll();
    useDiceControlsStore.setState({ targetNumber: 4, traitModifier: 0, damageModifier: 0, wildDieEnabled: true });
  });
});

describe("recalculation after a post-roll edit", () => {
  it("null without a result", () => {
    const { result } = renderHook(() => useSavageWorldsResults());
    expect(result.current).toBeNull();
  });

  it("TN, modifier and Wild Die edits recalculate all fields; the timestamp is kept", () => {
    rollTrait(3, 5);
    const { result } = renderHook(() => useSavageWorldsResults());
    const timestamp = result.current!.timestamp;
    expect(result.current!.outcomes[0]).toMatchObject({ total: 5, replacedByWild: true, success: true, raises: 0 });

    act(() => controls().setTargetNumber(8));
    expect(result.current!.targetNumber).toBe(8);
    expect(result.current!.outcomes[0]).toMatchObject({ success: false, raises: 0 });

    act(() => controls().setTraitModifier(7));
    expect(result.current!.modifier).toBe(7);
    expect(result.current!.outcomes[0]).toMatchObject({ total: 12, modifier: 7, success: true, raises: 1 });

    act(() => controls().toggleWildDie());
    expect(result.current!.wildDieEnabled).toBe(false);
    expect(result.current!.outcomes[0]).toMatchObject({ total: 10, replacedByWild: false });
    expect(result.current!.dieChains.some((c) => c.isWildDie)).toBe(true);
    expect(result.current!.timestamp).toBe(timestamp);
  });

  it("a modifier raised after the roll keeps the crit; Wild Die off -> possible", () => {
    rollTrait(1, 1);
    const { result } = renderHook(() => useSavageWorldsResults());
    expect(result.current!.outcomes[0]).toMatchObject({ criticalFailure: true, success: false });
    act(() => controls().setTraitModifier(10));
    expect(result.current!.outcomes[0]).toMatchObject({ total: 11, criticalFailure: true, success: false, raises: 0 });
    act(() => controls().toggleWildDie());
    expect(result.current!.outcomes[0]!.criticalFailure).toBeUndefined();
    expect(result.current!.outcomes[0]!.possibleCriticalFailure).toBe(true);
    expect(result.current!.outcomes[0]!.success).toBe(true);
  });

  it("DAMAGE: the damage modifier updates the total; a TN change adds no success/raises", () => {
    setStoredResult((damageFixture as unknown as { result: SavageRollResult }).result);
    const { result } = renderHook(() => useSavageWorldsResults());
    act(() => controls().setDamageModifier(5));
    expect(result.current!.outcomes[0]!.total).toBe(4 + 7 + 5);
    act(() => controls().setTargetNumber(12));
    expect(result.current!.outcomes[0]).not.toHaveProperty("success");
    expect(result.current!.outcomes[0]).not.toHaveProperty("raises");
  });

  it("STANDARD: the shown modifier is the applied one (0) after damage modifier edits", () => {
    setStoredResult((standardFixture as unknown as { result: SavageRollResult }).result);
    const { result } = renderHook(() => useSavageWorldsResults());
    act(() => controls().setDamageModifier(2));
    expect(result.current!.modifier).toBe(0);
    expect(result.current!.outcomes.map((o) => [o.total, o.modifier])).toEqual([
      [3, 0],
      [12, 0],
    ]);
    act(() => controls().setDamageModifier(0));
    expect(result.current!.outcomes.map((o) => o.total)).toEqual([3, 12]);
  });

  it("memo returns the same object when nothing relevant changed", () => {
    rollTrait(4, 2);
    const { result } = renderHook(() => useSavageWorldsResults());
    const first = result.current;
    act(() => controls().setResultsDetailsHovered(true));
    expect(result.current).toBe(first);
  });

  it("the hook equals the rules module for the live settings", () => {
    rollTrait(5, 3);
    act(() => {
      controls().setTargetNumber(6);
      controls().setTraitModifier(-1);
    });
    const { result } = renderHook(() => useSavageWorldsResults());
    const c = controls();
    expect(result.current).toEqual(
      computeRollResult(dice().currentRollResult!, {
        targetNumber: c.targetNumber,
        traitModifier: c.traitModifier,
        damageModifier: c.damageModifier,
        wildDieEnabled: c.wildDieEnabled,
      })
    );
  });
});
