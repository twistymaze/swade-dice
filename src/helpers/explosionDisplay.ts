import { DiceType } from "../types/DiceType";

/**
 * Get the maximum value for a given die type
 */
export function getMaxValue(dieType: DiceType | string): number {
  switch (dieType) {
    case "D4": return 4;
    case "D6": return 6;
    case "D8": return 8;
    case "D10": return 10;
    case "D12": return 12;
    default: return 0;
  }
}
