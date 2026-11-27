import { useEffect, useRef } from "react";
import { useDiceRollStore } from "../dice/store";
import { useSavageWorldsResults } from "../hooks/useSavageWorldsResults";
import { createRollSender, RollSender, RollSenderOptions } from "./rollSender";

/**
 * Send this client's finished rolls to the table (broadcast) and keep the player's roll history in
 * player metadata. The sending rules are in `rollSender.ts`. Rendered inside `PluginGate`.
 *
 * The result is `useSavageWorldsResults()`, so a post-roll edit of TN, modifier or Wild Die (OD-1)
 * sends a new revision of the same roll. `hidden` and `rollId` come from the finished roll itself
 * (B-12), not from live control state.
 */
export function DiceRollSync(props: { options?: RollSenderOptions }) {
  const result = useSavageWorldsResults();
  const stored = useDiceRollStore((state) => state.currentRollResult);
  const senderRef = useRef<RollSender | null>(null);
  const optionsRef = useRef(props.options);

  useEffect(() => {
    const sender = createRollSender(optionsRef.current);
    senderRef.current = sender;
    void sender.start();
    return () => {
      sender.dispose();
      senderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!result || !stored || !result.isComplete) return;
    senderRef.current?.update({ rollId: stored.rollId, hidden: stored.hidden }, result);
  }, [result, stored]);

  return null;
}
