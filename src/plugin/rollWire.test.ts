import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROADCAST_MAX_BYTES,
  buildRollBroadcast,
  contrastTextColor,
  encodeHistory,
  HISTORY_PER_PLAYER,
  HistoryItem,
  jsonByteLength,
  LIMITS,
  parseHistoryMetadata,
  parseRollBroadcast,
  parseRollResult,
  resetInvalidWarnings,
  safeColor,
  safeName,
  SenderInfo,
  warnInvalidOnce,
} from "./rollWire";
import { computeRollResult } from "../rules/outcomes";
import { DieChain, SavageRollMode, SavageRollResult } from "../types/SavageWorldsTypes";
import { MAX_DICE_PER_ROLL } from "../controls/store";

const goldens = import.meta.glob<Record<string, unknown>>("../test/fixtures/golden/broadcast.rollResult.*.json", {
  eager: true,
  import: "default",
});
const golden = (name: string) =>
  structuredClone(goldens[`../test/fixtures/golden/broadcast.rollResult.${name}.json`]) as Record<string, unknown> & {
    result: Record<string, unknown> & { outcomes: Record<string, unknown>[]; dieChains: Record<string, unknown>[] };
  };

const PLAYERS_64: SenderInfo = {
  id: "i".repeat(64),
  connectionId: "c".repeat(64),
  name: "n".repeat(64),
  color: "#123456",
  role: "GM",
};

/** Mutate a copy of the traitWildDie golden payload. */
function mutated(change: (p: ReturnType<typeof golden>) => void) {
  const p = golden("traitWildDie");
  change(p);
  return p;
}

function chain(i: number, dieType: DieChain["dieType"], rolls: number[], isWildDie = false): DieChain {
  return { dieId: String(i + 1), dieType, rolls, total: rolls.reduce((a, b) => a + b, 0), isWildDie };
}

/**
 * The largest roll the app can produce within the receiver limits: 40 dice + Wild Die, every die
 * aced as often as the 300-roll budget allows, every value at its maximum width ("12"/"10").
 */
function maxRoll(mode: SavageRollMode): SavageRollResult {
  const dice = MAX_DICE_PER_ROLL + (mode === "TRAIT" ? 1 : 0);
  const perChain = Math.floor(LIMITS.maxTotalRolls / dice);
  const chains = Array.from({ length: dice }, (_, i) =>
    chain(i, "D12", [...Array(perChain - 1).fill(12), 11], mode === "TRAIT" && i === dice - 1)
  );
  return computeRollResult(
    { mode, dieChains: chains, timestamp: 8.64e15 - 1, isComplete: true },
    { targetNumber: 99, traitModifier: -99, damageModifier: -99, wildDieEnabled: true }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  resetInvalidWarnings();
});

describe("T-50 parseRollBroadcast: accepts", () => {
  it.each(Object.keys(goldens).map((k) => k.replace(/^.*broadcast\.rollResult\.|\.json$/g, "")))(
    "T-01/T-60 golden %s (legacy, no v): result unchanged, rollId from the timestamp",
    (name) => {
      const p = golden(name);
      const parsed = parseRollBroadcast(p);
      expect(parsed).not.toBeNull();
      expect(parsed?.version).toBe(0);
      expect(parsed?.rollId).toBe(`t${p.result.timestamp}`);
      expect(parsed?.rev).toBe(0);
      expect(parsed?.result).toEqual(p.result);
    }
  );

  it("a v1 payload from buildRollBroadcast round-trips", () => {
    const result = parseRollResult(golden("multiTraitWildDie").result) as SavageRollResult;
    const payload = buildRollBroadcast("abc-123", 4, result, PLAYERS_64);
    expect(parseRollBroadcast(JSON.parse(JSON.stringify(payload)))).toEqual({ version: 1, rollId: "abc-123", rev: 4, result });
  });

  it("older senders without wildDieEnabled / raises / replacedByWild / isWildDie: defaults", () => {
    const p = mutated((p) => {
      delete p.result.wildDieEnabled;
      delete p.result.targetNumber;
      delete p.result.modifier;
      for (const o of p.result.outcomes) {
        delete o.raises;
        delete o.replacedByWild;
        for (const c of o.chains as Record<string, unknown>[]) delete c.isWildDie;
      }
      for (const c of p.result.dieChains) delete c.isWildDie;
    });
    const r = parseRollBroadcast(p)?.result;
    expect(r).toMatchObject({ wildDieEnabled: false, targetNumber: 4, modifier: 0 });
    expect(r?.outcomes[0]).toMatchObject({ replacedByWild: false });
    expect(r?.outcomes[0]).not.toHaveProperty("raises");
    expect(r?.dieChains.every((c) => c.isWildDie === false)).toBe(true);
  });

  it("extra unknown keys (newer sender) are dropped, not copied", () => {
    const p = mutated((p) => {
      p.v = 2;
      p.rollId = "r1";
      p.rev = 0;
      p.future = { x: 1 };
      p.result.future = {};
      p.result.outcomes[0].extra = 1;
    });
    const parsed = parseRollBroadcast(p);
    expect(parsed?.version).toBe(2);
    expect(parsed?.result).not.toHaveProperty("future");
    expect(parsed?.result.outcomes[0]).not.toHaveProperty("extra");
  });

  it("an Object.create(null) payload with valid fields is accepted", () => {
    const p = Object.assign(Object.create(null), golden("traitNoWild"));
    expect(parseRollBroadcast(p)).not.toBeNull();
  });
});

