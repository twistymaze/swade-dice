import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";

import { SavageWorldsResultsSummary } from "../controls/SavageWorldsResultsSummary";
import { SavageWorldsResults } from "../controls/SavageWorldsResults";
import { SavageRollResult } from "../types/SavageWorldsTypes";
import { contrastTextColor, safeColor } from "./rollWire";

/** Who rolled: name and color from OBR (never from a payload). */
export interface PillPlayer {
  name: string;
  color: string;
}

export interface PlayerRollPillProps {
  player: PillPlayer;
  result?: SavageRollResult;
  showDicePrefix?: boolean;
}

export function PlayerRollPill({ player, result, showDicePrefix = false }: PlayerRollPillProps) {
  const theme = useTheme();
  const hasResult = result && result.outcomes && result.outcomes.length > 0;
  // Only a validated hex color reaches the styles
  const color = safeColor(player.color);

  const pillContent = (
    <Box
      component="div"
      sx={{
        display: "inline-flex",
        borderRadius: "16px",
        overflow: "hidden",
        cursor: "default",
        opacity: 0.9,
        alignItems: "center",
      }}
    >
      {/* Name section */}
      <Box
        component="div"
        sx={{
          backgroundColor: color,
          color: contrastTextColor(color),
          px: 2,
          py: 0.5,
          fontSize: "0.75rem",
          fontWeight: 500,
          maxWidth: "8em", // Roughly 8 characters
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {player.name}
      </Box>

      {/* Result section (only if there's a result) */}
      {hasResult && (
        <Box
          component="div"
          sx={{
            backgroundColor: theme.palette.mode === "dark"
              ? "rgba(0, 0, 0, 0.3)"
              : "rgba(0, 0, 0, 0.15)",
            color: theme.palette.mode === "dark" ? "white" : "black",
            px: 1.5,
            py: 0.5,
            fontSize: "0.75rem",
            display: "flex",
            alignItems: "center",
            borderTopRightRadius: "16px",
            borderBottomRightRadius: "16px",
          }}
        >
          <SavageWorldsResultsSummary
            result={result}
            hidePrefix={true}
            variant="body2"
            singleLine={true}
            fontSize="0.75rem"
            showDicePrefix={showDicePrefix}
            showModeIcon={true}
            showTargetNumber={true}
            textColor={theme.palette.mode === "dark" ? "white" : "black"}
            isDarkBackground={theme.palette.mode === "dark"}
          />
        </Box>
      )}
    </Box>
  );

  return hasResult ? (
    <Tooltip
      title={<SavageWorldsResults result={result} />}
      placement="bottom-start"
      arrow
      followCursor
      slotProps={{
        tooltip: {
          sx: {
            backgroundColor: "rgba(0, 0, 0, 0.9)",
            maxWidth: "300px",
            borderRadius: "4px",
            padding: "12px",
          }
        }
      }}
    >
      {pillContent}
    </Tooltip>
  ) : (
    pillContent
  );
}
