import { beforeEach, describe, expect, it, vi } from "vitest";
import OBR, { Math2 } from "@owlbear-rodeo/sdk";
import { createClient, flushObr, hub, obr, resetObrMock } from "./obrMock";

vi.mock("@owlbear-rodeo/sdk", () => import("./obrMock").then((m) => m.createSdkModule()));

const CHANNEL = "test.ext/channel";

describe("obrMock", () => {
  beforeEach(() => {
    resetObrMock();
  });

  it("replaces the default export and keeps SDK math helpers", async () => {
    expect(OBR.isAvailable).toBe(true);
    expect(OBR.isReady).toBe(true);
    expect(await OBR.player.getRole()).toBe("GM");
    expect(Math2.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
  });

  describe("readiness", () => {
    it("onReady runs synchronously when ready", () => {
      const cb = vi.fn();
      OBR.onReady(cb);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("before ready: onReady waits, async methods reject, subscribe methods throw", async () => {
      const c = resetObrMock({ ready: false }).currentClient;
      const cb = vi.fn();
      OBR.onReady(cb);
      expect(cb).not.toHaveBeenCalled();
      await expect(OBR.player.getName()).rejects.toThrow("not ready");
      expect(() => OBR.broadcast.onMessage(CHANNEL, () => {})).toThrow("not ready");
      expect(() => OBR.player.id).toThrow("not ready");
      c.setReady();
      expect(cb).toHaveBeenCalledTimes(1);
      expect(OBR.isReady).toBe(true);
    });

    it("isAvailable can be false", () => {
      resetObrMock({ available: false });
      expect(OBR.isAvailable).toBe(false);
    });
  });

  describe("clients", () => {
    it("each client has its own identity and the current client is selectable", async () => {
      const gm = obr();
      const p = createClient({ id: "u2", connectionId: "c2", name: "Wren", color: "#4e9a06", role: "PLAYER" });
      expect(await OBR.player.getName()).toBe("GM");
      hub().setCurrentClient(p);
      expect(await OBR.player.getId()).toBe("u2");
      expect(await OBR.player.getConnectionId()).toBe("c2");
      expect(await OBR.player.getName()).toBe("Wren");
      expect(await OBR.player.getColor()).toBe("#4e9a06");
      expect(await OBR.player.getRole()).toBe("PLAYER");
      expect(gm.state.player.connectionId).not.toBe("c2");
    });

    it("two tabs of one user share id but not connection id", async () => {
      const a = createClient({ id: "same-user" });
      const b = createClient({ id: "same-user" });
      expect(await a.player.getId()).toBe(await b.player.getId());
      expect(await a.player.getConnectionId()).not.toBe(await b.player.getConnectionId());
    });

    it("party.getPlayers returns only the other players", async () => {
      const p2 = createClient({ name: "P2" });
      createClient({ name: "P3" });
      expect((await OBR.party.getPlayers()).map((p) => p.name)).toEqual(["P2", "P3"]);
      expect((await p2.party.getPlayers()).map((p) => p.name)).toEqual(["GM", "P3"]);
    });

    it("join, leave and player changes fire party.onChange on the others only", async () => {
      const gmParty = vi.fn();
      OBR.party.onChange(gmParty);
      const p2 = createClient({ name: "P2" });
      const p2Party = vi.fn();
      p2.party.onChange(p2Party);
      await flushObr();
      expect(gmParty).toHaveBeenLastCalledWith([expect.objectContaining({ name: "P2" })]);

      p2.setName("Renamed");
      await flushObr();
      expect(gmParty).toHaveBeenLastCalledWith([expect.objectContaining({ name: "Renamed" })]);
      expect(p2Party).not.toHaveBeenCalled();

      p2.leave();
      await flushObr();
      expect(gmParty).toHaveBeenLastCalledWith([]);
      expect(await OBR.party.getPlayers()).toEqual([]);
    });
  });

  describe("player metadata", () => {
    it("is a shallow top-level merge and undefined deletes a key", async () => {
      await OBR.player.setMetadata({ a: { x: 1, y: 2 }, b: 5 });
      await OBR.player.setMetadata({ a: { x: 9 }, b: undefined, c: "z" });
      expect(await OBR.player.getMetadata()).toEqual({ a: { x: 9 }, c: "z" });
    });

    it("is per connection and visible to others through the party", async () => {
      const p2 = createClient();
      await p2.player.setMetadata({ k: 1 });
      expect(await OBR.player.getMetadata()).toEqual({});
      const others = await OBR.party.getPlayers();
      expect(others[0].metadata).toEqual({ k: 1 });
    });

    it("fires player.onChange on the writer (own echo)", async () => {
      const cb = vi.fn();
      OBR.player.onChange(cb);
      await OBR.player.setMetadata({ k: 1 });
      await flushObr();
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ metadata: { k: 1 } }));
    });

    it("rejects an update over the size limit and keeps the old value", async () => {
      hub().limits.playerMetadataBytes = 100;
      await OBR.player.setMetadata({ k: 1 });
      await expect(OBR.player.setMetadata({ big: "x".repeat(200) })).rejects.toMatchObject({
        error: { name: "MetadataTooLarge" },
      });
      expect(await OBR.player.getMetadata()).toEqual({ k: 1 });
    });

    it("a write fires party.onChange on the others with the new metadata (doc 13.3)", async () => {
      const p2 = createClient();
      const cb = vi.fn();
      OBR.party.onChange(cb);
      await p2.player.setMetadata({ k: 2 });
      await flushObr();
      expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ metadata: { k: 2 } })]);
    });

    it("subscriptions deliver no initial value (doc 6.3)", async () => {
      await OBR.player.setMetadata({ k: 1 });
      await flushObr();
      const party = vi.fn();
      const player = vi.fn();
      OBR.party.onChange(party);
      OBR.player.onChange(player);
      await flushObr();
      expect(party).not.toHaveBeenCalled();
      expect(player).not.toHaveBeenCalled();
    });

    it("a page reload is a new connection: its player metadata starts empty (doc 5.1)", async () => {
      const p2 = createClient({ id: "user-2" });
      await p2.player.setMetadata({ k: 1 });
      p2.leave();
      const reloaded = createClient({ id: "user-2" });
      expect(await reloaded.player.getMetadata()).toEqual({});
      expect((await OBR.party.getPlayers()).map((p) => p.metadata)).toEqual([{}]);
    });

    it("returns clones, not shared references", async () => {
      await OBR.player.setMetadata({ a: { n: 1 } });
      const m = await OBR.player.getMetadata();
      (m.a as { n: number }).n = 99;
      expect(await OBR.player.getMetadata()).toEqual({ a: { n: 1 } });
    });
  });

  describe("broadcast", () => {
    function listenAll() {
      const gm = obr();
      const p2 = createClient();
      const p3 = createClient();
      const got = { gm: vi.fn(), p2: vi.fn(), p3: vi.fn() };
      gm.broadcast.onMessage(CHANNEL, got.gm);
      p2.broadcast.onMessage(CHANNEL, got.p2);
      p3.broadcast.onMessage(CHANNEL, got.p3);
      return { gm, p2, p3, got };
    }

    it("REMOTE (default) reaches the others, not the sender", async () => {
      const { got } = listenAll();
      await OBR.broadcast.sendMessage(CHANNEL, { n: 1 });
      await flushObr();
      expect(got.gm).not.toHaveBeenCalled();
      expect(got.p2).toHaveBeenCalledTimes(1);
      expect(got.p3).toHaveBeenCalledTimes(1);
    });

    it("LOCAL reaches only the sender", async () => {
      const { got } = listenAll();
      await OBR.broadcast.sendMessage(CHANNEL, { n: 1 }, { destination: "LOCAL" });
      await flushObr();
      expect(got.gm).toHaveBeenCalledTimes(1);
      expect(got.p2).not.toHaveBeenCalled();
    });

    it("ALL reaches everyone including the sender, with the sender's connection id", async () => {
      const { gm, p2, got } = listenAll();
      await p2.broadcast.sendMessage(CHANNEL, { n: 1 }, { destination: "ALL" });
      await flushObr();
      const event = { data: { n: 1 }, connectionId: p2.state.player.connectionId };
      expect(got.gm).toHaveBeenCalledWith(event);
      expect(got.p2).toHaveBeenCalledWith(event);
      expect(got.p3).toHaveBeenCalledWith(event);
      expect(gm.state.player.connectionId).not.toBe(p2.state.player.connectionId);
    });

    it("delivers asynchronously and as a copy", async () => {
      const cb = vi.fn();
      OBR.broadcast.onMessage(CHANNEL, cb);
      const data = { n: 1 };
      const sent = OBR.broadcast.sendMessage(CHANNEL, data, { destination: "LOCAL" });
      expect(cb).not.toHaveBeenCalled();
      await sent;
      await flushObr();
      expect(cb.mock.calls[0][0].data).toEqual(data);
      expect(cb.mock.calls[0][0].data).not.toBe(data);
    });

    it("only reaches listeners of the same channel", async () => {
      const cb = vi.fn();
      OBR.broadcast.onMessage("other/channel", cb);
      await OBR.broadcast.sendMessage(CHANNEL, 1, { destination: "ALL" });
      await flushObr();
      expect(cb).not.toHaveBeenCalled();
    });

    it("unsubscribe stops delivery", async () => {
      const cb = vi.fn();
      const off = OBR.broadcast.onMessage(CHANNEL, cb);
      off();
      await OBR.broadcast.sendMessage(CHANNEL, 1, { destination: "ALL" });
      await flushObr();
      expect(cb).not.toHaveBeenCalled();
    });

    it("is ephemeral: a client that joins later gets nothing", async () => {
      await OBR.broadcast.sendMessage(CHANNEL, 1);
      const late = createClient();
      const cb = vi.fn();
      late.broadcast.onMessage(CHANNEL, cb);
      await flushObr();
      expect(cb).not.toHaveBeenCalled();
    });

    it("a client that left gets nothing", async () => {
      const { p2, got } = listenAll();
      p2.leave();
      await OBR.broadcast.sendMessage(CHANNEL, 1);
      await flushObr();
      expect(got.p2).not.toHaveBeenCalled();
      expect(got.p3).toHaveBeenCalled();
    });

    it("rejects data over 16 kB by default (limit configurable)", async () => {
      await expect(OBR.broadcast.sendMessage(CHANNEL, "x".repeat(16 * 1024))).rejects.toMatchObject({
        error: { name: "MessageTooLarge" },
      });
      await expect(OBR.broadcast.sendMessage(CHANNEL, "x".repeat(16 * 1024 - 10))).resolves.toBeUndefined();
      hub().limits.broadcastBytes = 10;
      await expect(OBR.broadcast.sendMessage(CHANNEL, "x".repeat(20))).rejects.toBeDefined();
    });

    it("rejects data that is not JSON-serializable", async () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      await expect(OBR.broadcast.sendMessage(CHANNEL, cyclic)).rejects.toThrow("JSON");
    });

    it("rate limit (when configured) rejects with RateLimitHit, also for LOCAL, and recovers", async () => {
      let t = 0;
      hub().now = () => t;
      hub().limits.rateLimit = { maxMessages: 2, windowMs: 1000 };
      await OBR.broadcast.sendMessage(CHANNEL, 1);
      await OBR.broadcast.sendMessage(CHANNEL, 2, { destination: "LOCAL" });
      await expect(OBR.broadcast.sendMessage(CHANNEL, 3)).rejects.toMatchObject({
        error: { name: "RateLimitHit" },
      });
      // Other clients have their own budget.
      await expect(createClient().broadcast.sendMessage(CHANNEL, 4)).resolves.toBeUndefined();
      t = 1000;
      await expect(OBR.broadcast.sendMessage(CHANNEL, 5)).resolves.toBeUndefined();
    });
  });

  describe("popover, action, notification, theme", () => {
    it("popover open/size/close", async () => {
      await OBR.popover.open({ id: "p", url: "/x.html", width: 0, height: 0 });
      await OBR.popover.setWidth("p", 600);
      await OBR.popover.setHeight("p", 160);
      expect(await OBR.popover.getWidth("p")).toBe(600);
      expect(await OBR.popover.getHeight("p")).toBe(160);
      await OBR.popover.close("p");
      expect(obr().state.popovers.has("p")).toBe(false);
      await expect(OBR.popover.setHeight("p", 1)).rejects.toThrow("no open popover");
    });

    it("action isOpen and onOpenChange", async () => {
      const cb = vi.fn();
      OBR.action.onOpenChange(cb);
      expect(await OBR.action.isOpen()).toBe(true);
      obr().setActionOpen(false);
      await flushObr();
      expect(cb).toHaveBeenCalledWith(false);
      expect(await OBR.action.isOpen()).toBe(false);
      await OBR.action.setWidth(500);
      expect(await OBR.action.getWidth()).toBe(500);
    });

    it("notification show returns an id", async () => {
      const id = await OBR.notification.show("hello", "ERROR");
      expect(obr().state.notifications).toEqual([{ id, message: "hello", variant: "ERROR" }]);
    });

    it("theme getTheme and onChange", async () => {
      const cb = vi.fn();
      OBR.theme.onChange(cb);
      expect((await OBR.theme.getTheme()).mode).toBe("DARK");
      obr().setTheme({ ...(await OBR.theme.getTheme()), mode: "LIGHT" });
      await flushObr();
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ mode: "LIGHT" }));
    });
  });
});
