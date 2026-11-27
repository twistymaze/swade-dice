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

describe("controls that edit a finished roll follow the roll's mode", () => {
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

  it("a STANDARD roll enables neither modifier", () => {
    const d = { id: generateDiceId(), type: "D8" as const, style: "GALAXY" as const };
    act(() => dice().startRoll({ dice: [d] }, { mode: "STANDARD" }));
    const { result } = renderHook(() => useDiceMode());
    expect(result.current).toMatchObject({ isTraitTest: false, isDamageRoll: false });
  });

  it("without a roll the mode follows the selection", () => {
    const id = Object.keys(controls().diceCounts)[0];
    act(() => controls().changeDieCount(id!, 1));
    const { result } = renderHook(() => useDiceMode());
    expect(result.current).toMatchObject({ hasActiveRoll: false, isTraitTest: true, currentSelectionCount: 1 });
    act(() => controls().resetDiceCounts());
  });
});

describe("dice mode hook", () => {
  it("no selection and no roll -> \"none\"", () => {
    act(() => controls().resetDiceCounts());
    const { result } = renderHook(() => useDiceMode());
    expect(result.current).toMatchObject({ mode: "none", hasActiveRoll: false, currentSelectionCount: 0 });
  });

  it("1 die selected -> \"trait\"; 2 dice -> \"damage\"", () => {
    const [a, b] = Object.keys(controls().diceCounts);
    act(() => controls().changeDieCount(a!, 1));
    const { result } = renderHook(() => useDiceMode());
    expect(result.current.mode).toBe("trait");
    act(() => controls().changeDieCount(b!, 1));
    expect(result.current.mode).toBe("damage");
    act(() => controls().resetDiceCounts());
  });

  it("forced DAMAGE with 1 die selected -> \"damage\" and the damage modifier applies", () => {
    const [a] = Object.keys(controls().diceCounts);
    act(() => {
      controls().changeDieCount(a!, 1);
      controls().setModeChoice("DAMAGE");
    });
    const { result } = renderHook(() => useDiceMode());
    expect(result.current).toMatchObject({ mode: "damage", isTraitTest: false, isDamageRoll: true });
    act(() => controls().resetDiceCounts());
  });

  it("an active roll with explosions counts only the original non-wild dice", () => {
    const d1 = { id: generateDiceId(), type: "D4" as const, style: "GALAXY" as const };
    const d2 = { id: generateDiceId(), type: "D6" as const, style: "GALAXY" as const };
    const wild = createWildDie();
    act(() => {
      dice().startRoll({ dice: [d1, d2, wild] }, { mode: "TRAIT" });
      dice().checkAndProcessExplosion(d1.id, 4, T); // explodes
      dice().checkAndProcessExplosion(wild.id, 6, T); // explodes
    });
    expect(Object.keys(dice().dieInfo)).toHaveLength(5);
    const { result } = renderHook(() => useDiceMode());
    expect(result.current).toMatchObject({ hasActiveRoll: true, originalNonWildDiceCount: 2, mode: "trait" });
  });
});
