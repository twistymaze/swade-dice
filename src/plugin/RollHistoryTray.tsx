import { useReducer } from "react";

import Box from "@mui/material/Box";

import { RollHistoryPanel } from "./RollHistoryPanel";
import { EMPTY_HISTORY, historyReducer } from "./rollHistory";
import { useRollFeed } from "./useRollFeed";

/**
 * The party roll history (action popover). Built from the players' history metadata on load and
 * on party changes, plus live roll broadcasts, in arrival order (see `rollHistory.ts`).
 */
export function RollHistoryTray() {
  const [history, dispatch] = useReducer(historyReducer, EMPTY_HISTORY);

  const identities = useRollFeed({
    onBroadcast: ({ connectionId, roll }) =>
      dispatch({ type: "broadcast", item: { connectionId, roll }, now: Date.now() }),
    onMetadata: (items, initial) =>
      dispatch(initial ? { type: "initial", items, now: Date.now() } : { type: "metadata", items }),
  });

  return (
    <Box component="div" sx={{ width: "auto" }}>
      <RollHistoryPanel entries={history.entries} identities={identities} />
    </Box>
  );
}
