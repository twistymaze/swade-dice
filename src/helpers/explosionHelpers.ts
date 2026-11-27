import { DiceType } from "../types/DiceType";

const MAX_VALUES: Record<DiceType, number> = { D4: 4, D6: 6, D8: 8, D10: 10, D12: 12 };

/**
 * The maximum face value of a die type, or 0 for an unknown type (for example a die type from
 * another client's payload). The one max-value function of the app (T-B2).
 */
export function getMaxValueForDie(dieType: DiceType | string): number {
  return Object.prototype.hasOwnProperty.call(MAX_VALUES, dieType)
    ? MAX_VALUES[dieType as DiceType]
    : 0;
}

/**
 * Check if a die value should explode (equals its max value)
 */
export function shouldDieExplode(value: number, dieType: DiceType): boolean {
  const max = getMaxValueForDie(dieType);
  return max > 0 && value === max;
}

/** A face value that a die of this type can show: an integer in 1..max (A-08). */
export function isValidFaceValue(value: number, dieType: DiceType): boolean {
  return Number.isInteger(value) && value >= 1 && value <= getMaxValueForDie(dieType);
}

/**
 * Maximum number of explosions allowed per die to prevent infinite loops
 */
export const MAX_EXPLOSIONS = 50;
