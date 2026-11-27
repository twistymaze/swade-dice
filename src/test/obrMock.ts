/**
 * In-memory multi-client fake of `@owlbear-rodeo/sdk` for Vitest.
 * Modeled on ../swade-initiative-tracker/src/test/obrMock.ts and on docs/owlbear-platform.md.
 *
 * Usage in a test file:
 *
 *   vi.mock("@owlbear-rodeo/sdk", () => import("./obrMock").then((m) => m.createSdkModule()));
 *   import { obr, hub, resetObrMock, flushObr } from "./obrMock";
 *   beforeEach(() => { resetObrMock(); });
 *
 * App code that does `import OBR from "@owlbear-rodeo/sdk"` talks to the hub's *current client*
 * (`hub().setCurrentClient(c)` picks it). API methods are `vi.fn` spies.
 *
 * Model:
 * - The hub is one room: the list of connected clients and the broadcast bus.
 * - A client is one connection (one browser tab). All iframes of the extension in that tab
 *   (action popover, background page, notification popover) share the client, its connection id and
 *   its listeners. A test that renders two of the app's iframes in one process gets that for free.
 * - Readiness (platform doc 3.1, 3.2): `onReady` runs the callback synchronously when the client is
 *   ready, otherwise once when `client.setReady()` is called. While not ready, async methods reject
 *   with "Unable to send message: not ready" and subscribe methods throw synchronously.
 * - Events go to each listener as its own JSON clone in a microtask. `await flushObr()` lets them run.
 * - Broadcast (doc 8): REMOTE (default) = other clients only, LOCAL = the sender only,
 *   ALL = every client including the sender. The event is `{ data, connectionId }` with the
 *   SENDER's connection id. Data must be JSON-serializable and at most `hub.limits.broadcastBytes`
 *   (16 kB). Messages to a channel with no listener are lost (ephemeral). Every send (also LOCAL)
 *   counts against the rate limit `hub.limits.rateLimit` (off by default because the real numbers
 *   are not published); a send over the limit rejects with `{ error: { name: "RateLimitHit" } }`.
 * - Player metadata (doc 5.1, 6.1): per connection, shallow top-level merge, `undefined` deletes a
 *   key, an update over `hub.limits.playerMetadataBytes` (64 kB) rejects and changes nothing.
 *   `player.onChange` fires on the writer, `party.onChange` on every other client.
 * - Party (doc 13.2): `getPlayers()` returns the OTHER clients. Joining (`hub.createClient`),
 *   leaving (`client.leave()`) and any player change fire `party.onChange` on the others.
 */
import { vi } from "vitest";
import type { Metadata, Player, Theme } from "@owlbear-rodeo/sdk";

export type Role = "GM" | "PLAYER";
export type Destination = "REMOTE" | "LOCAL" | "ALL";
export type BroadcastEvent = { data: unknown; connectionId: string };
type Listener<T> = (value: T) => void;
// The SDK's Popover shape; kept loose on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export interface ClientOptions {
  id?: string;
  connectionId?: string;
  name?: string;
  color?: string;
  role?: Role;
  metadata?: Metadata;
  /** Start not ready (default true = ready). */
  ready?: boolean;
  /** `OBR.isAvailable` (default true). */
  available?: boolean;
  /** Initial `OBR.action.isOpen()` (default true). */
  actionOpen?: boolean;
}

export interface MockLimits {
  /** Max JSON bytes of one broadcast `data` (doc 8: 16 kB). */
  broadcastBytes: number;
  /** Max JSON bytes of one player `setMetadata` update (doc 5.1: 64 kB per update). */
  playerMetadataBytes: number;
  /** At most `maxMessages` sends per client in any `windowMs`; `undefined` = no limit. */
  rateLimit?: { maxMessages: number; windowMs: number };
}

export const DEFAULT_LIMITS: MockLimits = {
  broadcastBytes: 16 * 1024,
  playerMetadataBytes: 64 * 1024,
  rateLimit: undefined,
};

export const DEFAULT_THEME: Theme = {
  mode: "DARK",
  primary: { light: "#ebcdff", main: "#bb99ff", dark: "#8a6acc", contrastText: "#000" },
  secondary: { light: "#ffa5b8", main: "#ee99ff", dark: "#bb66cc", contrastText: "#000" },
  background: { default: "#1e2231", paper: "#222639" },
  text: { primary: "#fff", secondary: "rgba(255,255,255,0.7)", disabled: "rgba(255,255,255,0.5)" },
};

