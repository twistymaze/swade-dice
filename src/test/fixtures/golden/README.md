# Golden fixtures: current cross-client and persisted data

These files record the data format of the app **as it is now**, before any change.

> Since payload version 1 (`src/plugin/rollWire.ts`), these files are the **legacy** format: the app
> still reads them, and new payloads keep all their keys (plus `v`, `rollId`, `rev`). The app now also
> writes one player metadata key, `rodeo.owlbear.savage-worlds-dice/history`. See
> `docs/app-owlbear-integration.md` sections 5, 7 and 8.
Use them in tests to detect format changes and to test readers against old data.

## Summary

- The app writes **no** OBR player, room or scene metadata. All cross-client data is one
  broadcast channel: `rodeo.owlbear.savage-worlds-dice/roll-result`.
- Only **finished, not hidden** rolls are broadcast. A roll in progress is local state only.
- The payload has **no version field**.
- Persisted data is three `localStorage` keys (plain strings). The app uses no zustand `persist`
  and no `sessionStorage`.

## How the files were made

A throwaway script (not in the repo) loaded the real modules through Vite SSR
(`src/dice/store.ts`, `src/controls/store.ts`, `src/controls/history.ts`,
`src/hooks/useSavageWorldsResults.ts`, `src/sets/diceSets.ts`) and called the real store actions:
`changeDiceSet`, `changeDieCount`, `setModeChoice`, `getDiceToRoll`, `startRoll`,
`checkAndProcessExplosion` (with chosen face values in place of the physics result).
The script copied `handleRoll` from `src/controls/DiceRollControls.tsx:103-156`, the `Player` object
from `src/plugin/DiceRollSync.tsx:34-42` and the history reducer from
`src/plugin/RollHistoryTray.tsx:16-56`. `Math.random` was seeded and `Date.now` was fixed, so
`rollThrows` and `timestamp` values are stable but realistic.
Die ids (`"1"`, `"2"`, ...) come from the per-page counter in `src/helpers/generateDiceId.ts`.
The player id, name and color are invented.

## Files

