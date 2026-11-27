import { useEffect } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { NotificationPopover } from "./NotificationPopover";
import { PluginGate } from "./PluginGate";
import { PluginThemeProvider } from "./PluginThemeProvider";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { getPluginId } from "./getPluginId";

/** After a crash, make the popover 0 x 0 so an empty iframe does not block clicks in OBR (C-01). */
function CollapsePopover() {
  useEffect(() => {
    const id = getPluginId("notification-popover");
    Promise.all([OBR.popover.setWidth(id, 0), OBR.popover.setHeight(id, 0)]).catch((e: unknown) =>
      console.error("[savage-worlds-dice] could not collapse the notification popover", e)
    );
  }, []);
  return null;
}

export function PopoverApp() {
  return (
    <PluginGate>
      <PluginThemeProvider>
        <ErrorBoundary name="NotificationPopover" fallback={() => <CollapsePopover />}>
          <NotificationPopover />
        </ErrorBoundary>
      </PluginThemeProvider>
    </PluginGate>
  );
}