/** The host's rate limit rejection payload (doc 4.2). */
export const rateLimitError = () => ({ error: { name: "RateLimitHit", message: "Too many requests" } });

const NOT_READY = "Unable to send message: not ready";

const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) ?? "").length;

/** Shallow top-level merge; `undefined` deletes the key (doc 6.1). */
export function mergeMetadata(target: Metadata, patch: Partial<Metadata>): Metadata {
  const next: Metadata = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = clone(value);
  }
  return next;
}

/** Listener set. Each listener gets its own clone, delivered in a microtask. */
class Emitter<T> {
  private listeners = new Set<Listener<T>>();
  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  emit(value: T) {
    for (const fn of [...this.listeners]) {
      const copy = clone(value);
      queueMicrotask(() => {
        if (this.listeners.has(fn)) fn(copy);
      });
    }
  }
  clear() {
    this.listeners.clear();
  }
  get size() {
    return this.listeners.size;
  }
}

/** Await after a write to let async listeners (and their awaits) run. */
export async function flushObr(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

let clientCounter = 0;

export type ObrClient = ReturnType<typeof buildClient>;

function buildClient(hub: ObrHub, options: ClientOptions) {
  clientCounter++;
  const n = clientCounter;
  const state = {
    ready: options.ready ?? true,
    available: options.available ?? true,
    connected: true,
    player: {
      id: options.id ?? `player-${n}`,
      connectionId: options.connectionId ?? `conn-${n}`,
      role: options.role ?? "PLAYER",
      name: options.name ?? `Player ${n}`,
      color: options.color ?? "#ff0000",
      syncView: false,
      selection: [],
      metadata: clone(options.metadata ?? {}),
    } as Player,
    theme: clone(DEFAULT_THEME),
    action: { height: 700, width: 375, isOpen: options.actionOpen ?? true, badgeText: undefined as string | undefined },
    popovers: new Map<string, Loose>(),
    notifications: [] as { id: string; message: string; variant?: string }[],
    /** Send times (ms) for the rate limit window. */
    sendTimes: [] as number[],
  };
  const readyCallbacks: (() => void)[] = [];
  const emitters = {
    player: new Emitter<Player>(),
    party: new Emitter<Player[]>(),
    theme: new Emitter<Theme>(),
    actionOpen: new Emitter<boolean>(),
    broadcast: new Map<string, Emitter<BroadcastEvent>>(),
  };

  const assertReady = () => {
    if (!state.ready) throw new Error(NOT_READY);
  };
  /** Async SDK method: rejects before ready. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asyncFn = <A extends any[], R>(fn: (...args: A) => R | Promise<R>) =>
    vi.fn(async (...args: A): Promise<R> => {
      assertReady();
      return fn(...args);
    });
  /** Subscribe SDK method: throws synchronously before ready. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subFn = <A extends any[]>(fn: (...args: A) => () => void) =>
    vi.fn((...args: A): (() => void) => {
      assertReady();
      return fn(...args);
    });

  const updatePlayer = (patch: Partial<Player>): void => {
    state.player = { ...state.player, ...patch };
    emitters.player.emit(state.player);
    hub.notifyParty(client);
  };

  const popoverField = (id: string, field: "width" | "height") => {
    const p = state.popovers.get(id);
    if (!p) throw new Error(`obrMock: no open popover with id "${id}"`);
    return { p, field };
  };

  const client = {
    // ---------- test-only handles (not part of the SDK) ----------
    hub,
    state,
    emitters,
    /** Make the SDK ready and run pending onReady callbacks. */
    setReady: () => {
      state.ready = true;
      for (const cb of readyCallbacks.splice(0)) cb();
    },
    setRole: (role: Role) => updatePlayer({ role }),
    setName: (name: string) => updatePlayer({ name }),
    setColor: (color: string) => updatePlayer({ color }),
    setTheme: (theme: Theme) => {
      state.theme = clone(theme);
      emitters.theme.emit(state.theme);
    },
    /** Open or close the action popover and fire onOpenChange. */
    setActionOpen: (open: boolean) => {
      state.action.isOpen = open;
      emitters.actionOpen.emit(open);
    },
    /** Disconnect: the other clients see a party change, this client's listeners stop. */
    leave: (): void => hub.removeClient(client),

    // ---------- SDK surface ----------
    get isAvailable() {
      return state.available;
    },
    get isReady() {
      return state.ready;
    },
    onReady: vi.fn((cb: () => void) => {
      if (state.ready) cb();
      else readyCallbacks.push(cb);
    }),

    player: {
      get id() {
        assertReady();
        return state.player.id;
      },
      getId: asyncFn(() => state.player.id),
      getConnectionId: asyncFn(() => state.player.connectionId),
      getRole: asyncFn(() => state.player.role),
      getName: asyncFn(() => state.player.name),
      setName: asyncFn((name: string) => updatePlayer({ name })),
      getColor: asyncFn(() => state.player.color),
      setColor: asyncFn((color: string) => updatePlayer({ color })),
      getSelection: asyncFn(() => clone(state.player.selection)),
      getMetadata: asyncFn(() => clone(state.player.metadata)),
      setMetadata: asyncFn((patch: Partial<Metadata>) => {
        if (jsonBytes(patch) > hub.limits.playerMetadataBytes) {
          throw { error: { name: "MetadataTooLarge", message: "obrMock: player metadata update over size limit" } };
        }
        updatePlayer({ metadata: mergeMetadata(state.player.metadata, patch) });
      }),
      onChange: subFn((cb: Listener<Player>) => emitters.player.on(cb)),
    },

    party: {
      getPlayers: asyncFn((): Player[] => clone(hub.otherPlayers(client))),
      onChange: subFn((cb: Listener<Player[]>) => emitters.party.on(cb)),
    },

    broadcast: {
      sendMessage: asyncFn((channel: string, data: unknown, options?: { destination?: Destination }): void =>
        hub.broadcast(client, channel, data, options?.destination ?? "REMOTE")
      ),
      onMessage: subFn((channel: string, cb: Listener<BroadcastEvent>) => {
        let emitter = emitters.broadcast.get(channel);
        if (!emitter) {
          emitter = new Emitter<BroadcastEvent>();
          emitters.broadcast.set(channel, emitter);
        }
        return emitter.on(cb);
      }),
    },

    popover: {
      open: asyncFn((popover: Loose) => {
        state.popovers.set(popover.id, clone(popover));
      }),
      close: asyncFn((id: string) => {
        state.popovers.delete(id);
      }),
      getWidth: asyncFn((id: string) => {
        const { p, field } = popoverField(id, "width");
        return p[field] as number | undefined;
      }),
      setWidth: asyncFn((id: string, width: number) => {
        const { p } = popoverField(id, "width");
        p.width = width;
      }),
      getHeight: asyncFn((id: string) => {
        const { p, field } = popoverField(id, "height");
        return p[field] as number | undefined;
      }),
      setHeight: asyncFn((id: string, height: number) => {
        const { p } = popoverField(id, "height");
        p.height = height;
      }),
    },

    action: {
      getWidth: asyncFn(() => state.action.width),
      setWidth: asyncFn((width: number) => {
        state.action.width = width;
      }),
      getHeight: asyncFn(() => state.action.height),
      setHeight: asyncFn((height: number) => {
        state.action.height = height;
      }),
      getBadgeText: asyncFn(() => state.action.badgeText),
      setBadgeText: asyncFn((text?: string) => {
        state.action.badgeText = text;
      }),
      isOpen: asyncFn(() => state.action.isOpen),
      open: asyncFn((): void => client.setActionOpen(true)),
      close: asyncFn((): void => client.setActionOpen(false)),
      onOpenChange: subFn((cb: Listener<boolean>) => emitters.actionOpen.on(cb)),
    },

    notification: {
      show: asyncFn((message: string, variant?: string) => {
        const id = `notification-${state.notifications.length + 1}`;
        state.notifications.push({ id, message, variant });
        return id;
      }),
      close: asyncFn((id: string) => {
        state.notifications = state.notifications.filter((x) => x.id !== id);
      }),
    },

    theme: {
      getTheme: asyncFn(() => clone(state.theme)),
      onChange: subFn((cb: Listener<Theme>) => emitters.theme.on(cb)),
    },
  };
  return client;
}

