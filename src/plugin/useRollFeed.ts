import OBR, { Player } from "@owlbear-rodeo/sdk";
import { useEffect, useRef, useState } from "react";
import { createPartyDirectory, SenderIdentity } from "./partyDirectory";
import { IncomingRoll } from "./rollHistory";
import {
  HISTORY_METADATA_KEY,
  ParsedRoll,
  parseHistoryMetadata,
  parseRollBroadcast,
  ROLL_CHANNEL,
  warnInvalidOnce,
} from "./rollWire";

export interface BroadcastRoll {
  connectionId: string;
  identity: SenderIdentity;
  roll: ParsedRoll;
}

export interface RollFeedHandlers {
  /** A valid roll broadcast from a known connection (also this client's own, `identity.isSelf`). */
  onBroadcast?: (event: BroadcastRoll) => void;
  /**
   * Rolls read from the players' history metadata (OD-2). `initial` is the first read after the
   * party is known; later calls carry only players whose history changed.
   */
  onMetadata?: (items: IncomingRoll[], initial: boolean) => void;
}

const identitiesKey = (ids: Record<string, SenderIdentity>) => JSON.stringify(ids);

/**
 * The one place a receiver iframe listens to rolls: the roll broadcast channel, the party and the
 * player (one subscription each, made once; owlbear-platform.md 15 quirks 3-4). Every payload goes
 * through the validating parser; invalid ones are dropped with one `console.warn` per sender.
 * Returns the known sender identities (name, color, role from OBR), updated when they change.
 */
export function useRollFeed(handlers: RollFeedHandlers): Record<string, SenderIdentity> {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [identities, setIdentities] = useState<Record<string, SenderIdentity>>({});

  useEffect(() => {
    const directory = createPartyDirectory();
    let disposed = false;
    let lastIdentities = "";
    let metadataLoaded = false;
    /** Last raw history value per connection, so the noisy party.onChange is cheap. */
    const lastHistory = new Map<string, string>();

    const publishIdentities = () => {
      const ids = directory.identities();
      const key = identitiesKey(ids);
      if (key !== lastIdentities) {
        lastIdentities = key;
        setIdentities(ids);
      }
    };

    const readHistories = (players: Player[]): IncomingRoll[] => {
      const items: IncomingRoll[] = [];
      for (const player of players) {
        const raw = player.metadata?.[HISTORY_METADATA_KEY];
        const text = JSON.stringify(raw) ?? "";
        if (lastHistory.get(player.connectionId) === text) continue;
        lastHistory.set(player.connectionId, text);
        const { rolls, invalid } = parseHistoryMetadata(raw);
        if (invalid > 0) warnInvalidOnce("metadata", player.connectionId, raw);
        for (const roll of rolls) items.push({ connectionId: player.connectionId, roll });
      }
      return items;
    };
    const allPlayers = () => {
      const { others, self } = directory.players();
      return self ? [...others, self] : others;
    };

    const unsubscribePlayers = directory.subscribe(() => {
      publishIdentities();
      if (!metadataLoaded || !handlersRef.current.onMetadata) return;
      const items = readHistories(allPlayers());
      if (items.length > 0) handlersRef.current.onMetadata(items, false);
    });

    directory.ready.then(() => {
      if (disposed) return;
      publishIdentities();
      if (handlersRef.current.onMetadata) {
        handlersRef.current.onMetadata(readHistories(allPlayers()), true);
      }
      metadataLoaded = true;
    });

    const deliver = (connectionId: string, identity: SenderIdentity | undefined, roll: ParsedRoll) => {
      if (disposed) return;
      if (!identity) {
        warnInvalidOnce("broadcast", connectionId, "unknown sender connection");
        return;
      }
      handlersRef.current.onBroadcast?.({ connectionId, identity, roll });
    };

    let unsubscribeMessages: () => void = () => {};
    try {
      unsubscribeMessages = OBR.broadcast.onMessage(ROLL_CHANNEL, (event) => {
        const roll = parseRollBroadcast(event.data);
        if (!roll) {
          warnInvalidOnce("broadcast", String(event.connectionId), event.data);
          return;
        }
        const connectionId = event.connectionId;
        directory.ready.then(() => {
          const known = directory.resolve(connectionId);
          if (known) deliver(connectionId, known, roll);
          else directory.resolveAsync(connectionId).then((identity) => deliver(connectionId, identity, roll));
        });
      });
    } catch (e) {
      console.error("[savage-worlds-dice] could not listen to rolls", e);
    }

    return () => {
      disposed = true;
      unsubscribePlayers();
      unsubscribeMessages();
      directory.dispose();
    };
  }, []);

  return identities;
}
