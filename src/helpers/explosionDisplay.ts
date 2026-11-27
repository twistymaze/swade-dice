import { DiceType } from "../types/DiceType";
import { getMaxValueForDie } from "./explosionHelpers";

/**
 * Get the maximum value for a given die type (0 for an unknown type)
 */
export function getMaxValue(dieType: DiceType | string): number {
  return getMaxValueForDie(dieType);
}
