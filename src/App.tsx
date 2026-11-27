import Stack from "@mui/material/Stack";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";

import { InteractiveTray } from "./tray/InteractiveTray";
import { Sidebar } from "./controls/Sidebar";
import { TopControls } from "./controls/TopControls";
import { PluginGate } from "./plugin/PluginGate";
import { DiceRollSync } from "./plugin/DiceRollSync";
import { RollHistoryTray } from "./plugin/RollHistoryTray";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Typography from "@mui/material/Typography";

export function App() {
  return (
    <Container disableGutters maxWidth="md">
      <Stack direction="column" sx={{ height: "100vh", gap: 0.5 }}>
        {/* Top row with settings */}
        <TopControls />
        
        {/* Main content area */}
        <Box component="div" sx={{ display: "flex", flex: 1, gap: 0.5, overflow: "hidden" }}>
          <Sidebar />
          <InteractiveTray />
        </Box>
        
        <PluginGate>
          {/* A bad history entry must not unmount the tray, the controls or the sender */}
          <ErrorBoundary
            name="RollHistoryTray"
            fallback={() => (
              <Typography variant="caption" sx={{ opacity: 0.6, px: 1 }}>
                History unavailable
              </Typography>
            )}
          >
            <RollHistoryTray />
          </ErrorBoundary>
          <DiceRollSync />
        </PluginGate>
      </Stack>
    </Container>
  );
}
