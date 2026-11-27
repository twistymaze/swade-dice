import { SavageWorldsResultsSummary } from "../controls/SavageWorldsResultsSummary";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { SavageRollResult } from "../types/SavageWorldsTypes";

export interface RollNotificationProps {
  /** Sender name from OBR (never from the payload, C-02). Long names are cut with an ellipsis (C-07). */
  name: string;
  result: SavageRollResult;
  /** The roller changed TN, modifier or Wild Die after the roll (OD-7). */
  revised?: boolean;
}

export function RollNotification({ name, result, revised = false }: RollNotificationProps) {
  const theme = useTheme();

  return (
    <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
      <Paper
        elevation={8}
        sx={{
          py: 1.5,
          px: 4,
          display: "inline-flex",
          alignItems: "center",
          gap: 1,
          maxWidth: 600,
        }}
      >
        <Typography variant="body2" component="span" noWrap sx={{ maxWidth: "16em", flexShrink: 0 }}>
          {name}:
        </Typography>
        <SavageWorldsResultsSummary
          result={result}
          hidePrefix={true}
          variant="body2"
          singleLine={true}
          showDicePrefix={true}
          showModeIcon={true}
          showTargetNumber={true}
          textColor={theme.palette.mode === "dark" ? "white" : "black"}
          isDarkBackground={theme.palette.mode === "dark"}
        />
        {revised && (
          <Typography variant="body2" component="span" sx={{ opacity: 0.7, fontStyle: "italic" }}>
            (revised)
          </Typography>
        )}
      </Paper>
    </div>
  );
}
