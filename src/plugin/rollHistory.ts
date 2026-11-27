/**
 * The party roll history (pure reducer, B-04, C-04, OD-2, OD-7).
 *
 * - Entry key: `<sender connectionId>:<rollId>`. Only the original connection can revise its entry.
 * - Order: by arrival in this client, never by the sender's clock. A revision keeps the position.
 * - A revision replaces the entry when its `rev` is not lower than the stored one (legacy payloads
 *   have no `rev` and replace by arrival). An older revision is ignored.
 * - The list keeps the newest `HISTORY_LIMIT` arrivals. Keys that dropped out are remembered, so a
 *   later copy (player metadata is read again on each party change) does not bring them back.
 * - Initial load from player metadata (no arrival order exists): sorted by the sender timestamp,
 *   clamped to the local clock, so a forged future timestamp cannot pin an entry at the end.
 * - Flood limit for live broadcasts: at most `FLOOD_MAX` new entries per connection in `FLOOD_WINDOW_MS`.
 * - Players who leave: their entries stay until newer arrivals push them out.
 */
import { SavageRollResult } from "../types/SavageWorldsTypes";
import { ParsedRoll } from "./rollWire";

export const HISTORY_LIMIT = 20;
export const FLOOD_MAX = 5;
export const FLOOD_WINDOW_MS = 10_000;
const SEEN_LIMIT = 1000;

export interface HistoryEntry {
  key: string;
  connectionId: string;
  rollId: string;
  rev: number;
  result: SavageRollResult;
}

export interface HistoryState {
  entries: HistoryEntry[];
  /** Highest rev handled per key, also for entries that dropped out (oldest first). */
  seen: [key: string, rev: number][];
  /** Arrival times of new broadcast entries per connection (flood limit). */
  recent: Record<string, number[]>;
}

export interface IncomingRoll {
  connectionId: string;
  roll: ParsedRoll;
}

export type HistoryAction =
  | { type: "broadcast"; item: IncomingRoll; now: number }
  | { type: "metadata"; items: IncomingRoll[] }
  | { type: "initial"; items: IncomingRoll[]; now: number };

export const EMPTY_HISTORY: HistoryState = { entries: [], seen: [], recent: {} };

export const entryKey = (connectionId: string, rollId: string) => `${connectionId}:${rollId}`;

const sameResult = (a: SavageRollResult, b: SavageRollResult) => JSON.stringify(a) === JSON.stringify(b);

function seenRev(state: HistoryState, key: string): number | undefined {
  for (let i = state.seen.length - 1; i >= 0; i--) if (state.seen[i]![0] === key) return state.seen[i]![1];
  return undefined;
}

function withSeen(seen: HistoryState["seen"], key: string, rev: number): HistoryState["seen"] {
  const next = seen.filter(([k]) => k !== key);
  next.push([key, rev]);
  return next.length > SEEN_LIMIT ? next.slice(-SEEN_LIMIT) : next;
}

type ApplyResult = { state: HistoryState; added: boolean };

function apply(state: HistoryState, { connectionId, roll }: IncomingRoll): ApplyResult {
  const key = entryKey(connectionId, roll.rollId);
  const previous = seenRev(state, key);
  if (previous !== undefined) {
    if (roll.rev < previous) return { state, added: false };
    const index = state.entries.findIndex((e) => e.key === key);
    if (index < 0) return { state, added: false }; // dropped out by the limit
    const current = state.entries[index]!;
    if (roll.rev === current.rev && sameResult(current.result, roll.result)) return { state, added: false };
    const entries = [...state.entries];
    entries[index] = { ...current, rev: roll.rev, result: roll.result };
    return { state: { ...state, entries, seen: withSeen(state.seen, key, roll.rev) }, added: false };
  }
  const entry: HistoryEntry = { key, connectionId, rollId: roll.rollId, rev: roll.rev, result: roll.result };
  return {
    state: {
      ...state,
      entries: [...state.entries, entry].slice(-HISTORY_LIMIT),
      seen: withSeen(state.seen, key, roll.rev),
    },
    added: true,
  };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "broadcast": {
      const { connectionId } = action.item;
      const key = entryKey(connectionId, action.item.roll.rollId);
      const recent = (state.recent[connectionId] ?? []).filter((t) => action.now - t < FLOOD_WINDOW_MS);
      if (seenRev(state, key) === undefined && recent.length >= FLOOD_MAX) return state;
      const { state: next, added } = apply(state, action.item);
      if (!added) return next;
      return { ...next, recent: { ...next.recent, [connectionId]: [...recent, action.now] } };
    }
    case "metadata":
      return action.items.reduce((s, item) => apply(s, item).state, state);
    case "initial": {
      const sorted = [...action.items].sort(
        (a, b) => Math.min(a.roll.result.timestamp, action.now) - Math.min(b.roll.result.timestamp, action.now)
      );
      return sorted.reduce((s, item) => apply(s, item).state, state);
    }
  }
}
