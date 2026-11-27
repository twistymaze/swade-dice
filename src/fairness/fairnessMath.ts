import { DiceType } from "../types/DiceType";
import { getMaxValueForDie } from "../helpers/explosionHelpers";

/**
 * Chi-squared critical values at p = 0.05 for df = sides - 1 (T-B5).
 * A fair die passes when the statistic is below the value.
 */
export const CHI_SQUARED_CRITICAL_005: Record<DiceType, number> = {
  D4: 7.815, // df 3
  D6: 11.07, // df 5
  D8: 14.067, // df 7
  D10: 16.919, // df 9
  D12: 19.675, // df 11
};

export function getSides(dieType: DiceType): number {
  const sides = getMaxValueForDie(dieType);
  if (sides === 0) throw new Error(`Unknown die type: ${dieType}`);
  return sides;
}

/** True when the value is a face of a die with this many sides (T-B6). */
export function isFaceValue(value: number, sides: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= sides;
}

/** Count of each face 1..sides. Values out of range are not counted (T-B6). */
export function countFaces(values: readonly number[], sides: number): number[] {
  const counts = new Array<number>(sides).fill(0);
  for (const value of values) {
    if (isFaceValue(value, sides)) counts[value - 1]! += 1;
  }
  return counts;
}

/** Expected count per face from the rolls actually made, not the planned count (T-B4). */
export function expectedPerFace(counts: readonly number[]): number {
  const rolled = counts.reduce((sum, count) => sum + count, 0);
  return counts.length > 0 ? rolled / counts.length : 0;
}

/** Pearson chi-squared statistic. 0 when there are no rolls. */
export function chiSquared(counts: readonly number[]): number {
  const expected = expectedPerFace(counts);
  if (expected === 0) return 0;
  return counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
}

export interface FairnessSummary {
  counts: number[];
  expected: number;
  chiSquared: number;
  criticalValue: number;
  isFair: boolean;
}

export function summarizeFairness(values: readonly number[], dieType: DiceType): FairnessSummary {
  const counts = countFaces(values, getSides(dieType));
  const statistic = chiSquared(counts);
  const criticalValue = CHI_SQUARED_CRITICAL_005[dieType];
  return {
    counts,
    expected: expectedPerFace(counts),
    chiSquared: statistic,
    criticalValue,
    isFair: statistic < criticalValue,
  };
}

/** Start is possible with exactly one die selected and at least one roll planned (T-B7). */
export function canStartFairnessTest(counts: Record<string, number>, numberRolls: number): boolean {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return total === 1 && numberRolls >= 1;
}

/** Push the chart data to React state every this many rolls, not every roll (E-11). */
export const FAIRNESS_UPDATE_EVERY = 50;
