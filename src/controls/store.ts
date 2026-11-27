import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { diceSets } from "../sets/diceSets";
import { Dice } from "../types/Dice";
import { DiceSet } from "../types/DiceSet";
import { Die } from "../types/Die";
import { generateDiceId } from "../helpers/generateDiceId";
import { createWildDie } from "../helpers/wildDie";

export type DiceCounts = Record<string, number>;
type RollModeSelection = 'AUTO' | 'TRAIT' | 'DAMAGE' | 'STANDARD';

interface DiceControlsState {
  diceSet: DiceSet;
  diceById: Record<string, Die>;
  defaultDiceCounts: DiceCounts;
  diceCounts: DiceCounts;
  diceHidden: boolean;
  diceRollPressTime: number | null;
  fairnessTesterOpen: boolean;
  // Savage Worlds specific state
  wildDieEnabled: boolean;
  targetNumber: number;
  traitModifier: number;   // Modifier for trait tests
  damageModifier: number;  // Modifier for damage rolls
  modeChoice: RollModeSelection;  // User's mode selection (AUTO, TRAIT, or DAMAGE)
  /** Derived from `modeChoice` and `diceCounts` (computeRollMode); set only by `setDerived`. */
  rollMode: 'TRAIT' | 'DAMAGE' | 'STANDARD';
  // Results display state
  resultsDetailsHovered: boolean;
  // Actions
  changeDiceSet: (diceSet: DiceSet) => void;
  resetDiceCounts: (preserveMode?: boolean) => void;
  changeDieCount: (id: string, count: number) => void;
  incrementDieCount: (id: string) => void;
  decrementDieCount: (id: string) => void;
  setTraitModifier: (modifier: number) => void;
  setDamageModifier: (modifier: number) => void;
  toggleDiceHidden: () => void;
  setDiceRollPressTime: (time: number | null) => void;
  toggleFairnessTester: () => void;
  // Savage Worlds specific actions
  toggleWildDie: () => void;
  setTargetNumber: (tn: number) => void;
  setModeChoice: (mode: RollModeSelection) => void;
  // Results display actions
  setResultsDetailsHovered: (hovered: boolean) => void;
}

// Load dice set from localStorage or use default
const loadDiceSet = () => {
  try {
    const savedSetId = localStorage.getItem('swade-diceSetId');
    if (savedSetId) {
      const savedSet = diceSets.find(set => set.id === savedSetId);
      // Return saved set if valid and not Nebula (reserved for wild die)
      if (savedSet && savedSet.id !== "NEBULA_STANDARD" && savedSet.id !== "all") {
        return savedSet;
      }
    }
  } catch {
  }
  
  // Default: first valid set (not Nebula or "all")
  return diceSets.find(set => 
    set.id !== "NEBULA_STANDARD" && set.id !== "all"
  ) || diceSets[0];
};

const initialSet = loadDiceSet();
const initialDiceCounts = getDiceCountsFromSet(initialSet);
const initialDiceById = getDiceByIdFromSet(initialSet);

// Helper to compute actual roll mode
export function computeRollMode(modeChoice: RollModeSelection, counts: DiceCounts): 'TRAIT' | 'DAMAGE' | 'STANDARD' {
  // If explicitly chosen, always use that mode regardless of dice count
  if (modeChoice === 'TRAIT') return 'TRAIT';
  if (modeChoice === 'DAMAGE') return 'DAMAGE';
  if (modeChoice === 'STANDARD') return 'STANDARD';
  
  // Auto mode: determine based on dice count
  const totalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return totalCount === 1 ? 'TRAIT' : 'DAMAGE';
}

/**
 * At most this many dice in one roll (plus the Wild Die), so every roll fits the 16 kB broadcast and
 * the receivers' limits (B-08, `src/plugin/rollWire.ts` LIMITS).
 */
export const MAX_DICE_PER_ROLL = 40;
/** Modifiers are clamped to the range the receivers accept (B-08). */
export const MAX_ABS_MODIFIER = 99;
const clampModifier = (m: number) =>
  Number.isFinite(m) ? Math.max(-MAX_ABS_MODIFIER, Math.min(MAX_ABS_MODIFIER, Math.trunc(m))) : 0;