describe("T-05/T-50 parseRollBroadcast: hostile and bad payloads are rejected (null), never thrown", () => {
  const cases: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["string", "str"],
    ["number", 42],
    ["array", []],
    ["empty object", {}],
    ["result missing", mutated((p) => delete (p as Record<string, unknown>).result)],
    ["isComplete false", mutated((p) => (p.result.isComplete = false))],
    ["mode lower case", mutated((p) => (p.result.mode = "trait"))],
    ["mode number", mutated((p) => (p.result.mode = 1))],
    ["timestamp 0", mutated((p) => (p.result.timestamp = 0))],
    ["timestamp -1", mutated((p) => (p.result.timestamp = -1))],
    ["timestamp string", mutated((p) => (p.result.timestamp = "1"))],
    ["timestamp 1.5", mutated((p) => (p.result.timestamp = 1.5))],
    ["timestamp 1e20", mutated((p) => (p.result.timestamp = 1e20))],
    ["timestamp NaN", mutated((p) => (p.result.timestamp = NaN))],
    ["outcomes missing", mutated((p) => delete (p.result as Record<string, unknown>).outcomes)],
    ["outcomes object", mutated((p) => (p.result.outcomes = {} as never))],
    ["outcomes string", mutated((p) => (p.result.outcomes = "abc" as never))],
    ["outcomes [null]", mutated((p) => (p.result.outcomes = [null] as never))],
    ["outcome chains empty", mutated((p) => (p.result.outcomes[0].chains = []))],
    ["outcome total string", mutated((p) => (p.result.outcomes[0].total = "6"))],
    ["outcome total Infinity", mutated((p) => (p.result.outcomes[0].total = Infinity))],
    ["outcome success string", mutated((p) => (p.result.outcomes[0].success = "yes"))],
    ["raises negative", mutated((p) => (p.result.outcomes[0].raises = -1))],
    ["raises 1e9", mutated((p) => (p.result.outcomes[0].raises = 1e9))],
    ["reason 201 chars", mutated((p) => (p.result.outcomes[0].criticalFailureReason = "x".repeat(201)))],
    ["dieType D3", mutated((p) => (p.result.dieChains[0].dieType = "D3"))],
    ["dieType D20 (removed, OD-8)", mutated((p) => (p.result.dieChains[0].dieType = "D20"))],
    ["dieType __proto__", mutated((p) => (p.result.dieChains[0].dieType = "__proto__"))],
    ["dieType constructor", mutated((p) => (p.result.dieChains[0].dieType = "constructor"))],
    ["dieType toString", mutated((p) => (p.result.dieChains[0].dieType = "toString"))],
    ["dieType number", mutated((p) => (p.result.dieChains[0].dieType = 6))],
    ["rolls not an array", mutated((p) => (p.result.dieChains[0].rolls = 3))],
    ["rolls empty", mutated((p) => (p.result.dieChains[0].rolls = []))],
    ["roll 0", mutated((p) => Object.assign(p.result.dieChains[0], { rolls: [0], total: 0 }))],
    ["roll over max face", mutated((p) => Object.assign(p.result.dieChains[0], { rolls: [9], total: 9 }))],
    ["roll 2.5", mutated((p) => Object.assign(p.result.dieChains[0], { rolls: [2.5], total: 2.5 }))],
    ["roll string", mutated((p) => Object.assign(p.result.dieChains[0], { rolls: ["6"], total: 6 }))],
    ["52 rolls in a chain", mutated((p) => Object.assign(p.result.dieChains[0], { rolls: [...Array(51).fill(8), 1], total: 409 }))],
    ["chain total != sum", mutated((p) => (p.result.dieChains[0].total = 99))],
    ["dieId empty", mutated((p) => (p.result.dieChains[0].dieId = ""))],
    ["dieId number", mutated((p) => (p.result.dieChains[0].dieId = 1))],
    ["dieId with markup", mutated((p) => (p.result.dieChains[0].dieId = "<b>x</b>"))],
    ["dieId 65 chars", mutated((p) => (p.result.dieChains[0].dieId = "a".repeat(65)))],
    ["isWildDie string", mutated((p) => (p.result.dieChains[0].isWildDie = "true"))],
    ["51 dieChains", mutated((p) => (p.result.dieChains = Array.from({ length: 51 }, (_, i) => chain(i, "D6", [3])) as never))],
    ["modifier 100", mutated((p) => (p.result.modifier = 100))],
    ["outcome modifier -100", mutated((p) => (p.result.outcomes[0].modifier = -100))],
    ["targetNumber 0", mutated((p) => (p.result.targetNumber = 0))],
    ["targetNumber 100", mutated((p) => (p.result.targetNumber = 100))],
    ["wildDieEnabled string", mutated((p) => (p.result.wildDieEnabled = "yes"))],
    ["v 0", mutated((p) => Object.assign(p, { v: 0, rollId: "r", rev: 0 }))],
    ["v string", mutated((p) => Object.assign(p, { v: "1", rollId: "r", rev: 0 }))],
    ["v1 without rollId", mutated((p) => Object.assign(p, { v: 1, rev: 0 }))],
    ["v1 rollId with spaces", mutated((p) => Object.assign(p, { v: 1, rollId: "a b", rev: 0 }))],
    ["v1 rev -1", mutated((p) => Object.assign(p, { v: 1, rollId: "r", rev: -1 }))],
    ["v1 rev 1.5", mutated((p) => Object.assign(p, { v: 1, rollId: "r", rev: 1.5 }))],
    ["result via __proto__", JSON.parse('{"__proto__":{"isComplete":true},"result":{"__proto__":{"isComplete":true}}}')],
    ["result is a class instance", { result: new Date() }],
  ];

  it.each(cases)("%s", (_label, data) => {
    expect(() => parseRollBroadcast(data)).not.toThrow();
    expect(parseRollBroadcast(data)).toBeNull();
    expect(({} as Record<string, unknown>).isComplete).toBeUndefined();
  });

  it("C-06 a 7000-roll chain is rejected quickly", () => {
    const p = mutated((p) =>
      Object.assign(p.result.dieChains[0], { rolls: Array(7000).fill(8), total: 56000 })
    );
    const start = performance.now();
    expect(parseRollBroadcast(p)).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("the payload player block is ignored (identity comes from OBR, C-02)", () => {
    const p = mutated((p) => {
      p.player = { name: "<img src=x onerror=alert(1)>", color: "#000;background:url(x)}body{display:none" };
      p.playerId = 42;
    });
    const parsed = parseRollBroadcast(p);
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("onerror");
    expect(JSON.stringify(parsed)).not.toContain("background");
  });
});

describe("C-03/C-07 display helpers", () => {
  it.each([
    ["#4e9a06", "#4e9a06"],
    ["#ABCDEF", "#ABCDEF"],
    ["#fff", "#888888"],
    ["red", "#888888"],
    ["rgb(1,2,3)", "#888888"],
    ["#000;background-image:url(https://evil)", "#888888"],
    [undefined, "#888888"],
    [123, "#888888"],
  ])("safeColor(%s) = %s", (input, expected) => {
    expect(safeColor(input)).toBe(expected);
  });

  it("contrast text color never throws (TP-B15)", () => {
    expect(contrastTextColor("#ffffff")).toBe("black");
    expect(contrastTextColor("#000000")).toBe("white");
    expect(contrastTextColor(undefined)).toBe("black"); // the gray fallback
  });

  it.each([
    ["#ffffff", "black"],
    ["#000000", "white"],
    ["#4e9a06", "white"], // golden player color
    ["#ffeb3b", "black"],
    ["#fff", "black"], // not 6-digit hex -> gray fallback
    ["rgb(0,0,0)", "black"],
    ["red", "black"],
    [undefined, "black"],
  ])("T-36 pill text color on %s -> %s", (color, expected) => {
    expect(contrastTextColor(color)).toBe(expected);
  });

  it("names are strings of at most 64 characters", () => {
    expect(safeName("Wren")).toBe("Wren");
    expect(Array.from(safeName("x".repeat(200)))).toHaveLength(64);
    expect(safeName(undefined)).toBe("Unknown");
  });

  it("warns once per sender and source", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnInvalidOnce("broadcast", "c1");
    warnInvalidOnce("broadcast", "c1");
    warnInvalidOnce("metadata", "c1");
    warnInvalidOnce("broadcast", "c2");
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe("T-57 size limits", () => {
  it("B-08 the largest roll the app can produce fits one broadcast and the receivers accept it", () => {
    for (const mode of ["TRAIT", "DAMAGE", "STANDARD"] as const) {
      const payload = buildRollBroadcast("x".repeat(36), LIMITS.maxRev, maxRoll(mode), PLAYERS_64);
      expect(jsonByteLength(payload), mode).toBeLessThanOrEqual(BROADCAST_MAX_BYTES);
      expect(parseRollBroadcast(payload), mode).not.toBeNull();
    }
  });

  it("OD-2 ten max-size rolls fit well under the 64 kB player metadata limit (< 32 kB)", () => {
    const items: HistoryItem[] = Array.from({ length: HISTORY_PER_PLAYER }, (_, i) => ({
      rollId: `${"r".repeat(34)}${i.toString().padStart(2, "0")}`,
      rev: LIMITS.maxRev,
      result: maxRoll(i % 2 ? "DAMAGE" : "TRAIT"),
    }));
    const value = encodeHistory(items);
    const bytes = jsonByteLength({ "rodeo.owlbear.savage-worlds-dice/history": value });
    expect(bytes).toBeLessThan(32 * 1024);
    expect(parseHistoryMetadata(value).rolls).toHaveLength(HISTORY_PER_PLAYER);
  });

  it("a typical trait roll costs under 200 bytes in the history", () => {
    const result = parseRollResult(golden("traitWildDie").result) as SavageRollResult;
    expect(jsonByteLength(encodeHistory([{ rollId: crypto.randomUUID(), rev: 0, result }]))).toBeLessThan(200);
  });
});

describe("OD-2 parseHistoryMetadata", () => {
  const result = (name: string) => parseRollResult(golden(name).result) as SavageRollResult;

  it("round-trips: outcomes are recomputed with the rules engine", () => {
    const items = ["traitWildDie", "multiTraitWildDie", "explodingChain", "standard"].map((name, i) => ({
      rollId: `roll-${i}`,
      rev: i,
      result: result(name),
    }));
    const parsed = parseHistoryMetadata(JSON.parse(JSON.stringify(encodeHistory(items)))).rolls;
    expect(parsed.map((p) => [p.rollId, p.rev])).toEqual(items.map((i) => [i.rollId, i.rev]));
    parsed.forEach((p, i) => {
      expect(p.result.outcomes.map((o) => o.total)).toEqual(items[i].result.outcomes.map((o) => o.total));
      expect(p.result.targetNumber).toBe(items[i].result.targetNumber);
      expect(p.result.modifier).toBe(items[i].result.modifier);
    });
  });

  it("keeps only the last 10 records and drops invalid ones one by one", () => {
    const good = encodeHistory([{ rollId: "ok", rev: 0, result: result("traitNoWild") }]).rolls[0];
    const raw = {
      v: 1,
      rolls: [
        ...Array.from({ length: 9 }, (_, i) => ({ ...good, id: `ok${i}` })),
        { ...good, id: "bad id!" },
        { ...good, id: "bad-face", c: [["D6", 0, 7]] },
        { ...good, id: "bad-type", c: [["__proto__", 0, 1]] },
        { ...good, id: "last" },
      ],
    };
    const { rolls, invalid } = parseHistoryMetadata(raw);
    expect(invalid).toBe(3);
    expect(rolls.map((r) => r.rollId)).toEqual(["ok3", "ok4", "ok5", "ok6", "ok7", "ok8", "last"]);
  });

  it.each([
    ["missing", undefined, 0],
    ["null", null, 1],
    ["string", "x", 1],
    ["no version", { rolls: [] }, 1],
    ["rolls not array", { v: 1, rolls: {} }, 1],
  ])("%s gives no rolls", (_l, value, invalid) => {
    expect(parseHistoryMetadata(value)).toEqual({ rolls: [], invalid });
  });
});

describe("T-60 a new payload is readable by an old client", () => {
  /** The paths the pre-change receivers read (RollHistoryTray / NotificationPopover / pill / summary). */
  it("every path old code reads is present with the old type; player is kept", () => {
    const result = parseRollResult(golden("multiTraitWildDie").result) as SavageRollResult;
    const p = JSON.parse(JSON.stringify(buildRollBroadcast("id-1", 0, result, PLAYERS_64)));
    expect(typeof p.playerId).toBe("string");
    expect(typeof p.player.name).toBe("string");
    expect(p.player.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(p.player).sort()).toEqual(["color", "connectionId", "id", "metadata", "name", "role", "syncView"]);
    expect(Object.keys(p.result).sort()).toEqual(
      ["dieChains", "isComplete", "mode", "modifier", "outcomes", "targetNumber", "timestamp", "wildDieEnabled"].sort()
    );
    expect(p.result.isComplete).toBe(true);
    expect(typeof p.result.timestamp).toBe("number");
    for (const o of p.result.outcomes) {
      expect(typeof o.total).toBe("number");
      expect(Array.isArray(o.chains)).toBe(true);
      expect(typeof o.chains[0].dieType).toBe("string");
    }
  });
});
