import { useEffect, useRef } from "react";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import Paper from "@mui/material/Paper";

import { PlayerRollPill } from "./PlayerRollPill";
import { HISTORY_LIMIT, HistoryEntry } from "./rollHistory";
import { SenderIdentity } from "./partyDirectory";
import { FALLBACK_COLOR } from "./rollWire";
import { ErrorBoundary } from "../components/ErrorBoundary";

const UNKNOWN_PLAYER = { name: "Unknown", color: FALLBACK_COLOR };

export function RollHistoryPanel({
  entries,
  identities,
}: {
  entries: HistoryEntry[];
  identities: Record<string, SenderIdentity>;
}) {
  // The list is capped by the reducer; cap the render too
  const rollHistory = entries.slice(-HISTORY_LIMIT);
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const prevHistoryIds = useRef<Set<string>>(new Set());
  
  // Auto-scroll to bottom when new entries are added
  useEffect(() => {
    const currentIds = new Set(rollHistory.map(entry => entry.key));
    const hasNewEntry = rollHistory.some(entry => !prevHistoryIds.current.has(entry.key));
    
    if (hasNewEntry && containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
    
    prevHistoryIds.current = currentIds;
  }, [rollHistory]);

  return (
    <Box component="div">
      <Paper
        elevation={8}
        sx={{
          width: "100%",
          borderRadius: 0,
          paddingTop: 0,
        backgroundColor: "rgba(0, 0, 0, 0.1)",        }}
      >
        <Box 
          component="div"
          ref={containerRef} 
          sx={{ 
          height: "104px",
          overflow: "scroll",
            overflowY: 'auto',
            overflowX: 'hidden',
            p: 1,
          }}
        >
          {rollHistory.length === 0 ? (
            <Box
              component="div"
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                opacity: 0.6,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  color: theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.6)",
                  fontSize: "0.75rem",
                  textAlign: "center",
                  fontStyle: "italic",
                }}
              >
                Party dice rolls appear here
              </Typography>
            </Box>
          ) : (
            <Stack spacing={0.5}>
              {rollHistory.map(entry => (
                // One bad entry hides only itself
                <ErrorBoundary key={entry.key} name="PlayerRollPill" fallback={() => null}>
                  <PlayerRollPill
                    player={identities[entry.connectionId] ?? UNKNOWN_PLAYER}
                    result={entry.result}
                    showDicePrefix={true}
                  />
                </ErrorBoundary>
              ))}
            </Stack>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
