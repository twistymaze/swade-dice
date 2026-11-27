/**
 * The cross-client data of the app: the roll broadcast and the per-player history in player
 * metadata. One validating parser for both (C-01, B-07, C-05, C-06, C-11, C-12, D-09).
 *
 * Rules:
 * - Never trust received data. Read only known own keys, check every type and range, build new
 *   objects (no spread of input, so no prototype keys), drop what does not pass.
 * - Sender identity (name, color, role) is NOT read from the payload: it comes from the OBR host
 *   (`event.connectionId` resolved through `OBR.party`, C-02). The `player`/`playerId` block is still
 *   SENT so that clients on an older version (which read it) keep working.
 * - Payload version `v` (new, optional). Missing = a client before this change (legacy, "v0"): its
 *   roll id is derived from the result timestamp. `v >= 1` is read with the v1 rules: a later version
 *   must stay a superset of v1. Anything else is dropped.
 */
import { DiceType } from "../types/DiceType";
import { DieChain, RollOutcome, SavageRollMode, SavageRollResult } from "../types/SavageWorldsTypes";
import { getMaxValueForDie, MAX_EXPLOSIONS } from "../helpers/explosionHelpers";
import { computeRollResult } from "../rules/outcomes";
import { getPluginId } from "./getPluginId";

export const ROLL_CHANNEL = getPluginId("roll-result");
/** Player metadata key: this player's last completed, not hidden rolls (OD-2). */
export const HISTORY_METADATA_KEY = getPluginId("history");
export const PAYLOAD_VERSION = 1;
export const HISTORY_METADATA_VERSION = 1;
/** Rolls kept per player in player metadata (OD-2). */
export const HISTORY_PER_PLAYER = 10;

/** Broadcast limit is 16 kB per message (owlbear-platform.md 8); keep a margin. */
export const BROADCAST_MAX_BYTES = 16000;

export const LIMITS = {
  /** Die chains in a result, also outcomes and chains per outcome (40 dice + Wild Die fit). */
  maxChains: 50,
  /** Rolls in one chain: the first roll plus at most MAX_EXPLOSIONS explosions. */
  maxRollsPerChain: MAX_EXPLOSIONS + 1,
  /** Rolls over all chains of a result. */
  maxTotalRolls: 300,
  maxAbsModifier: 99,
  minTargetNumber: 1,
  maxTargetNumber: 99,
  maxAbsTotal: 100000,
  maxRaises: 10000,
  maxRev: 1000000,
  maxReasonLength: 200,
  /** Exclusive upper bound of a timestamp (max Date value). */
  maxTimestamp: 8.64e15,
} as const;

const DICE_TYPES: readonly DiceType[] = ["D4", "D6", "D8", "D10", "D12"];
const MODES: readonly SavageRollMode[] = ["TRAIT", "DAMAGE", "STANDARD"];
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const FALLBACK_COLOR = "#888888";
export const MAX_NAME_LENGTH = 64;

/** The `player` block that older clients read from the payload (golden format). */
export interface LegacyPlayerBlock {
  id: string;
  connectionId: string;
  name: string;
  color: string;
  role: "GM" | "PLAYER";
  syncView: boolean;
  metadata: Record<string, never>;
}

/** What `DiceRollSync` sends. Superset of the golden `{ playerId, player, result }`. */
export interface RollBroadcastV1 {
  v: typeof PAYLOAD_VERSION;
  /** Unique per roll; the same for every revision of the roll. */
  rollId: string;
  /** +1 per revision (post-roll edit, OD-1). Receivers keep the highest. */
  rev: number;
  /** The sender's connection id (legacy readers key on it). */
  playerId: string;
  player: LegacyPlayerBlock;
  result: SavageRollResult;
}

/** A received roll after validation. */
export interface ParsedRoll {
  /** 0 = legacy payload without `v`. */
  version: number;
  rollId: string;
  rev: number;
  result: SavageRollResult;
}

/** One roll in the player metadata history (compact: outcomes are recomputed on read). */
export interface HistoryRecordV1 {
  id: string;
  rev: number;
  /** Result timestamp (display only). */
  t: number;
  m: SavageRollMode;
  tn: number;
  mod: number;
  /** Wild Die on: 1, off: 0. */
  w: 0 | 1;
  /** Chains: `[dieType, isWildDie (0|1), ...rolls]`. */
  c: (string | number)[][];
}

