import { useEffect, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { Fade } from "@mui/material";
import { RollNotification } from "./RollNotification";
import { getPluginId } from "./getPluginId";
import { useRollFeed } from "./useRollFeed";
import { entryKey } from "./rollHistory";
import { REVISION_TOAST_DELAY_MS, TOAST_DURATION_MS } from "./toastTiming";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SavageRollResult } from "../types/SavageWorldsTypes";

const POPOVER_ID = getPluginId("notification-popover");
const SEEN_LIMIT = 200;

interface Toast {
  id: number;
  name: string;
  result: SavageRollResult;
  revised: boolean;
}

/** Collapses the popover when a toast fails to render, so no empty iframe blocks clicks. */
function ToastCrashed({ onCrash }: { onCrash: () => void }) {
  useEffect(() => {
    onCrash();
  }, [onCrash]);
  return null;
}

/**
 * Toasts other players' rolls while the action popover is closed.
 * - One subscription per event type, made once; the open state is kept in a ref.
 * - No toast for this client's own roll.
 * - A new roll toasts at once. A revision of a roll toasts once after the edits settle, marked
 *   "revised". An older or identical revision toasts nothing.
 */
export function NotificationPopover() {
  const [toast, setToast] = useState<Toast | null>(null);
  const [show, setShow] = useState(false);
  const openRef = useRef<boolean | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reviseTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seen = useRef(new Map<string, { rev: number; json: string }>());
  const toastCounter = useRef(0);

  useEffect(() => {
    const timers = reviseTimers.current;
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Action popover open state: read once, then follow changes
  useEffect(() => {
    let disposed = false;
    OBR.action
      .isOpen()
      .then((open) => {
        if (!disposed && openRef.current === null) openRef.current = open;
      })
      .catch((e: unknown) => console.error("[savage-worlds-dice]", e));
    const unsubscribe = OBR.action.onOpenChange((isOpen) => {
      openRef.current = isOpen;
      if (isOpen) {
        setShow(false);
        if (hideTimer.current) clearTimeout(hideTimer.current);
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const showToast = async (name: string, result: SavageRollResult, revised: boolean) => {
    let open = openRef.current;
    if (open === null) open = await OBR.action.isOpen().catch(() => true);
    if (open) return;
    toastCounter.current += 1;
    setToast({ id: toastCounter.current, name, result, revised });
    setShow(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShow(false), TOAST_DURATION_MS);
  };

  useRollFeed({
    onBroadcast: ({ connectionId, identity, roll }) => {
      const key = entryKey(connectionId, roll.rollId);
      const json = JSON.stringify(roll.result);
      const previous = seen.current.get(key);
      if (previous && (roll.rev < previous.rev || json === previous.json)) return;
      seen.current.delete(key);
      seen.current.set(key, { rev: roll.rev, json });
      if (seen.current.size > SEEN_LIMIT) seen.current.delete(seen.current.keys().next().value as string);
      if (identity.isSelf) return;
      if (!previous) {
        void showToast(identity.name, roll.result, false);
        return;
      }
      const timers = reviseTimers.current;
      const pending = timers.get(key);
      if (pending) clearTimeout(pending);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          void showToast(identity.name, roll.result, true);
        }, REVISION_TOAST_DELAY_MS)
      );
    },
  });

  // Popover size follows the toast; errors are logged, not left unhandled (B-11d)
  useEffect(() => {
    const visible = show && toast !== null;
    const width = visible ? 600 : 0;
    const height = visible ? 160 : 0;
    Promise.all([OBR.popover.setWidth(POPOVER_ID, width), OBR.popover.setHeight(POPOVER_ID, height)]).catch(
      (e: unknown) => console.error("[savage-worlds-dice] could not resize the notification popover", e)
    );
  }, [show, toast]);

  const hide = () => setShow(false);

  return show && toast ? (
    <Fade in timeout={300}>
      <div>
        <ErrorBoundary key={toast.id} name="RollNotification" fallback={() => <ToastCrashed onCrash={hide} />}>
          <RollNotification name={toast.name} result={toast.result} revised={toast.revised} />
        </ErrorBoundary>
      </div>
    </Fade>
  ) : null;
}
