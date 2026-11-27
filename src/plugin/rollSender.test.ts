import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, flushObr, hub, obr, rateLimitError, resetObrMock } from "../test/obrMock";

vi.mock("@owlbear-rodeo/sdk", () => import("../test/obrMock").then((m) => m.createSdkModule()));

import { createRollSender, DEFAULT_RETRY_DELAYS_MS, SEND_FAILED_MESSAGE, STORE_FAILED_MESSAGE, TOO_LARGE_MESSAGE } from "./rollSender";
import { HISTORY_METADATA_KEY, HISTORY_PER_PLAYER, parseHistoryMetadata, parseRollBroadcast, ROLL_CHANNEL } from "./rollWire";
import { computeRollResult, RollSettings } from "../rules/outcomes";
import { DieChain, SavageRollResult } from "../types/SavageWorldsTypes";

const chains: DieChain[] = [
  { dieId: "1", dieType: "D8", rolls: [3], total: 3, isWildDie: false },
  { dieId: "2", dieType: "D6", rolls: [5], total: 5, isWildDie: true },
];
const settings = (s: Partial<RollSettings> = {}): RollSettings => ({
  targetNumber: 4,
  traitModifier: 0,
  damageModifier: 0,
  wildDieEnabled: true,
  ...s,
});
const result = (s?: Partial<RollSettings>, dieChains = chains): SavageRollResult =>
  computeRollResult({ mode: "TRAIT", dieChains, timestamp: 1764250001800, isComplete: true }, settings(s));

const sends = () => obr().broadcast.sendMessage.mock.calls.map((c) => c[1] as { rev: number; result: SavageRollResult });
const settle = async (ms = 400) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flushObr();
};

