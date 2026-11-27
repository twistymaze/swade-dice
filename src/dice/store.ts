import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import { DiceRoll } from "../types/DiceRoll";
import { Die } from "../types/Die";
import { getDieFromDice } from "../helpers/getDieFromDice";
import { DiceTransform } from "../types/DiceTransform";
import { getRandomDiceThrow } from "../helpers/DiceThrower";
import { generateDiceId } from "../helpers/generateDiceId";
import { createWildDie } from "../helpers/wildDie";
import { DiceThrow } from "../types/DiceThrow";
import { ExplosionResult, SavageRollMode, SavageRollResult } from "../types/SavageWorldsTypes";
import { shouldDieExplode, isValidFaceValue, MAX_EXPLOSIONS } from "../helpers/explosionHelpers";
import { computeRollResult, DEFAULT_ROLL_SETTINGS, RollSettings } from "../rules/outcomes";
import { updateExplosionResults, createExplosionDie, getParentDieId, createDieChains } from "./storeHelpers";

export type DieInfo = {
  die: Die;
  isWildDie: boolean;
  parentDieId?: string;
};

/** How to start a roll. The roll records its own mode and settings (D-05). */
export interface StartRollOptions {
  mode: SavageRollMode;
  speedMultiplier?: number;
  /** The settings the stored result is calculated with. The UI recalculates with live settings. */
  settings?: RollSettings;
}

export interface RerollOptions {
  /**
   * Whether the new roll has a Wild Die (TRAIT only). Pass the current setting, so a reroll after
   * the Wild Die was turned off throws no Wild Die (A-07). Default: as the old roll.
   */
  wildDieEnabled?: boolean;
  settings?: RollSettings;
}

export interface DiceRollState {
  roll: DiceRoll | null;
  /**
   * A mapping from the die ID to its roll result.
   * A value of `null` means the die hasn't finished rolling yet.
   * This is the source of roll progress: see `selectPendingDiceIds` and `selectIsRolling`.
   */
  rollValues: Record<string, number | null>;
  /**
   * A mapping from the die ID to its final roll transform.
   * A value of `null` means the die hasn't finished rolling yet.
   */
  rollTransforms: Record<string, DiceTransform | null>;
  /**
   * A mapping from the die ID to its initial roll throw state.
   */
  rollThrows: Record<string, DiceThrow>;
  /**
   * A mapping from die ID to die information for explosion tracking
   */
  dieInfo: Record<string, DieInfo>;
  /**
   * List of explosion dice that need to be spawned
   */
  explosionDice: Die[];
  /**
   * Dice that have finished rolling and should be immovable (the ids whose value is set).
   */
  finishedDice: string[];

  // Savage Worlds specific state
  /** The mode of the current roll (set by `startRoll`, kept by `reroll`, reset by `clearRoll`). */
  rollMode: SavageRollMode;
  /** The settings of the current roll, used for the stored result at completion. */
  rollSettings: RollSettings;
  /** The speed multiplier of the current roll, reused by `reroll`. */
  rollSpeedMultiplier: number;
  explosionResults: Record<string, ExplosionResult>;
  currentRollResult: SavageRollResult | null;

  // Actions
  startRoll: (roll: DiceRoll, options: StartRollOptions) => void;
  clearRoll: () => void;
  /** Roll the same dice again with new ids, in one synchronous update (A-06). */
  reroll: (options?: RerollOptions) => void;
  /**
   * Report the face value of a die that stopped. Returns `false` when the value is not a valid face
   * for the die (for example 0 when no face was found, A-08): nothing is stored and the die stays
   * pending, so the caller can read it again. Returns `true` otherwise, also when the id is unknown
   * (stale die) or the die already has a value (a second report is ignored, A-05).
   */
  checkAndProcessExplosion: (id: string, value: number, transform: DiceTransform) => boolean;
}

/** Ids of the dice that have not finished yet. */
export function selectPendingDiceIds(state: Pick<DiceRollState, "rollValues">): string[] {
  return Object.keys(state.rollValues).filter((id) => state.rollValues[id] === null);
}

/** True while at least one die of the current roll is still rolling. */
export function selectIsRolling(state: Pick<DiceRollState, "rollValues">): boolean {
  return Object.values(state.rollValues).some((value) => value === null);
}