/** One room shared by any number of clients. */
export class ObrHub {
  readonly clients: ObrClient[] = [];
  currentClient: ObrClient;
  limits: MockLimits = { ...DEFAULT_LIMITS };
  /** Clock for the rate limit; tests may replace it. */
  now: () => number = () => Date.now();

  constructor(first: ClientOptions = { id: "player-gm", name: "GM", role: "GM" }) {
    this.currentClient = this.createClient(first);
  }

  /** Connect a client. The others get `party.onChange`. */
  createClient(options: ClientOptions = {}): ObrClient {
    const client = buildClient(this, options);
    this.clients.push(client);
    this.notifyParty(client);
    return client;
  }

  removeClient(client: ObrClient): void {
    const i = this.clients.indexOf(client);
    if (i < 0) return;
    this.clients.splice(i, 1);
    client.state.connected = false;
    client.emitters.broadcast.forEach((e) => e.clear());
    this.notifyParty(client);
  }

  /** Pick which client the default `OBR` export represents. */
  setCurrentClient(client: ObrClient): void {
    this.currentClient = client;
  }

  otherPlayers(client: ObrClient): Player[] {
    return this.clients.filter((c) => c !== client).map((c) => c.state.player);
  }

  /** Tell every client except `changed` that the party changed. */
  notifyParty(changed: ObrClient): void {
    for (const c of this.clients) {
      if (c !== changed) c.emitters.party.emit(this.otherPlayers(c));
    }
  }

