/**
 * Who is who in the room, from the OBR host only.
 *
 * A broadcast's sender is `event.connectionId` (set by the host). It is resolved through
 * `OBR.party` (the other players) and `OBR.player` (this client). Name, color and role are never
 * read from a payload. Players who left keep their last known name and color, so their history
 * entries still show who rolled.
 */
import OBR, { Player } from "@owlbear-rodeo/sdk";
import { safeColor, safeName } from "./rollWire";

export interface SenderIdentity {
  connectionId: string;
  name: string;
  /** `#rrggbb` (validated) */
  color: string;
  role: "GM" | "PLAYER";
  isSelf: boolean;
}

export type PlayersListener = (others: Player[], self: Player | null) => void;

export type PartyDirectory = ReturnType<typeof createPartyDirectory>;

function identityOf(player: Player, isSelf: boolean): SenderIdentity {
  return {
    connectionId: player.connectionId,
    name: safeName(player.name),
    color: safeColor(player.color),
    role: player.role === "GM" ? "GM" : "PLAYER",
    isSelf,
  };
}

/** Subscribes at once: call only after `OBR.onReady` (inside `PluginGate`). */
export function createPartyDirectory() {
  const known = new Map<string, SenderIdentity>();
  const listeners = new Set<PlayersListener>();
  let others: Player[] = [];
  let self: Player | null = null;
  let othersFromEvent = false;
  let disposed = false;

  const emit = () => {
    for (const listener of [...listeners]) listener(others, self);
  };
  const setOthers = (players: Player[]) => {
    others = players;
    for (const p of players) if (p.connectionId !== self?.connectionId) known.set(p.connectionId, identityOf(p, false));
    emit();
  };
  const setSelf = (player: Player) => {
    self = player;
    known.set(player.connectionId, identityOf(player, true));
    emit();
  };

  const unsubscribers = [
    OBR.party.onChange((players) => {
      if (disposed) return;
      othersFromEvent = true;
      setOthers(players);
    }),
    OBR.player.onChange((player) => {
      if (!disposed) setSelf(player);
    }),
  ];

  async function refresh() {
    const players = await OBR.party.getPlayers();
    if (!disposed) setOthers(players);
  }

  const ready: Promise<void> = (async () => {
    try {
      const [connectionId, id, name, color, role, metadata, players] = await Promise.all([
        OBR.player.getConnectionId(),
        OBR.player.getId(),
        OBR.player.getName(),
        OBR.player.getColor(),
        OBR.player.getRole(),
        OBR.player.getMetadata(),
        OBR.party.getPlayers(),
      ]);
      if (disposed) return;
      if (!self) setSelf({ id, connectionId, name, color, role, metadata, syncView: false } as Player);
      if (!othersFromEvent) setOthers(players);
    } catch (e) {
      console.error("[savage-worlds-dice] could not read the party", e);
    }
  })();

  return {
    ready,
    /** Identity of a connection, or undefined when the host never reported it. */
    resolve: (connectionId: string): SenderIdentity | undefined => known.get(connectionId),
    /** As `resolve`, but asks OBR for the party once more when the connection is unknown. */
    async resolveAsync(connectionId: string): Promise<SenderIdentity | undefined> {
      await ready;
      if (!known.has(connectionId)) {
        try {
          await refresh();
        } catch (e) {
          console.error("[savage-worlds-dice] could not refresh the party", e);
        }
      }
      return known.get(connectionId);
    },
    identities: (): Record<string, SenderIdentity> => Object.fromEntries(known),
    players: () => ({ others, self }),
    subscribe(listener: PlayersListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  };
}
