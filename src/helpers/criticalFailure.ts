import { SavageRollResult } from "../types/SavageWorldsTypes";
import { CriticalFailureStatus, getOutcomeCriticalStatus } from "../rules/outcomes";

export type { CriticalFailureStatus } from "../rules/outcomes";

/**
 * Critical Failure status of one outcome, for display. The rule itself is in
 * `src/rules/outcomes.ts` (`getCriticalFailureStatusForChains`).
 */
export function getCriticalFailureStatus(
  result: SavageRollResult,
  outcomeIndex: number = 0
): CriticalFailureStatus {
  return getOutcomeCriticalStatus(result, outcomeIndex);
}

/**
 * Helper to format critical failure indicator for display
 */
export function formatCriticalIndicator(
  status: CriticalFailureStatus,
  verbose: boolean = false
): { text: string; color: string } | null {
  if (status.isCritical) {
    return {
      text: verbose ? "CRIT FAIL" : "CRIT",
      color: "#f44336" // Error red
    };
  }
  
  if (status.isPossible) {
    return {
      text: verbose ? "POSSIBLE CRIT" : "CRIT?",
      color: "#ff9800" // Warning amber
    };
  }
  
  return null;
}
