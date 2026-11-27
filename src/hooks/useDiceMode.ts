import { useMemo } from "react";
import { useDiceControlsStore } from "../controls/store";
import { useDiceRollStore } from "../dice/store";

type DiceMode = "trait" | "damage" | "none";

export interface DiceState {
  mode: DiceMode;
  isTraitTest: boolean;
  isDamageRoll: boolean;
  hasActiveRoll: boolean;
  originalNonWildDiceCount: number;
  currentSelectionCount: number;
}

/**
 * Unified hook to determine the current dice mode and state
 * Used by various UI components to enable/disable features.
 * While a roll is in the tray, the mode is the roll's own mode, so the controls that edit a
 * finished roll (TN, modifiers, Wild Die) follow the shown result. Otherwise it is the
 * mode of the current dice selection. A STANDARD roll has no modifier, so neither modifier control
 * applies to it.
 */
export function useDiceMode(): DiceState {
  const diceCounts = useDiceControlsStore((state) => state.diceCounts);
  const selectionMode = useDiceControlsStore((state) => state.rollMode);
  const activeRollMode = useDiceRollStore((state) => state.rollMode);
  const dieInfo = useDiceRollStore((state) => state.dieInfo);
  const rollValues = useDiceRollStore((state) => state.rollValues);
  
  return useMemo(() => {
    // Check if we have an active roll
    const hasActiveRoll = Object.keys(dieInfo).length > 0 && 
                          Object.keys(rollValues).length > 0;
    
    let originalNonWildDiceCount = 0;
    
    // If we have an active roll, count original dice (not explosions)
    if (hasActiveRoll) {
      const originalDice = Object.values(dieInfo).filter(info => !info.parentDieId);
      originalNonWildDiceCount = originalDice.filter(info => !info.isWildDie).length;
    }
    
    // Check current selection
    const currentSelectionCount = Object.values(diceCounts).reduce((sum, count) => sum + count, 0);
    
    const rollMode = hasActiveRoll ? activeRollMode : selectionMode;
    const isTraitTest = rollMode === "TRAIT";
    const mode: DiceMode = currentSelectionCount > 0 || hasActiveRoll 
      ? (isTraitTest ? "trait" : "damage")
      : "none";
    
    return {
      mode,
      isTraitTest,
      isDamageRoll: mode === "damage" && rollMode === "DAMAGE",
      hasActiveRoll,
      originalNonWildDiceCount,
      currentSelectionCount,
    };
  }, [diceCounts, selectionMode, activeRollMode, dieInfo, rollValues]);
}
