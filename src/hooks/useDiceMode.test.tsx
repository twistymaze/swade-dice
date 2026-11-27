import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDiceMode } from "./useDiceMode";
import { useDiceRollStore } from "../dice/store";
import { useDiceControlsStore } from "../controls/store";
import { createWildDie } from "../helpers/wildDie";
import { generateDiceId } from "../helpers/generateDiceId";
import { DiceTransform } from "../types/DiceTransform";

const T: DiceTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const controls = () => useDiceControlsStore.getState();
const dice = () => useDiceRollStore.getState();

function rollTrait(traitFace: number, wildFace: number) {
  const trait = { id: generateDiceId(), type: "D6" as const, style: "GALAXY" as const };
  const wild = createWildDie();
  act(() => {
    dice().startRoll({ dice: [trait, wild] }, { mode: "TRAIT" });
    dice().checkAndProcessExplosion(trait.id, traitFace, T);
    dice().checkAndProcessExplosion(wild.id, wildFace, T);
  });
}

beforeEach(() => {
  act(() => dice().clearRoll());
});

describe("T-62 controls that edit a finished roll follow the roll's mode (D-08)", () => {
  it("a replayed TRAIT roll after resetDiceCounts (AUTO, 0 dice) keeps the trait controls on", () => {
    rollTrait(4, 2);
    act(() => controls().resetDiceCounts());
    expect(controls().rollMode).toBe("DAMAGE");
    const { result } = renderHook(() => useDiceMode());
    expect(result.current).toMatchObject({ hasActiveRoll: true, isTraitTest: true, isDamageRoll: false });
  });

  it("a DAMAGE roll enables the damage modifier, not the trait controls", () => {
    const d = { id: generateDiceId(), type: "D8" as const, style: "GALAXY" as const };
    act(() => {
      controls().setModeChoice("TRAIT");
      dice().startRoll({ dice: [d] }, { mode: "DAMAGE" });
    });
    const { result } = renderHook(() => useDiceMode());
    expect(result.current).toMatchObject({ isTraitTest: false, isDamageRoll: true });
    act(() => controls().setModeChoice("AUTO"));
  });

  it("A-03 a STANDARD roll enables neither modifier", () => {
    const d = { id: generateDiceId(), type: "D8" as const, style: "GALAXY" as const };
    act(() => dice().startRoll({ dice: [d] }, { mode: "STANDARD" }));
    const { result } = renderHook(() => useDiceMode());
    expect(result.current).toMatchObject({ isTraitTest: false, isDamageRoll: false });
  });

  it("without a roll the mode follows the selection", () => {
    const id = Object.keys(controls().diceCounts)[0];
    act(() => controls().changeDieCount(id, 1));
    const { result } = renderHook(() => useDiceMode());
    expect(result.current).toMatchObject({ hasActiveRoll: false, isTraitTest: true, currentSelectionCount: 1 });
    act(() => controls().resetDiceCounts());
  });
});