export interface HistoryMetadataV1 {
  v: typeof HISTORY_METADATA_VERSION;
  rolls: HistoryRecordV1[];
}

// ---------------------------------------------------------------- small readers

type Rec = Record<string, unknown>;

/** A plain data object (JSON object or `Object.create(null)`), not an array or class instance. */
function isRecord(value: unknown): value is Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Own property only (never inherited, so `__proto__`/`constructor` tricks read nothing). */
function own(o: Rec, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isDiceType(value: unknown): value is DiceType {
  return typeof value === "string" && (DICE_TYPES as readonly string[]).includes(value);
}

function isMode(value: unknown): value is SavageRollMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

function optionalBool(o: Rec, key: string): boolean | undefined | null {
  const v = own(o, key);
  if (v === undefined) return undefined;
  return typeof v === "boolean" ? v : null;
}

/** A player color for display: `#rrggbb` only, else a neutral gray (C-03). */
export function safeColor(value: unknown): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : FALLBACK_COLOR;
}

/** White or black text for a color background (non-hex values: the neutral fallback color). */
export function contrastTextColor(color: unknown): "black" | "white" {
  const hex = safeColor(color).slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "black" : "white";
}

/** A player name for display: a string, at most 64 characters (C-07). */
export function safeName(value: unknown): string {
  if (typeof value !== "string") return "Unknown";
  const chars = Array.from(value);
  return chars.length > MAX_NAME_LENGTH ? `${chars.slice(0, MAX_NAME_LENGTH - 1).join("")}…` : value;
}

export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

// ---------------------------------------------------------------- result parser

function parseRolls(value: unknown, dieType: DiceType): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.maxRollsPerChain) return null;
  const max = getMaxValueForDie(dieType);
  const rolls: number[] = [];
  for (const roll of value) {
    if (!isInt(roll, 1, max)) return null;
    rolls.push(roll);
  }
  return rolls;
}

function parseChain(value: unknown): DieChain | null {
  if (!isRecord(value)) return null;
  const dieId = own(value, "dieId");
  const dieType = own(value, "dieType");
  if (typeof dieId !== "string" || !ID_PATTERN.test(dieId) || !isDiceType(dieType)) return null;
  const rolls = parseRolls(own(value, "rolls"), dieType);
  if (!rolls) return null;
  const total = own(value, "total");
  const sum = rolls.reduce((a, b) => a + b, 0);
  if (total !== sum) return null;
  const isWildDie = optionalBool(value, "isWildDie");
  if (isWildDie === null) return null;
  return { dieId, dieType, rolls, total: sum, isWildDie: isWildDie ?? false };
}

function parseChains(value: unknown, min: number): DieChain[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > LIMITS.maxChains) return null;
  const chains: DieChain[] = [];
  for (const raw of value) {
    const chain = parseChain(raw);
    if (!chain) return null;
    chains.push(chain);
  }
  return chains;
}

function parseOutcome(value: unknown): RollOutcome | null {
  if (!isRecord(value)) return null;
  const chains = parseChains(own(value, "chains"), 1);
  const modifier = own(value, "modifier");
  const total = own(value, "total");
  if (!chains) return null;
  if (!isInt(modifier, -LIMITS.maxAbsModifier, LIMITS.maxAbsModifier)) return null;
  if (!isInt(total, -LIMITS.maxAbsTotal, LIMITS.maxAbsTotal)) return null;
  const replacedByWild = optionalBool(value, "replacedByWild");
  const success = optionalBool(value, "success");
  const criticalFailure = optionalBool(value, "criticalFailure");
  const possibleCriticalFailure = optionalBool(value, "possibleCriticalFailure");
  if (replacedByWild === null || success === null || criticalFailure === null || possibleCriticalFailure === null) {
    return null;
  }
  const raises = own(value, "raises");
  if (raises !== undefined && !isInt(raises, 0, LIMITS.maxRaises)) return null;
  const reason = own(value, "criticalFailureReason");
  if (reason !== undefined && (typeof reason !== "string" || reason.length > LIMITS.maxReasonLength)) return null;

  const outcome: RollOutcome = { chains, modifier, total, replacedByWild: replacedByWild ?? false };
  if (success !== undefined) outcome.success = success;
  if (raises !== undefined) outcome.raises = raises;
  if (criticalFailure !== undefined) outcome.criticalFailure = criticalFailure;
  if (possibleCriticalFailure !== undefined) outcome.possibleCriticalFailure = possibleCriticalFailure;
  if (reason !== undefined) outcome.criticalFailureReason = reason;
  return outcome;
}