beforeEach(() => {
  vi.useFakeTimers();
  resetObrMock({ id: "u1", connectionId: "c1", name: "Ava", color: "#aa0000", role: "GM" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("send once per change: dedupe and debounce", () => {
  it("a finished roll sends exactly once, at once, rev 0, and stores it in player metadata", async () => {
    const sender = createRollSender();
    sender.update({ rollId: "r1", hidden: false }, result());
    await flushObr();
    expect(sends()).toHaveLength(1);
    expect(sends()[0]).toMatchObject({ rev: 0 });
    const stored = parseHistoryMetadata(obr().state.player.metadata[HISTORY_METADATA_KEY]).rolls;
    expect(stored.map((r) => r.rollId)).toEqual(["r1"]);
  });

  it("the same content again sends nothing (e.g. a damage modifier change during a TRAIT result)", async () => {
    const sender = createRollSender();
    sender.update({ rollId: "r1", hidden: false }, result());
    sender.update({ rollId: "r1", hidden: false }, result({ damageModifier: 5 }));
    await settle();
    expect(sends()).toHaveLength(1);
  });

  it("5 quick modifier clicks send one revision with the final value; spaced clicks send in order", async () => {
    const sender = createRollSender();
    sender.update({ rollId: "r1", hidden: false }, result());
    await flushObr();
    for (let m = 1; m <= 5; m++) {
      sender.update({ rollId: "r1", hidden: false }, result({ traitModifier: m }));
      await vi.advanceTimersByTimeAsync(100);
    }
    await settle();
    expect(sends().map((p) => [p.rev, p.result.modifier])).toEqual([[0, 0], [1, 5]]);
    sender.update({ rollId: "r1", hidden: false }, result({ traitModifier: -1 }));
    await settle();
    expect(sends().map((p) => [p.rev, p.result.modifier])).toEqual([[0, 0], [1, 5], [2, -1]]);
  });

  it("+1 -> +2 -> +1 inside the window sends nothing (equals the last sent)", async () => {
    const sender = createRollSender();
    sender.update({ rollId: "r1", hidden: false }, result({ traitModifier: 1 }));
    await flushObr();
    sender.update({ rollId: "r1", hidden: false }, result({ traitModifier: 2 }));
    sender.update({ rollId: "r1", hidden: false }, result({ traitModifier: 1 }));
    await settle();
    expect(sends()).toHaveLength(1);
  });

  it("dispose with a pending edit: no send after dispose, no timer left", async () => {
    const sender = createRollSender();
    sender.update({ rollId: "r1", hidden: false }, result());
    await flushObr();
    sender.update({ rollId: "r1", hidden: false }, result({ traitModifier: 3 }));
    sender.dispose();
    await settle(2000);
    expect(sends()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a hidden roll is never sent or stored, also after edits", async () => {
    const sender = createRollSender();
    sender.update({ rollId: "h", hidden: true }, result());
    sender.update({ rollId: "h", hidden: true }, result({ targetNumber: 8 }));
    await settle();
    expect(obr().broadcast.sendMessage).not.toHaveBeenCalled();
    expect(obr().player.setMetadata).not.toHaveBeenCalled();
  });

  it("keeps the last 10 rolls in player metadata; a revision updates its record in place", async () => {
    const sender = createRollSender();
    for (let i = 0; i < 12; i++) {
      sender.update({ rollId: `r${i}`, hidden: false }, result());
      await flushObr();
    }
    sender.update({ rollId: "r11", hidden: false }, result({ targetNumber: 8 }));
    await settle();
    const stored = parseHistoryMetadata(obr().state.player.metadata[HISTORY_METADATA_KEY]).rolls;
    expect(stored).toHaveLength(HISTORY_PER_PLAYER);
    expect(stored.map((r) => r.rollId)).toEqual(Array.from({ length: 10 }, (_, i) => `r${i + 2}`));
    expect(stored.at(-1)).toMatchObject({ rev: 1, result: { targetNumber: 8 } });
  });

  it("start() keeps the rolls already in this connection's metadata (action iframe remount)", async () => {
    const first = createRollSender();
    first.update({ rollId: "before", hidden: false }, result());
    await flushObr();
    first.dispose();
    const second = createRollSender();
    await second.start();
    second.update({ rollId: "after", hidden: false }, result());
    await flushObr();
    const stored = parseHistoryMetadata(obr().state.player.metadata[HISTORY_METADATA_KEY]).rolls;
    expect(stored.map((r) => r.rollId)).toEqual(["before", "after"]);
  });
});

describe("rate limit, retry and error notice", () => {
  it("one RateLimitHit is retried with backoff; receivers get one entry with the final value", async () => {
    const other = createClient({ name: "Other" });
    const received = vi.fn();
    other.broadcast.onMessage(ROLL_CHANNEL, received);
    const send = obr().broadcast.sendMessage;
    const real = send.getMockImplementation()!;
    send.mockImplementationOnce(async () => Promise.reject(rateLimitError()));
    const sender = createRollSender();
    sender.update({ rollId: "r1", hidden: false }, result());
    await flushObr();
    expect(received).not.toHaveBeenCalled();
    send.mockImplementation(real);
    await settle(DEFAULT_RETRY_DELAYS_MS[0]! + 10);
    expect(received).toHaveBeenCalledTimes(1);
    expect(obr().state.notifications).toEqual([]);
  });

  it("the mock rate limit: a burst of edits still ends with the newest revision delivered", async () => {
    hub().limits.rateLimit = { maxMessages: 2, windowMs: 1000 };
    hub().now = () => Date.now();
    const other = createClient({ name: "Other" });
    const received = vi.fn();
    other.broadcast.onMessage(ROLL_CHANNEL, received);
    const sender = createRollSender({ debounceMs: 0 });
    sender.update({ rollId: "r1", hidden: false }, result());
    for (let m = 1; m <= 4; m++) {
      await vi.advanceTimersByTimeAsync(1);
      sender.update({ rollId: "r1", hidden: false }, result({ traitModifier: m }));
    }
    await settle(20000);
    const last = received.mock.calls.at(-1)?.[0].data;
    expect(parseRollBroadcast(last)?.result.modifier).toBe(4);
    expect(obr().state.notifications).toEqual([]);
  });

  it("every retry fails: one ERROR notice for the send, one for the history; no unhandled rejection", async () => {
    obr().broadcast.sendMessage.mockImplementation(async () => Promise.reject(rateLimitError()));
    obr().player.setMetadata.mockImplementation(async () => Promise.reject(new Error("timeout")));
    const sender = createRollSender();
    sender.update({ rollId: "r1", hidden: false }, result());
    await settle(60000);
    expect(obr().state.notifications.map((n) => [n.message, n.variant])).toEqual([
      [SEND_FAILED_MESSAGE, "ERROR"],
      [STORE_FAILED_MESSAGE, "ERROR"],
    ]);
    expect(obr().broadcast.sendMessage).toHaveBeenCalledTimes(DEFAULT_RETRY_DELAYS_MS.length + 1);
  });

  it("an edit while a send is retrying: the older revision is not sent after the newer", async () => {
    const send = obr().broadcast.sendMessage;
    const real = send.getMockImplementation()!;
    send.mockImplementationOnce(async () => Promise.reject(rateLimitError()));
    const sender = createRollSender({ debounceMs: 10 });
    sender.update({ rollId: "r1", hidden: false }, result());
    await flushObr();
    send.mockImplementation(real);
    sender.update({ rollId: "r1", hidden: false }, result({ traitModifier: 2 }));
    await settle(5000);
    const revs = send.mock.calls.slice(1).map((c) => (c[1] as { rev: number }).rev);
    expect(revs).toEqual([1]);
  });

  it("a roll is sent although OBR player info is slow", async () => {
    const getName = obr().player.getName;
    const real = getName.getMockImplementation()!;
    getName.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(real()), 3000)));
    const sender = createRollSender();
    sender.update({ rollId: "r1", hidden: false }, result());
    await flushObr();
    expect(sends()).toHaveLength(0);
    await settle(3100);
    expect(sends()).toHaveLength(1);
  });
});

describe("payload size guard", () => {
  it("a roll the receivers would reject is not sent or stored; the roller gets a notice", async () => {
    const huge: DieChain[] = Array.from({ length: 60 }, (_, i) => ({
      dieId: String(i + 1),
      dieType: "D6",
      rolls: [3],
      total: 3,
      isWildDie: false,
    }));
    const sender = createRollSender();
    sender.update({ rollId: "big", hidden: false }, result({}, huge));
    sender.update({ rollId: "big", hidden: false }, result({ traitModifier: 1 }, huge));
    await settle();
    expect(obr().broadcast.sendMessage).not.toHaveBeenCalled();
    expect(obr().player.setMetadata).not.toHaveBeenCalled();
    expect(obr().state.notifications.map((n) => n.message)).toEqual([TOO_LARGE_MESSAGE]);
  });
});

type SentPayload = { playerId: string; player: { id: string; name: string; color: string; role: string; connectionId: string } };
const sentPlayers = () => obr().broadcast.sendMessage.mock.calls.map((c) => (c[1] as SentPayload).player);

describe("the payload carries the real OBR role", () => {
  it("a GM client sends role GM; a player client sends role PLAYER (a hard-coded role fails one of them)", async () => {
    resetObrMock({ id: "g1", connectionId: "cg", name: "Gina", color: "#00aa00", role: "GM" });
    const gm = createRollSender();
    gm.update({ rollId: "r1", hidden: false }, result());
    await flushObr();
    expect(sentPlayers()).toEqual([expect.objectContaining({ id: "g1", connectionId: "cg", name: "Gina", role: "GM" })]);
    expect(parseRollBroadcast(obr().broadcast.sendMessage.mock.calls[0]![1])).not.toBeNull();
    gm.dispose();

    resetObrMock({ id: "p1", connectionId: "cp", name: "Pip", color: "#0000aa", role: "PLAYER" });
    const player = createRollSender();
    player.update({ rollId: "r2", hidden: false }, result());
    await flushObr();
    expect(sentPlayers()).toEqual([expect.objectContaining({ id: "p1", connectionId: "cp", name: "Pip", role: "PLAYER" })]);
  });

  it("the role is read at send time: a GM handover between rolls changes the next payload", async () => {
    resetObrMock({ id: "u1", connectionId: "c1", name: "Ava", color: "#aa0000", role: "PLAYER" });
    const sender = createRollSender();
    sender.update({ rollId: "r1", hidden: false }, result());
    await flushObr();
    obr().setRole("GM");
    sender.update({ rollId: "r2", hidden: false }, result());
    await flushObr();
    expect(sentPlayers().map((p) => p.role)).toEqual(["PLAYER", "GM"]);
  });
});

describe("player info that rejects: no placeholder identity is sent", () => {
  const placeholder = "x".repeat(64);

  it.each(["getName", "getColor", "getRole", "getId", "getConnectionId"] as const)(
    "%s rejects once: the send is retried and carries the real identity",
    async (getter) => {
      obr().player[getter].mockImplementationOnce(async () => Promise.reject(new Error("not ready")));
      const sender = createRollSender();
      sender.update({ rollId: "r1", hidden: false }, result());
      await flushObr();
      expect(obr().broadcast.sendMessage).not.toHaveBeenCalled();
      await settle(DEFAULT_RETRY_DELAYS_MS[0]! + 100);
      expect(sentPlayers()).toEqual([
        expect.objectContaining({ id: "u1", connectionId: "c1", name: "Ava", color: "#aa0000", role: "GM" }),
      ]);
      expect(JSON.stringify(obr().broadcast.sendMessage.mock.calls)).not.toContain(placeholder);
      expect(obr().state.notifications).toEqual([]);
    }
  );

  it("getName always rejects: nothing is sent and the roller gets the ERROR notice", async () => {
    obr().player.getName.mockImplementation(async () => Promise.reject(new Error("not ready")));
    const sender = createRollSender();
    sender.update({ rollId: "r1", hidden: false }, result());
    await settle(60000);
    expect(obr().broadcast.sendMessage).not.toHaveBeenCalled();
    expect(obr().state.notifications.map((n) => [n.message, n.variant])).toEqual([[SEND_FAILED_MESSAGE, "ERROR"]]);
  });
});