  broadcast(from: ObrClient, channel: string, data: unknown, destination: Destination): void {
    if (!from.state.connected) throw new Error("obrMock: client has left the room");
    let json: string | undefined;
    try {
      json = JSON.stringify(data);
    } catch {
      json = undefined;
    }
    if (json === undefined) throw new TypeError("obrMock: broadcast data is not JSON-serializable");
    if (new TextEncoder().encode(json).length > this.limits.broadcastBytes) {
      throw { error: { name: "MessageTooLarge", message: "obrMock: broadcast over size limit" } };
    }
    const rate = this.limits.rateLimit;
    if (rate) {
      const t = this.now();
      from.state.sendTimes = from.state.sendTimes.filter((s) => t - s < rate.windowMs);
      if (from.state.sendTimes.length >= rate.maxMessages) throw rateLimitError();
      from.state.sendTimes.push(t);
    }
    const event: BroadcastEvent = { data: JSON.parse(json), connectionId: from.state.player.connectionId };
    for (const c of this.clients) {
      const isSelf = c === from;
      if (destination === "REMOTE" && isSelf) continue;
      if (destination === "LOCAL" && !isSelf) continue;
      c.emitters.broadcast.get(channel)?.emit(event);
    }
  }
}

// ---------------- module-level default hub + helpers ----------------

// Kept on globalThis so that a copy of this module loaded after vi.resetModules() (e.g. through the
// vi.mock factory) shares the same room with the test file.
const holder = globalThis as { __obrMockHub?: ObrHub };
holder.__obrMockHub ??= new ObrHub();
const getHub = () => holder.__obrMockHub as ObrHub;

/** The current shared hub (room). */
export const hub = () => getHub();
/** The current client (what app code sees as `OBR`). */
export const obr = () => getHub().currentClient;

/** Fresh room with one client (a GM by default) as the current client. Call in beforeEach. */
export function resetObrMock(first?: ClientOptions): ObrHub {
  holder.__obrMockHub = new ObrHub(first);
  return holder.__obrMockHub;
}

/** Connect another client to the current room. */
export const createClient = (options?: ClientOptions) => getHub().createClient(options);

/**
 * Default export stand-in: every property reads through to the current client at access time, so
 * resetObrMock()/setCurrentClient() take effect for modules that captured `OBR` at import.
 */
const OBRProxy = new Proxy({} as ObrClient, {
  get: (_t, prop) => Reflect.get(getHub().currentClient, prop),
  has: (_t, prop) => prop in getHub().currentClient,
});

/**
 * Module factory for `vi.mock("@owlbear-rodeo/sdk", ...)`. Re-exports the SDK's pure math helpers
 * and replaces the default export with the fake. Builders are not provided (the app uses none).
 */
export async function createSdkModule() {
  const math = await import("@owlbear-rodeo/sdk/lib/math");
  return { ...math, default: OBRProxy };
}