| File | What it represents | Written by | Read by |
|---|---|---|---|
| `ids.json` | Every OBR id and storage key in use. Empty arrays mean "none". | `src/plugin/getPluginId.ts:2-4`, `src/controls/store.ts` | (reference) |
| `broadcast.event.traitWildDie.json` | The event object a listener gets: `{ data: RollBroadcast, connectionId }`. `connectionId` is set by the OBR host. | OBR host (from `DiceRollSync.tsx:133`) | `RollHistoryTray.tsx:16`, `NotificationPopover.tsx:45` |
| `broadcast.rollResult.traitWildDie.json` | `RollBroadcast`: d8 trait test + Wild Die, +1, TN 4. Wild die (5) replaces the trait die (3). | `DiceRollSync.tsx:101-110` and `:126-135` (`OBR.broadcast.sendMessage`, `destination: "ALL"`) | `RollHistoryTray.tsx:17-56`, `NotificationPopover.tsx:48-64` |
| `broadcast.rollResult.traitWildDie.modifierChanged.json` | Same roll re-broadcast after the roller changed the trait modifier to -2. Same `timestamp`, new `modifier`, `total`, `success`. Receivers replace the history entry. | `DiceRollSync.tsx:117-139` (fires on every `useSavageWorldsResults` change) | `RollHistoryTray.tsx:30-37` (update branch) |
| `broadcast.rollResult.traitNoWild.json` | d10 trait test, Wild Die off, rolls 9 vs TN 4: 1 raise. No wild chain. | as above | as above |
| `broadcast.rollResult.traitNoWild.rolledOne.json` | d6 trait test, Wild Die off, rolls 1. `success: false`, `raises: 0`. No critical-failure fields: they are computed at render time (`src/helpers/criticalFailure.ts`), not sent. | as above | as above |
| `broadcast.rollResult.multiTraitWildDie.json` | Multi-die trait test (mode forced to TRAIT): 2d8 + Wild Die. Wild die (4) replaces the worst d8 (2). Two outcomes. | as above | as above |
| `broadcast.rollResult.damage.json` | Damage roll d6 + d8, +2. One outcome with both chains. Note: damage outcomes also carry `success`/`raises` against the TN (`storeHelpers.ts:157-164`). | as above | as above |
| `broadcast.rollResult.explodingChain.json` | Trait d6 + Wild Die. The d6 aces twice: rolls `[6, 6, 3]`, total 15, 2 raises. | as above | as above |
| `broadcast.rollResult.damageExploding.json` | Damage 2d6, one die aces once: `[6, 2]` + `[3]` = 11. | as above | as above |
| `broadcast.rollResult.standard.json` | STANDARD mode (d4 + d12): raw values, no explosions (the d12 shows 12 and does not ace), no TN fields on outcomes. | as above | as above |
| `diceStore.inProgress.traitWildDie.json` | `useDiceRollStore` state right after `startRoll`: `rollValues`/`rollTransforms` all `null`, all dice in `pendingDice`, `currentRollResult: null`. **Local only, never sent.** | `src/dice/store.ts:115-148` | `DiceRollSync.tsx:60-97` (decides not to broadcast), tray components |
| `diceStore.explosionPending.json` | Mid-roll: die `"10"` showed 6, explosion die `"10_explosion_1"` is pending. **Local only.** | `src/dice/store.ts:219-295` | as above |
| `diceStore.finished.traitWildDie.json` | Store after the roll completes, with `currentRollResult` (before the hook adds `wildDieEnabled`). **Local only.** | `src/dice/store.ts:305-320` | `src/hooks/useSavageWorldsResults.ts:10` |
| `diceStore.finished.explodingChain.json` | Finished store with explosion dice `10_explosion_1`, `10_explosion_2`. **Local only.** | `src/dice/store.ts:271-295` | as above |
| `diceStore.cleared.json` | Store after `clearRoll`. `rollMode` is not reset by `clearRoll` (here it is left from the last STANDARD roll). Nothing is broadcast on clear. | `src/dice/store.ts:149-162` | `DiceRollSync.tsx:63-67` |
| `rollHistory.entries.json` | `RollHistoryEntry[]` held in `RollHistoryTray` React state after receiving the broadcasts above (the first entry shows the updated -2 modifier). In memory only; max 20; sorted by `timestamp`. | `RollHistoryTray.tsx:24-56` | `RollHistoryPanel.tsx:82-90`, `PlayerRollPill.tsx` |
| `rollHistory.empty.json` | Empty history (start state, after reload, late joiner). | `RollHistoryTray.tsx:12` | `RollHistoryPanel.tsx:57` |
| `diceHistory.recentRolls.json` | `useDiceHistoryStore.recentRolls` ("recent rolls" menu). In memory only, not shared, max 6 entries. | `src/controls/history.ts:30-37` via `DiceRollControls.tsx:143-151` | `src/controls/DiceHistory.tsx:81` |
| `localStorage.empty.json` | `localStorage` on first start (no keys). Defaults then apply: first non-NEBULA set, Wild Die on, TN 4. | (none) | `src/controls/store.ts:49-66`, `:85-96` |
| `localStorage.controls.json` | `localStorage` after the user picks the IRON set, turns the Wild Die off and sets TN 6. All values are strings. | `src/controls/store.ts:142`, `:217`, `:227` | `src/controls/store.ts:51`, `:87-92` |
| `popover.notification.open.json` | The argument to `OBR.popover.open` for the invisible notification popover. | `src/background.ts:6-16` | OBR host; `NotificationPopover.tsx:74-78` resizes it by this id |

## Types

- `RollBroadcast`: `src/plugin/DiceRollSync.tsx:9-13`
- `SavageRollResult` / `PlayerRollResult`, `DieChain`, `RollOutcome`: `src/types/SavageWorldsTypes.ts`
- `RollHistoryEntry` (the one in use): `src/types/SavageWorldsTypes.ts:87-96`
- `DiceRoll`: `src/types/DiceRoll.ts`; `DiceThrow`/`DiceTransform`: `src/types/`