/**
 * Validate a received `SavageRollResult` (broadcast `result`). Returns a new object or `null`.
 * Fields that old senders may omit get defaults: `targetNumber` 4, `modifier` 0,
 * `wildDieEnabled` false (crit then shows as "possible" only), `isWildDie`/`replacedByWild` false.
 */
export function parseRollResult(value: unknown): SavageRollResult | null {
  if (!isRecord(value)) return null;
  const mode = own(value, "mode");
  if (!isMode(mode) || own(value, "isComplete") !== true) return null;
  const timestamp = own(value, "timestamp");
  if (!isInt(timestamp, 1, LIMITS.maxTimestamp - 1)) return null;
  const dieChains = parseChains(own(value, "dieChains"), 1);
  if (!dieChains) return null;
  if (dieChains.reduce((n, c) => n + c.rolls.length, 0) > LIMITS.maxTotalRolls) return null;
  const rawOutcomes = own(value, "outcomes");
  if (!Array.isArray(rawOutcomes) || rawOutcomes.length < 1 || rawOutcomes.length > LIMITS.maxChains) return null;
  const outcomes: RollOutcome[] = [];
  for (const raw of rawOutcomes) {
    const outcome = parseOutcome(raw);
    if (!outcome) return null;
    outcomes.push(outcome);
  }

  const targetNumber = own(value, "targetNumber");
  const modifier = own(value, "modifier");
  const wildDieEnabled = optionalBool(value, "wildDieEnabled");
  if (targetNumber !== undefined && !isInt(targetNumber, LIMITS.minTargetNumber, LIMITS.maxTargetNumber)) return null;
  if (modifier !== undefined && !isInt(modifier, -LIMITS.maxAbsModifier, LIMITS.maxAbsModifier)) return null;
  if (wildDieEnabled === null) return null;

  return {
    mode,
    dieChains,
    outcomes,
    targetNumber: targetNumber ?? 4,
    modifier: modifier ?? 0,
    wildDieEnabled: wildDieEnabled ?? false,
    isComplete: true,
    timestamp,
  };
}

// ---------------------------------------------------------------- broadcast

/**
 * Validate a broadcast `event.data`. Returns `null` for anything that is not a complete, valid roll.
 * The `player`/`playerId` block is ignored (identity comes from `event.connectionId`).
 */
export function parseRollBroadcast(data: unknown): ParsedRoll | null {
  if (!isRecord(data)) return null;
  const result = parseRollResult(own(data, "result"));
  if (!result) return null;

  const v = own(data, "v");
  if (v === undefined) {
    // Legacy sender: every revision of a roll keeps the result timestamp (golden format).
    return { version: 0, rollId: `t${result.timestamp}`, rev: 0, result };
  }
  if (!isInt(v, 1, 1000)) return null;
  const rollId = own(data, "rollId");
  const rev = own(data, "rev");
  if (typeof rollId !== "string" || !ID_PATTERN.test(rollId) || !isInt(rev, 0, LIMITS.maxRev)) return null;
  return { version: v, rollId, rev, result };
}

/** Only the golden result keys, in a fixed order (no internal fields such as `rollId`/`hidden`). */
function wireResult(result: SavageRollResult): SavageRollResult {
  return {
    mode: result.mode,
    dieChains: result.dieChains,
    outcomes: result.outcomes,
    targetNumber: result.targetNumber,
    modifier: result.modifier,
    isComplete: result.isComplete,
    timestamp: result.timestamp,
    wildDieEnabled: result.wildDieEnabled,
  };
}

export interface SenderInfo {
  id: string;
  connectionId: string;
  name: string;
  color: string;
  role: "GM" | "PLAYER";
}

export function buildRollBroadcast(
  rollId: string,
  rev: number,
  result: SavageRollResult,
  sender: SenderInfo
): RollBroadcastV1 {
  return {
    v: PAYLOAD_VERSION,
    rollId,
    rev,
    playerId: sender.connectionId,
    player: {
      id: sender.id,
      connectionId: sender.connectionId,
      name: sender.name,
      color: sender.color,
      role: sender.role,
      syncView: false,
      metadata: {},
    },
    result: wireResult(result),
  };
}

// ---------------------------------------------------------------- player metadata history

