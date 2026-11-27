/**
 * The one SWADE outcome engine (pure, no React, no stores).
 *
 * Used by the dice store at completion, by `useSavageWorldsResults` (live recalculation after a
 * post-roll edit of TN, modifier or Wild Die), and therefore by the history and the broadcast.
 * Rules: `.review/swade-rules.md` (SWADE core, Trait Rolls, Raises, The Wild Die, Critical Failures,
 * Damage).
 */
import { DieChain, RollOutcome, SavageRollMode, SavageRollResult } from "../types/SavageWorldsTypes";

/** The settings that a result is calculated with. The controls store has these four fields. */
export interface RollSettings {
  targetNumber: number;
  traitModifier: number;
  damageModifier: number;
  wildDieEnabled: boolean;
}

export const DEFAULT_ROLL_SETTINGS: RollSettings = {
  targetNumber: 4,
  traitModifier: 0,
  damageModifier: 0,
  wildDieEnabled: true,
};

export type CriticalFailureStatus = {
  isCritical: boolean;
  isPossible: boolean;
  reason?: string;
};

const NO_CRIT: CriticalFailureStatus = { isCritical: false, isPossible: false };

/** The modifier that applies to a mode. STANDARD rolls are raw values with no modifier (A-03). */
export function modifierForMode(mode: SavageRollMode, settings: Pick<RollSettings, "traitModifier" | "damageModifier">): number {
  if (mode === "TRAIT") return settings.traitModifier;
  if (mode === "DAMAGE") return settings.damageModifier;
  return 0;
}

/** Raises: every full 4 points over the TN, after modifiers. 0 on a failure. */
export function countRaises(total: number, targetNumber: number): number {
  return total >= targetNumber ? Math.floor((total - targetNumber) / 4) : 0;
}

/** SWADE "more than half" (not "half or more"). */
export function isMoreThanHalf(count: number, of: number): boolean {
  return count > of / 2;
}

function isNaturalOne(chain: DieChain): boolean {
  return chain.rolls[0] === 1;
}

/**
 * Critical Failure status of a trait roll (book rule, OD-4).
 * - With a Wild Die: critical when the Wild Die is a natural 1 AND more than half of all dice
 *   (Wild Die included) are natural 1s. For one trait die this is "1 on both".
 * - Without a Wild Die (Extras, or Wild Die off): "possible" when the roll would be critical if a
 *   Wild Die had rolled 1. It is only a hint: the GM rolls a d6 for an Extra when it matters.
 * - DAMAGE and STANDARD rolls never have a Critical Failure.
 * Modifiers never matter: natural 1s only.
 */
export function getCriticalFailureStatusForChains(
  mode: SavageRollMode,
  dieChains: DieChain[],
  wildDieEnabled: boolean | undefined
): CriticalFailureStatus {
  if (mode !== "TRAIT") return NO_CRIT;
  const regularChains = dieChains.filter((c) => !c.isWildDie);
  if (regularChains.length === 0) return NO_CRIT;
  const wildChain = dieChains.find((c) => c.isWildDie);
  const traitOnes = regularChains.filter(isNaturalOne).length;
  const diceCount = regularChains.length + 1;

  if (wildDieEnabled && wildChain) {
    const wildIsOne = isNaturalOne(wildChain);
    const ones = traitOnes + (wildIsOne ? 1 : 0);
    if (wildIsOne && isMoreThanHalf(ones, diceCount)) {
      return {
        isCritical: true,
        isPossible: false,
        reason:
          regularChains.length === 1
            ? "Both trait and wild die rolled 1"
            : `${ones} of ${diceCount} dice rolled 1, including the wild die`,
      };
    }
    return NO_CRIT;
  }

  if (isMoreThanHalf(traitOnes + 1, diceCount)) {
    return {
      isCritical: false,
      isPossible: true,
      reason:
        regularChains.length === 1
          ? "Trait die rolled 1 (no wild die)"
          : `${traitOnes} of ${regularChains.length} dice rolled 1 (no wild die)`,
    };
  }
  return NO_CRIT;
}

function sumChains(chains: DieChain[]): number {
  return chains.reduce((sum, chain) => sum + chain.total, 0);
}

