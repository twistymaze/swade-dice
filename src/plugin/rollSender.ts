/**
 * The one sender of this client's rolls (B-02, B-03, B-08, B-09, B-12, OD-1, OD-2).
 *
 * - A finished, not hidden roll is broadcast at once (rev 0). A post-roll edit (TN, modifier, Wild
 *   Die; OD-1) is sent after the controls settle (trailing debounce) with rev + 1. A change back to
 *   the last sent value, or a change that does not alter the payload, sends nothing.
 * - One serial queue: every OBR write is awaited; an error (rate limit, timeout) is retried with
 *   backoff; only the newest revision of a roll is sent. A final failure shows the roller an ERROR
 *   notification.
 * - After each send the player's own history (last 10 rolls, compact) is written to player metadata.
 * - Hidden rolls are never sent and never stored (OD-3). The flag comes from the roll itself.
 * - A payload over the broadcast limit, or one the receivers would reject, is not sent: notice.
 * - Sender name/color/role are read from OBR when a send runs, so a roll that finishes before player
 *   info has loaded is still sent (B-09).
 */
import OBR from "@owlbear-rodeo/sdk";
import { SavageRollResult } from "../types/SavageWorldsTypes";
import {
  BROADCAST_MAX_BYTES,
  buildRollBroadcast,
  encodeHistory,
  HISTORY_METADATA_KEY,
  HISTORY_PER_PLAYER,
  HistoryItem,
  jsonByteLength,
  MAX_NAME_LENGTH,
  parseHistoryMetadata,
  parseRollBroadcast,
  ROLL_CHANNEL,
  safeColor,
  safeName,
  SenderInfo,
} from "./rollWire";

export interface RollSenderOptions {
  /** Trailing debounce for post-roll edits (ms). */
  debounceMs?: number;
  /** Wait before each retry (ms); its length is the number of retries. */
  retryDelaysMs?: number[];
}

export const DEFAULT_DEBOUNCE_MS = 300;
/** Community values for OBR's unpublished rate limit: 600 ms up to 6 s (owlbear-platform.md 4.3). */
export const DEFAULT_RETRY_DELAYS_MS = [600, 1200, 2400, 4800, 6000];

export const SEND_FAILED_MESSAGE = "Your roll could not be shared with the table. Other players may not see it.";
export const STORE_FAILED_MESSAGE = "Your roll could not be saved to the party roll history.";
export const TOO_LARGE_MESSAGE = "This roll is too large to share with the table. Only you can see it.";

export interface RollIdentity {
  rollId: string;
  hidden: boolean;
}

interface RollState {
  /** Wire key (JSON of the result) of the last queued revision; null before the first send. */
  lastKey: string | null;
  rev: number;
  timer?: ReturnType<typeof setTimeout>;
}

type Job = { kind: "send"; rollId: string; rev: number; result: SavageRollResult } | { kind: "metadata" };

export function isRateLimitError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { error?: { name?: unknown } }).error?.name === "RateLimitHit"
  );
}

const PLACEHOLDER_SENDER: SenderInfo = {
  id: "x".repeat(MAX_NAME_LENGTH),
  connectionId: "x".repeat(MAX_NAME_LENGTH),
  name: "x".repeat(MAX_NAME_LENGTH),
  color: "#000000",
  role: "PLAYER",
};

