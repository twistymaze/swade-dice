import { DieChain, ExplosionResult } from "../types/SavageWorldsTypes";
import { Die } from "../types/Die";
import { DiceThrow } from "../types/DiceThrow";
import { DiceType } from "../types/DiceType";
import { getRandomDiceThrow } from "../helpers/DiceThrower";
import { EXPLOSION_SPEED_MULTIPLIER } from "../constants/savageWorlds";

// Helper function to update explosion results
export function updateExplosionResults(
  explosionResults: Record<string, ExplosionResult>,
  parentDieId: string,
  value: number,
  dieType: DiceType,
  isWildDie: boolean
) {
  if (!explosionResults[parentDieId]) {
    explosionResults[parentDieId] = {
      dieId: parentDieId,
      dieType: dieType,
      rolls: [value],
      total: value,
      exploded: false,
      isWildDie,
    };
  } else {
    explosionResults[parentDieId].rolls.push(value);
    explosionResults[parentDieId].total += value;
  }
}

// Helper function to create explosion die
export function createExplosionDie(
  parentDieId: string,
  explosionCount: number,
  originalDie: Die
): { die: Die; throw: DiceThrow } {
  const explosionId = `${parentDieId}_explosion_${explosionCount + 1}`;
  const newDie: Die = {
    id: explosionId,
    type: originalDie.type,
    style: originalDie.style,
  };
  
  const diceThrow = getRandomDiceThrow(EXPLOSION_SPEED_MULTIPLIER);
  
  return { die: newDie, throw: diceThrow };
}

// Helper function to get parent die ID
export function getParentDieId(id: string): string {
  if (id.includes('_explosion_')) {
    return id.split('_explosion_')[0];
  }
  return id;
}

/** The die chains of a roll, in the order the root dice first finished. */
export function createDieChains(explosionResults: Record<string, ExplosionResult>): DieChain[] {
  return Object.values(explosionResults).map((exp) => ({
    dieId: exp.dieId,
    dieType: exp.dieType,
    rolls: [...exp.rolls],
    total: exp.total,
    isWildDie: exp.isWildDie,
  }));
}