function traitOutcome(chain: DieChain, modifier: number, targetNumber: number, replacedByWild: boolean): RollOutcome {
  const total = chain.total + modifier;
  const success = total >= targetNumber;
  return {
    chains: [chain],
    modifier,
    total,
    replacedByWild,
    success,
    raises: countRaises(total, targetNumber),
  };
}

/**
 * Calculate the outcomes of a finished roll.
 * - TRAIT: one outcome per trait die. When the Wild Die is on and its chain exists, it replaces the
 *   worst trait die if it is strictly higher (the first worst on a tie). Every outcome has
 *   `success` and `raises`. A Critical Failure makes every outcome a failure with 0 raises.
 * - DAMAGE: one outcome, all chains summed plus the damage modifier. No `success`/`raises` (OD-5).
 * - STANDARD: one outcome per chain, raw value, modifier 0.
 */
export function computeOutcomes(
  mode: SavageRollMode,
  dieChains: DieChain[],
  settings: RollSettings
): RollOutcome[] {
  const modifier = modifierForMode(mode, settings);

  if (mode === "STANDARD") {
    return dieChains.map((chain) => ({
      chains: [chain],
      modifier: 0,
      total: chain.total,
      replacedByWild: false,
    }));
  }

  if (mode === "DAMAGE") {
    return [
      {
        chains: dieChains,
        modifier,
        total: sumChains(dieChains) + modifier,
        replacedByWild: false,
      },
    ];
  }

  const { targetNumber, wildDieEnabled } = settings;
  const regularChains = dieChains.filter((c) => !c.isWildDie);
  const wildChain = dieChains.find((c) => c.isWildDie);
  const outcomes = regularChains.map((chain) => traitOutcome(chain, modifier, targetNumber, false));

  if (wildDieEnabled && wildChain && outcomes.length > 0) {
    let worstIndex = 0;
    for (let i = 1; i < outcomes.length; i++) {
      if (outcomes[i].total < outcomes[worstIndex].total) worstIndex = i;
    }
    if (wildChain.total + modifier > outcomes[worstIndex].total) {
      outcomes[worstIndex] = traitOutcome(wildChain, modifier, targetNumber, true);
    }
  }

  const crit = getCriticalFailureStatusForChains(mode, dieChains, wildDieEnabled);
  if (crit.isCritical) {
    return outcomes.map((o) => ({
      ...o,
      success: false,
      raises: 0,
      criticalFailure: true,
      criticalFailureReason: crit.reason,
    }));
  }
  if (crit.isPossible) {
    return outcomes.map((o) => ({
      ...o,
      possibleCriticalFailure: true,
      criticalFailureReason: crit.reason,
    }));
  }
  return outcomes;
}

/** The part of a result that does not depend on the settings. */
export type RollResultBase = Pick<SavageRollResult, "mode" | "dieChains" | "timestamp" | "isComplete">;

/**
 * Build the full result (all fields recalculated) from the die chains and the current settings.
 * Calling it again after a TN, modifier or Wild Die change recalculates every field (OD-1).
 */
export function computeRollResult(base: RollResultBase, settings: RollSettings): SavageRollResult {
  return {
    mode: base.mode,
    dieChains: base.dieChains,
    outcomes: computeOutcomes(base.mode, base.dieChains, settings),
    targetNumber: settings.targetNumber,
    modifier: modifierForMode(base.mode, settings),
    isComplete: base.isComplete,
    timestamp: base.timestamp,
    wildDieEnabled: settings.wildDieEnabled,
  };
}

/**
 * Crit status of an outcome for display. New payloads carry the fields on the outcome; old payloads
 * (from clients before the A-01 fix) do not, so the status is computed from the chains.
 */
export function getOutcomeCriticalStatus(result: SavageRollResult, outcomeIndex: number): CriticalFailureStatus {
  const outcome = result.outcomes[outcomeIndex];
  if (!outcome || result.mode !== "TRAIT") return NO_CRIT;
  const hasFields = result.outcomes.some(
    (o) => o.criticalFailure !== undefined || o.possibleCriticalFailure !== undefined
  );
  if (hasFields) {
    return {
      isCritical: outcome.criticalFailure === true,
      isPossible: outcome.criticalFailure !== true && outcome.possibleCriticalFailure === true,
      reason: outcome.criticalFailureReason,
    };
  }
  return getCriticalFailureStatusForChains(result.mode, result.dieChains, result.wildDieEnabled);
}