const totalDice = (counts: DiceCounts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

export const DEFAULT_TARGET_NUMBER = 4;
export const MIN_TARGET_NUMBER = 1;
export const MAX_TARGET_NUMBER = 99;

/**
 * A valid target number: an integer in 1..99. Not a finite number -> the default 4 (A-11, C-08).
 * Strings are parsed like `parseInt` ("7.9" -> 7, " 8" -> 8, "abc" -> 4).
 */
export function parseTargetNumber(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? Math.trunc(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_TARGET_NUMBER;
  return Math.max(MIN_TARGET_NUMBER, Math.min(MAX_TARGET_NUMBER, n));
}

/** Only the string "true" turns the Wild Die on; no value means the default (on). */
export function parseWildDieEnabled(value: string | null): boolean {
  return value !== null ? value === 'true' : true;
}

// Load Savage Worlds settings from localStorage
const loadSavageWorldsSettings = () => {
  try {
    return {
      wildDieEnabled: parseWildDieEnabled(localStorage.getItem('swade-wildDieEnabled')),
      targetNumber: parseTargetNumber(localStorage.getItem('swade-targetNumber') ?? DEFAULT_TARGET_NUMBER),
    };
  } catch {
    return { wildDieEnabled: true, targetNumber: DEFAULT_TARGET_NUMBER };
  }
};

const { wildDieEnabled: initialWildDie, targetNumber: initialTN } = loadSavageWorldsSettings();


export const useDiceControlsStore = create<DiceControlsState>()(
  immer((set, _get) => {
    /** Every change of counts or mode choice goes through here, so `rollMode` stays derived (D-08). */
    const setDerived = (fn: (state: DiceControlsState) => void) =>
      set((state) => {
        fn(state);
        state.rollMode = computeRollMode(state.modeChoice, state.diceCounts);
      });
    return {
    diceSet: initialSet,
    diceById: initialDiceById,
    defaultDiceCounts: initialDiceCounts,
    diceCounts: initialDiceCounts,
    diceHidden: false,
    diceRollPressTime: null,
    fairnessTesterOpen: false,
    wildDieEnabled: initialWildDie,
    targetNumber: initialTN,
    traitModifier: 0,   // Always start at 0 - modifiers are ephemeral
    damageModifier: 0,  // Always start at 0 - modifiers are ephemeral
    modeChoice: 'AUTO',   // Default to AUTO mode
    rollMode: computeRollMode('AUTO', initialDiceCounts),  // Computed from modeChoice and counts
    resultsDetailsHovered: false,
    changeDiceSet(diceSet) {
      setDerived((state) => {
        const counts: DiceCounts = {};
        const prevCounts = state.diceCounts;
        const prevDice = state.diceSet.dice;
        for (let i = 0; i < diceSet.dice.length; i++) {
          const die = diceSet.dice[i];
          const prevDie = prevDice[i];
          // Carry over count if the index and die type match
          if (prevDie && prevDie.type === die.type) {
            counts[die.id] = prevCounts[prevDie.id] || 0;
          } else {
            counts[die.id] = 0;
          }
        }
        state.diceCounts = counts;
        state.diceSet = diceSet;
        state.defaultDiceCounts = getDiceCountsFromSet(diceSet);
        state.diceById = getDiceByIdFromSet(diceSet);
      });
      
      // Save dice set selection to localStorage
      try {
        localStorage.setItem('swade-diceSetId', diceSet.id);
      } catch {
      }
    },
    resetDiceCounts(preserveMode?: boolean) {
      setDerived((state) => {
        state.diceCounts = state.defaultDiceCounts;
        if (!preserveMode) {
          // Reset to AUTO when not preserving
          state.modeChoice = 'AUTO';
        }
      });
    },
    changeDieCount(id, count) {
      setDerived((state) => {
        if (id in state.diceCounts) {
          const others = totalDice(state.diceCounts) - state.diceCounts[id];
          state.diceCounts[id] = Math.max(0, Math.min(count, MAX_DICE_PER_ROLL - others));
        }
      });
    },
    incrementDieCount(id) {
      setDerived((state) => {
        if (id in state.diceCounts && totalDice(state.diceCounts) < MAX_DICE_PER_ROLL) {
          state.diceCounts[id] += 1;
        }
      });
    },
    decrementDieCount(id) {
      setDerived((state) => {
        if (id in state.diceCounts && state.diceCounts[id] > 0) {
          state.diceCounts[id] -= 1;
        }
      });
    },
    setTraitModifier(modifier) {
      set((state) => {
        state.traitModifier = clampModifier(modifier);
      });
      // Don't save to localStorage - modifiers are ephemeral in SWADE
    },
    setDamageModifier(modifier) {
      set((state) => {
        state.damageModifier = clampModifier(modifier);
      });
      // Don't save to localStorage - modifiers are ephemeral in SWADE
    },
    toggleDiceHidden() {
      set((state) => {
        state.diceHidden = !state.diceHidden;
      });
    },
    setDiceRollPressTime(time) {
      set((state) => {
        state.diceRollPressTime = time;
      });
    },
    toggleFairnessTester() {
      set((state) => {
        state.fairnessTesterOpen = !state.fairnessTesterOpen;
      });
    },
    toggleWildDie() {
      set((state) => {
        state.wildDieEnabled = !state.wildDieEnabled;
        // Persist to localStorage
        try {
          localStorage.setItem('swade-wildDieEnabled', state.wildDieEnabled.toString());
        } catch {}
      });
    },
    setTargetNumber(tn) {
      set((state) => {
        // Integer in 1..99; NaN gives the default
        state.targetNumber = parseTargetNumber(tn);
        // Persist to localStorage
        try {
          localStorage.setItem('swade-targetNumber', state.targetNumber.toString());
        } catch {}
      });
    },
    setResultsDetailsHovered(hovered) {
      set((state) => {
        state.resultsDetailsHovered = hovered;
      });
    },
    setModeChoice(mode) {
      setDerived((state) => {
        state.modeChoice = mode;
        // Don't persist - mode selection is ephemeral within a session
      });
    },
  };
  })
);

function getDiceCountsFromSet(diceSet: DiceSet) {
  const counts: Record<string, number> = {};
  for (const die of diceSet.dice) {
    counts[die.id] = 0;
  }
  return counts;
}

function getDiceByIdFromSet(diceSet: DiceSet) {
  const byId: Record<string, Die> = {};
  for (const die of diceSet.dice) {
    byId[die.id] = die;
  }
  return byId;
}

/** Generate new dice based off of a set of counts and die */
export function getDiceToRoll(
  counts: DiceCounts,
  diceById: Record<string, Die>,
  wildDieEnabled?: boolean,
  _diceStyle?: string,
  isTraitMode?: boolean
) {
  const dice: (Die | Dice)[] = [];
  const countEntries = Object.entries(counts);
  
  // Add regular dice
  for (const [id, count] of countEntries) {
    const die = diceById[id];
    if (!die) {
      continue;
    }
    const { style, type } = die;
    for (let i = 0; i < count; i++) {
      dice.push({ id: generateDiceId(), style, type });
    }
  }
  
  // Add wild die if in trait mode, wild die is enabled, AND there are regular dice
  if (isTraitMode && wildDieEnabled && dice.length > 0) {
    dice.push(createWildDie());
  }
  
  return dice;
}