export interface HistoryItem {
  rollId: string;
  rev: number;
  result: SavageRollResult;
}

export function encodeHistoryRecord({ rollId, rev, result }: HistoryItem): HistoryRecordV1 {
  return {
    id: rollId,
    rev,
    t: result.timestamp,
    m: result.mode,
    tn: result.targetNumber,
    mod: result.modifier,
    w: result.wildDieEnabled ? 1 : 0,
    c: result.dieChains.map((chain) => [chain.dieType, chain.isWildDie ? 1 : 0, ...chain.rolls]),
  };
}

export function encodeHistory(items: HistoryItem[]): HistoryMetadataV1 {
  return { v: HISTORY_METADATA_VERSION, rolls: items.slice(-HISTORY_PER_PLAYER).map(encodeHistoryRecord) };
}

function parseCompactChain(value: unknown, index: number): DieChain | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [dieType, wild, ...rest] = value as unknown[];
  if (!isDiceType(dieType) || (wild !== 0 && wild !== 1)) return null;
  const rolls = parseRolls(rest, dieType);
  if (!rolls) return null;
  return {
    dieId: String(index + 1),
    dieType,
    rolls,
    total: rolls.reduce((a, b) => a + b, 0),
    isWildDie: wild === 1,
  };
}

function parseHistoryRecord(value: unknown): ParsedRoll | null {
  if (!isRecord(value)) return null;
  const id = own(value, "id");
  const rev = own(value, "rev");
  const t = own(value, "t");
  const m = own(value, "m");
  const tn = own(value, "tn");
  const mod = own(value, "mod");
  const w = own(value, "w");
  const c = own(value, "c");
  if (typeof id !== "string" || !ID_PATTERN.test(id) || !isInt(rev, 0, LIMITS.maxRev)) return null;
  if (!isInt(t, 1, LIMITS.maxTimestamp - 1) || !isMode(m)) return null;
  if (!isInt(tn, LIMITS.minTargetNumber, LIMITS.maxTargetNumber)) return null;
  if (!isInt(mod, -LIMITS.maxAbsModifier, LIMITS.maxAbsModifier) || (w !== 0 && w !== 1)) return null;
  if (!Array.isArray(c) || c.length < 1 || c.length > LIMITS.maxChains) return null;
  const dieChains: DieChain[] = [];
  for (let i = 0; i < c.length; i++) {
    const chain = parseCompactChain(c[i], i);
    if (!chain) return null;
    dieChains.push(chain);
  }
  if (dieChains.reduce((n, chain) => n + chain.rolls.length, 0) > LIMITS.maxTotalRolls) return null;
  // Outcomes are recomputed with the one rules engine: stored data cannot carry wrong totals.
  const result = computeRollResult(
    { mode: m, dieChains, timestamp: t, isComplete: true },
    { targetNumber: tn, traitModifier: mod, damageModifier: mod, wildDieEnabled: w === 1 }
  );
  return { version: HISTORY_METADATA_VERSION, rollId: id, rev, result };
}

/**
 * Validate one player's history metadata value. Invalid records are dropped one by one; at most the
 * last `HISTORY_PER_PLAYER` records are read. Missing or unknown shapes give `[]`.
 */
export function parseHistoryMetadata(value: unknown): { rolls: ParsedRoll[]; invalid: number } {
  if (value === undefined) return { rolls: [], invalid: 0 };
  if (!isRecord(value) || !isInt(own(value, "v"), 1, 1000)) return { rolls: [], invalid: 1 };
  const raw = own(value, "rolls");
  if (!Array.isArray(raw)) return { rolls: [], invalid: 1 };
  const rolls: ParsedRoll[] = [];
  let invalid = 0;
  for (const record of raw.slice(-HISTORY_PER_PLAYER)) {
    const parsed = parseHistoryRecord(record);
    if (parsed) rolls.push(parsed);
    else invalid++;
  }
  return { rolls, invalid };
}

// ---------------------------------------------------------------- warn once

const warned = new Set<string>();

/** `console.warn` once per source and sender connection, so a flood does not flood the console. */
export function warnInvalidOnce(source: "broadcast" | "metadata", connectionId: string, detail?: unknown) {
  const key = `${source}:${connectionId}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[savage-worlds-dice] dropped an invalid ${source} from connection ${connectionId}`, detail);
}

/** Test helper. */
export function resetInvalidWarnings() {
  warned.clear();
}
