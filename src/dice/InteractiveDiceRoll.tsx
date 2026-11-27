import { useCallback, useMemo } from "react";
import { DiceTransform } from "../types/DiceTransform";
import { DiceRoll } from "./DiceRoll";
import { useDiceRollStore } from "./store";
import { Dice } from "./Dice";

/** Dice roll based off of the values from the dice roll store */
export function InteractiveDiceRoll() {
  const roll = useDiceRollStore((state) => state.roll);
  const rollThrows = useDiceRollStore((state) => state.rollThrows);
  const explosionDice = useDiceRollStore((state) => state.explosionDice);
  const finishedDice = useDiceRollStore((state) => state.finishedDice);
  const rollTransforms = useDiceRollStore((state) => state.rollTransforms);
  // Finished dice keep their resting pose when the tray remounts (Reload tray,
  // context loss). Dice that are still rolling have no transform yet.
  const transformsRef = useMemo(() => ({ current: rollTransforms }), [rollTransforms]);
  const checkAndProcessExplosion = useDiceRollStore((state) => state.checkAndProcessExplosion);
  
  // Handle die finished - check for explosions and update store
  const handleDieFinished = useCallback((id: string, value: number, transform: DiceTransform) => {
    // Check for explosions and update Savage Worlds state in store
    // This will also spawn explosion dice if needed
    // `false` = invalid face: PhysicsDice re-throws the die
    return checkAndProcessExplosion(id, value, transform);
  }, [checkAndProcessExplosion]);

  if (!roll) {
    return null;
  }

  return (
    <DiceRoll
      roll={roll}
      rollThrows={rollThrows}
      explosionDice={explosionDice}
      finishedDice={finishedDice}
      transformsRef={transformsRef}
      onRollFinished={handleDieFinished}
      Dice={Dice}
    />
  );
}