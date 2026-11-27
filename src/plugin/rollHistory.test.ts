import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, FLOOD_MAX, FLOOD_WINDOW_MS, HISTORY_LIMIT, historyReducer, HistoryState, IncomingRoll } from "./rollHistory";
import { parseRollResult } from "./rollWire";
import { SavageRollResult } from "../types/SavageWorldsTypes";
import traitWildDie from "../test/fixtures/golden/broadcast.rollResult.traitWildDie.json";
import modifierChanged from "../test/fixtures/golden/broadcast.rollResult.traitWildDie.modifierChanged.json";

const base = parseRollResult(traitWildDie.result) as SavageRollResult;
const changed = parseRollResult(modifierChanged.result) as SavageRollResult;

const roll = (connectionId: string, rollId: string, rev = 0, result = base, timestamp?: number): IncomingRoll => ({
  connectionId,
  roll: { version: 1, rollId, rev, result: timestamp ? { ...result, timestamp } : result },
});

const keys = (s: HistoryState) => s.entries.map((e) => e.key);
let clock = 1_000_000;
const live = (s: HistoryState, item: IncomingRoll, now = (clock += FLOOD_WINDOW_MS)) =>
  historyReducer(s, { type: "broadcast", item, now });

describe("T-53 history order by arrival, not sender clock (B-04, C-04)", () => {
  it("a roll with an old sender timestamp is appended at the end", () => {
    let s = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT; i++) s = live(s, roll(`c${i}`, `r${i}`, 0, base, 2_000_000 + i));
    s = live(s, roll("slow", "late", 0, base, 1));
    expect(keys(s)).toHaveLength(HISTORY_LIMIT);
    expect(keys(s).at(-1)).toBe("slow:late");
    expect(keys(s)[0]).toBe("c1:r1"); // the oldest arrival dropped
  });

  it("20 forged far-future timestamps do not hide the next real roll", () => {
    let s = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT; i++) s = live(s, roll(`evil${i}`, `x${i}`, 0, base, 8.64e15 - 1));
    s = live(s, roll("honest", "real"));
    expect(keys(s).at(-1)).toBe("honest:real");
  });

  it("a revision keeps the entry position; an older revision is ignored; equal content is a no-op", () => {
    let s = live(EMPTY_HISTORY, roll("a", "1"));
    s = live(s, roll("b", "2"));
    const after = live(s, roll("a", "1", 2, changed));
    expect(keys(after)).toEqual(["a:1", "b:2"]);
    expect(after.entries[0].result).toEqual(changed);
    expect(live(after, roll("a", "1", 1, base)).entries[0].result).toEqual(changed);
    expect(live(after, roll("a", "1", 2, changed))).toBe(after);
  });

  it("T-46 a late joiner that missed rev 0 gets a revision: the entry is added, not dropped", () => {
    const s1 = live(EMPTY_HISTORY, roll("a", "1", 3, changed));
    expect(keys(s1)).toEqual(["a:1"]);
    expect(s1.entries[0]).toMatchObject({ rev: 3, result: changed });
  });

  it("legacy payloads (rev 0 always) replace by arrival", () => {
    let s = live(EMPTY_HISTORY, roll("a", "t1"));
    s = live(s, roll("a", "t1", 0, changed));
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].result).toEqual(changed);
  });

  it("T-49 the same rollId from another connection is another entry (no overwrite)", () => {
    let s = live(EMPTY_HISTORY, roll("a", "same"));
    s = live(s, roll("b", "same", 5, changed));
    expect(keys(s)).toEqual(["a:same", "b:same"]);
    expect(s.entries[0].result).toEqual(base);
  });

  it("an entry that dropped out does not come back from a later metadata read", () => {
    let s = live(EMPTY_HISTORY, roll("a", "old"));
    for (let i = 0; i < HISTORY_LIMIT; i++) s = live(s, roll(`c${i}`, `r${i}`));
    expect(keys(s)).not.toContain("a:old");
    s = historyReducer(s, { type: "metadata", items: [roll("a", "old"), roll("a", "old", 3, changed)] });
    expect(keys(s)).not.toContain("a:old");
  });

  it(`flood limit: at most ${FLOOD_MAX} new entries per connection in ${FLOOD_WINDOW_MS / 1000} s; others unaffected`, () => {
    let s = EMPTY_HISTORY;
    const t = 5_000_000;
    for (let i = 0; i < 8; i++) s = live(s, roll("flood", `f${i}`), t + i);
    s = live(s, roll("other", "o"), t + 9);
    expect(s.entries.filter((e) => e.connectionId === "flood")).toHaveLength(FLOOD_MAX);
    expect(keys(s)).toContain("other:o");
    // a revision of a known entry is not limited
    s = live(s, roll("flood", "f0", 1, changed), t + 10);
    expect(s.entries[0].result).toEqual(changed);
    // after the window, new entries are accepted again
    s = live(s, roll("flood", "later"), t + FLOOD_WINDOW_MS + 1);
    expect(keys(s)).toContain("flood:later");
  });
});

describe("T-14 / OD-2 initial load from player metadata", () => {
  it("orders by sender timestamp clamped to the local clock, keeps the newest 20", () => {
    const now = 3_000_000;
    const items = [
      roll("a", "a2", 0, base, 2_000),
      roll("b", "future", 0, base, 8.64e15 - 1),
      roll("a", "a1", 0, base, 1_000),
      ...Array.from({ length: 20 }, (_, i) => roll("c", `c${i}`, 0, base, 10_000 + i)),
    ];
    const s = historyReducer(EMPTY_HISTORY, { type: "initial", items, now });
    expect(s.entries).toHaveLength(HISTORY_LIMIT);
    expect(keys(s).at(-1)).toBe("b:future"); // clamped to "now", not pinned beyond later arrivals
    const later = live(s, roll("d", "new"), now + 1);
    expect(keys(later).at(-1)).toBe("d:new");
  });

  it("dedupes a roll that came both by broadcast and by metadata", () => {
    let s = live(EMPTY_HISTORY, roll("a", "r", 1, changed));
    s = historyReducer(s, { type: "metadata", items: [roll("a", "r", 0, base), roll("a", "r", 1, changed)] });
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].result).toEqual(changed);
  });
});
