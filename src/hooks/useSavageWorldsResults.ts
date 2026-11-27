import { useMemo } from "react";
import { useDiceRollStore } from "../dice/store";
import { useDiceControlsStore } from "../controls/store";
import { SavageRollResult } from "../types/SavageWorldsTypes";
import { computeRollResult } from "../rules/outcomes";

/**
 * The current Savage Worlds roll result, recalculated with the live TN, modifiers and Wild Die
 * setting (post-roll edits). Every field is recalculated by the one rules engine
 * (`src/rules/outcomes.ts`), so this is also what is shown in the history and broadcast.
 */
export function useSavageWorldsResults(): SavageRollResult | null {
  const currentRollResult = useDiceRollStore((state) => state.currentRollResult);
  
  const targetNumber = useDiceControlsStore((state) => state.targetNumber);
  const traitModifier = useDiceControlsStore((state) => state.traitModifier);
  const damageModifier = useDiceControlsStore((state) => state.damageModifier);
  const wildDieEnabled = useDiceControlsStore((state) => state.wildDieEnabled);
  
  return useMemo(() => {
    if (!currentRollResult) return null;
    return computeRollResult(currentRollResult, {
      targetNumber,
      traitModifier,
      damageModifier,
      wildDieEnabled,
    });
  }, [currentRollResult, targetNumber, traitModifier, damageModifier, wildDieEnabled]);
}