async function readSender(): Promise<SenderInfo> {
  const [id, connectionId, name, color, role] = await Promise.all([
    OBR.player.getId(),
    OBR.player.getConnectionId(),
    OBR.player.getName(),
    OBR.player.getColor(),
    OBR.player.getRole(),
  ]);
  return { id, connectionId, name: safeName(name), color: safeColor(color), role: role === "GM" ? "GM" : "PLAYER" };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type RollSender = ReturnType<typeof createRollSender>;

export function createRollSender(options: RollSenderOptions = {}) {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  const rolls = new Map<string, RollState>();
  /** This player's last rolls, oldest first (what is written to player metadata). */
  let history: HistoryItem[] = [];
  const queue: Job[] = [];
  let running = false;
  let disposed = false;
  let idle: Promise<void> = Promise.resolve();

  const notify = (message: string) => {
    OBR.notification.show(message, "ERROR").catch((e: unknown) => console.error("[savage-worlds-dice]", e));
  };

  /** Run one OBR write with retries. Returns false after the last retry failed. */
  async function withRetry(job: Job, run: () => Promise<void>): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      if (disposed) return true;
      if (job.kind === "send" && isSuperseded(job)) return true;
      try {
        await run();
        return true;
      } catch (e) {
        if (attempt >= retryDelays.length) {
          console.error("[savage-worlds-dice] OBR write failed", e);
          return false;
        }
        await wait(retryDelays[attempt]);
      }
    }
  }

  /** A newer revision of the same roll is waiting: do not send this one. */
  function isSuperseded(job: Extract<Job, { kind: "send" }>) {
    return queue.some((j) => j.kind === "send" && j.rollId === job.rollId && j.rev > job.rev);
  }

  async function runJob(job: Job) {
    if (job.kind === "send") {
      const ok = await withRetry(job, async () => {
        const sender = await readSender();
        const payload = buildRollBroadcast(job.rollId, job.rev, job.result, sender);
        if (jsonByteLength(payload) > BROADCAST_MAX_BYTES) throw new Error("payload too large");
        await OBR.broadcast.sendMessage(ROLL_CHANNEL, payload, { destination: "ALL" });
      });
      if (!ok) notify(SEND_FAILED_MESSAGE);
    } else {
      const ok = await withRetry(job, () => OBR.player.setMetadata({ [HISTORY_METADATA_KEY]: encodeHistory(history) }));
      if (!ok) notify(STORE_FAILED_MESSAGE);
    }
  }

  function pump() {
    if (running || disposed) return;
    running = true;
    idle = (async () => {
      while (queue.length > 0 && !disposed) {
        const job = queue.shift() as Job;
        if (job.kind === "send" && isSuperseded(job)) continue;
        await runJob(job);
      }
      running = false;
    })();
  }

  function enqueue(job: Job) {
    if (job.kind === "metadata" && queue.some((j) => j.kind === "metadata")) {
      // One pending write is enough: it writes the history as it is when it runs.
    } else {
      queue.push(job);
    }
    pump();
  }

  function remember(item: HistoryItem) {
    const i = history.findIndex((h) => h.rollId === item.rollId);
    if (i >= 0) history[i] = item;
    else history = [...history, item].slice(-HISTORY_PER_PLAYER);
  }

  function flush(rollId: string, state: RollState, result: SavageRollResult, key: string) {
    state.timer = undefined;
    const rev = state.lastKey === null ? 0 : state.rev + 1;
    // The payload must be within the size limit and readable by every receiver (B-08, C-11).
    const probe = buildRollBroadcast(rollId, rev, result, PLACEHOLDER_SENDER);
    if (jsonByteLength(probe) > BROADCAST_MAX_BYTES || parseRollBroadcast(probe) === null) {
      if (state.lastKey === null) notify(TOO_LARGE_MESSAGE);
      state.lastKey = key;
      return;
    }
    state.lastKey = key;
    state.rev = rev;
    remember({ rollId, rev, result });
    enqueue({ kind: "send", rollId, rev, result });
    enqueue({ kind: "metadata" });
  }

  return {
    /**
     * Read this player's own history from player metadata, so a remount of the action popover
     * (same connection) keeps the earlier rolls in the list it writes.
     */
    async start() {
      try {
        const metadata = await OBR.player.getMetadata();
        const own = parseHistoryMetadata(metadata[HISTORY_METADATA_KEY]).rolls;
        const fresh = history;
        history = [...own.filter((o) => !fresh.some((h) => h.rollId === o.rollId)), ...fresh].slice(-HISTORY_PER_PLAYER);
      } catch (e) {
        console.error("[savage-worlds-dice] could not read own roll history", e);
      }
    },

    /** The current result of a finished roll changed (finished, or edited after the roll). */
    update(roll: RollIdentity, result: SavageRollResult) {
      if (disposed || roll.hidden || !result.isComplete) return;
      let state = rolls.get(roll.rollId);
      if (!state) {
        state = { lastKey: null, rev: 0 };
        rolls.clear(); // only the current roll can be edited
        rolls.set(roll.rollId, state);
      }
      const key = JSON.stringify(buildRollBroadcast(roll.rollId, 0, result, PLACEHOLDER_SENDER).result);
      if (state.timer) clearTimeout(state.timer);
      state.timer = undefined;
      if (key === state.lastKey) return;
      if (state.lastKey === null) {
        flush(roll.rollId, state, result, key);
      } else {
        const s = state;
        state.timer = setTimeout(() => flush(roll.rollId, s, result, key), debounceMs);
      }
    },

    /** Stop: pending debounced edits are dropped, no new writes start. */
    dispose() {
      disposed = true;
      for (const state of rolls.values()) if (state.timer) clearTimeout(state.timer);
      rolls.clear();
      queue.length = 0;
    },

    /** Test helper: resolves when the queue is empty. */
    whenIdle: () => idle,
    /** Test helper. */
    history: () => history,
  };
}