const EMPTY_ROLL_STATE = {
  roll: null,
  rollValues: {},
  rollTransforms: {},
  rollThrows: {},
  dieInfo: {},
  explosionDice: [],
  finishedDice: [],
  rollMode: "TRAIT" as SavageRollMode,
  rollSettings: DEFAULT_ROLL_SETTINGS,
  rollSpeedMultiplier: 1,
  explosionResults: {},
  currentRollResult: null,
};

type RollDraft = Omit<DiceRollState, "startRoll" | "clearRoll" | "reroll" | "checkAndProcessExplosion">;

function resetRoll(draft: RollDraft) {
  Object.assign(draft, structuredClone(EMPTY_ROLL_STATE));
}

function initRoll(draft: RollDraft, roll: DiceRoll, options: StartRollOptions) {
  resetRoll(draft);
  draft.roll = roll;
  draft.rollMode = options.mode;
  draft.rollSettings = options.settings ?? DEFAULT_ROLL_SETTINGS;
  draft.rollSpeedMultiplier = options.speedMultiplier ?? 1;
  for (const die of getDieFromDice(roll)) {
    draft.rollValues[die.id] = null;
    draft.rollTransforms[die.id] = null;
    draft.rollThrows[die.id] = getRandomDiceThrow(options.speedMultiplier);
    draft.dieInfo[die.id] = { die, isWildDie: die.isWildDie === true };
  }
}

export const useDiceRollStore = create<DiceRollState>()(
  immer((set, get) => ({
    ...structuredClone(EMPTY_ROLL_STATE),

    startRoll: (roll, options) =>
      set((state) => {
        initRoll(state, roll, options);
      }),

    clearRoll: () =>
      set((state) => {
        resetRoll(state);
      }),

    reroll: (options) => {
      const { roll, rollMode, rollSettings, rollSpeedMultiplier } = get();
      if (!roll) return;
      const oldDice = getDieFromDice(roll);
      const hadWildDie = oldDice.some((die) => die.isWildDie);
      const traitDice = oldDice
        .filter((die) => !die.isWildDie)
        .map((die) => ({ ...die, id: generateDiceId() }));
      const withWildDie = rollMode === "TRAIT" && traitDice.length > 0 && (options?.wildDieEnabled ?? hadWildDie);
      const newRoll: DiceRoll = {
        ...roll,
        dice: withWildDie ? [...traitDice, createWildDie()] : traitDice,
      };
      set((state) => {
        initRoll(state, newRoll, {
          mode: rollMode,
          speedMultiplier: rollSpeedMultiplier,
          settings: options?.settings ?? rollSettings,
        });
      });
    },

    checkAndProcessExplosion: (id, value, transform) => {
      const state = get();
      const info = state.dieInfo[id];
      if (!info || state.rollValues[id] !== null) return true;
      if (!isValidFaceValue(value, info.die.type)) return false;

      set((draft) => {
        draft.rollValues[id] = value;
        draft.rollTransforms[id] = transform;
        if (!draft.finishedDice.includes(id)) draft.finishedDice.push(id);

        const parentDieId = getParentDieId(id);
        updateExplosionResults(draft.explosionResults, parentDieId, value, info.die.type, info.isWildDie);
        const chain = draft.explosionResults[parentDieId];
        const explosionCount = chain.rolls.length - 1;

        if (draft.rollMode !== "STANDARD" && shouldDieExplode(value, info.die.type) && explosionCount < MAX_EXPLOSIONS) {
          const explosion = createExplosionDie(parentDieId, explosionCount, info.die);
          chain.exploded = true;
          draft.explosionDice.push(explosion.die);
          draft.rollValues[explosion.die.id] = null;
          draft.rollTransforms[explosion.die.id] = null;
          draft.rollThrows[explosion.die.id] = explosion.throw;
          draft.dieInfo[explosion.die.id] = { die: explosion.die, isWildDie: info.isWildDie, parentDieId };
          return;
        }

        if (!selectIsRolling(draft)) {
          draft.currentRollResult = computeRollResult(
            {
              mode: draft.rollMode,
              dieChains: createDieChains(draft.explosionResults),
              isComplete: true,
              timestamp: Date.now(),
            },
            draft.rollSettings
          );
        }
      });
      return true;
    },
  }))
);

// Development only: expose the dice roll store for runtime inspection in the
// OBR iframe. Production builds remove this block.
if (import.meta.env.DEV) {
  (window as unknown as { __diceStore?: typeof useDiceRollStore }).__diceStore =
    useDiceRollStore;
}
