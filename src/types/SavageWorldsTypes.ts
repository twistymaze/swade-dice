import { DiceType } from "./DiceType";

/**
 * A single die chain (initial roll + any explosions)
 */
export interface DieChain {
  dieId: string;
  dieType: DiceType;
  rolls: number[];  // [initial, explosion1, explosion2, ...]
  total: number;    // Sum of all rolls
  isWildDie: boolean;
}

/**
 * A single result (could be a trait test or damage component)
 */
export interface RollOutcome {
  chains: DieChain[];     // The die chain(s) that contributed to this result
  modifier: number;       // Modifier applied to this result
  total: number;          // Final total including modifier
  /** vs target number. TRAIT only: DAMAGE and STANDARD outcomes have no success. */
  success?: boolean;
  /** Number of raises, 0 on a failure. TRAIT only. */
  raises?: number;
  replacedByWild: boolean;  // For trait tests - was worst die replaced by wild
  /** Present (true) only on a Critical Failure. Then success is false and raises 0. */
  criticalFailure?: boolean;
  /** Present (true) only when a trait roll without a Wild Die might be a Critical Failure. */
  possibleCriticalFailure?: boolean;
  criticalFailureReason?: string;  // Explanation of why it's a critical failure
}

/**
 * Savage Worlds roll modes
 */
export type SavageRollMode = "TRAIT" | "DAMAGE" | "STANDARD";

/**
 * Complete Savage Worlds roll result
 */
export interface SavageRollResult {
  mode: SavageRollMode;
  
  // All the die chains (regular dice + wild die if present)
  dieChains: DieChain[];
  
  // The actual results/outcomes
  // For TRAIT mode with multiple dice: array of independent test results
  // For TRAIT mode with single die: single result (best of trait vs wild)
  // For DAMAGE mode: single result (sum of all dice)
  outcomes: RollOutcome[];
  
  // Roll configuration (the settings the outcomes were calculated with)
  targetNumber: number;
  /** The modifier applied to every outcome: trait modifier, damage modifier, or 0 for STANDARD. */
  modifier: number;
  wildDieEnabled: boolean;
  
  // Completion status
  isComplete: boolean;
  
  // Timestamp
  timestamp: number;
}

/**
 * Represents the result of a single die that can explode
 */
export interface ExplosionResult {
  dieId: string;
  dieType: DiceType;
  rolls: number[];  // Array of individual rolls in explosion chain
  total: number;
  exploded: boolean;
  isWildDie: boolean;
}

/**
 * A finished result as the dice store keeps it: the result plus its identity. `rollId` and `hidden`
 * are local fields; they are not part of the broadcast `result` (see `src/plugin/rollWire.ts`).
 */
export interface StoredRollResult extends SavageRollResult {
  /** Unique per finished roll, the same for every revision (post-roll edit). */
  rollId: string;
  /** The roll was hidden (private) when it finished: it is never sent or stored. */
  hidden: boolean;
}
