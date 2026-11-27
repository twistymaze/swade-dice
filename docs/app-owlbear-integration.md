# How this app integrates with Owlbear Rodeo

This document describes the code of this repository as it is now. For the OBR platform itself, see
[owlbear-platform.md](owlbear-platform.md). Line references are `file:line` in this repository.
Example payloads are in [`src/test/fixtures/golden/`](../src/test/fixtures/golden/README.md).

## 1. Summary

- The app has three entry points: the dice tray (OBR action popover), a hidden background page, and an
  invisible notification popover.
- Each client rolls its dice **locally** with Rapier physics. The physics is **not** replayed on other
  clients. Other clients get only the finished result.
- The finished result goes to everyone through **one broadcast channel**,
  `rodeo.owlbear.savage-worlds-dice/roll-result`. The app writes **no** player, room or scene metadata.
- The roll history is in-memory React state in each client. It is not stored anywhere.
- Settings (dice set, Wild Die on/off, target number) are in `localStorage`.

## 2. Entry points

Vite builds three HTML pages (`vite.config.ts:18-22`). The manifest is `public/manifest.json`.

| Page | Code | OBR surface | What it does |
|---|---|---|---|
| `index.html` | `src/main.tsx` -> `src/App.tsx` | Action popover (`manifest.json:9-15`, `"popover": "/"`, 375 x 700 max) | The dice tray, the controls, the roll history tray, and the broadcast sender. Also works without OBR (open `localhost:5173` directly): the OBR parts are inside `PluginGate` (`App.tsx:25-28`, `src/plugin/PluginGate.tsx:12-14`) and do not render. |
| `background.html` | `src/background.ts` | Background page (`manifest.json:16`) | On `OBR.onReady`, opens the notification popover (`background.ts:4-17`). Nothing else. |
| `popover.html` | `src/popover.tsx` -> `src/plugin/PopoverApp.tsx` | Popover with id `rodeo.owlbear.savage-worlds-dice/notification-popover` | Shows a toast for a roll when the action popover is closed (section 6). |

`src/main.tsx:11-17` renders `App` inside `PluginThemeProvider`, which reads the OBR theme only when
`OBR.isAvailable` and ready (`src/plugin/PluginThemeProvider.tsx:74-93`).
`src/plugin/ResizeObserver.tsx:13-15` sets the action width to `innerHeight / 2 + 40` on resize.

## 3. Stores

| Store | File | Holds | Shared? | Persisted? |
|---|---|---|---|---|
| `useDiceRollStore` (zustand + immer) | `src/dice/store.ts:98-357` | The current roll: `roll`, `rollThrows`, `rollValues`, `rollTransforms`, `dieInfo`, `explosionDice`, `pendingDice`, `finishedDice`, `explosionResults`, `rollMode`, `currentRollResult`. | No (the result is derived and broadcast) | No |
| `useDiceControlsStore` (zustand + immer) | `src/controls/store.ts:101-245` | Dice set, dice counts, hidden flag, Wild Die, TN, trait and damage modifiers, mode choice (`AUTO`/`TRAIT`/`DAMAGE`/`STANDARD`) and computed `rollMode`. | No | 3 keys in `localStorage` (section 8.3) |
| `useDiceHistoryStore` | `src/controls/history.ts:26-44` | "Recent rolls" menu: up to 6 dice selections with their settings (`history.ts:32-35`). It also sets `pinnedRolls: []`, which is not in its type (`history.ts:29`). | No | No |
| `useDebugStore` | `src/debug/store.ts:8-11` | `allowOrbit`, `allowPhysicsDebug` (Ctrl+Alt+Shift+C / D). | No | No |
| `useRollHistoryStore` | `src/plugin/rollHistoryStore.ts:20-48` | A roll history (max 50). **Not used**: nothing imports it. The history in use is React state in `RollHistoryTray` (section 7). | - | - |

`src/hooks/useRemotePlayerResults.ts` is also not used (no imports). Its comment still says
"reconstruct ... from remote player metadata" (`useRemotePlayerResults.ts:5`).

In development builds `src/dice/store.ts:361-364` puts the dice store on `window.__diceStore`
(marked "TEMP DEBUG ... Remove before merge").

## 4. A roll, step by step (local client)

1. **Build the roll.** `handleRoll` in `src/controls/DiceRollControls.tsx:103-156` calls
   `getDiceToRoll` (`src/controls/store.ts:264-297`). Each die gets a new id from a per-page counter
   (`src/helpers/generateDiceId.ts:4-7`: `"1"`, `"2"`, ...). In TRAIT mode with the Wild Die on, a
   `NEBULA` `D6` is added (`store.ts:287-294`). `startRoll` gets
   `{ dice, hidden, savageWorldsConfig: { rollType, modifier, targetNumber, wildDieId } }`
   (`DiceRollControls.tsx:125-134`). The "recent rolls" replay calls `startRoll({ dice, hidden })`
   without `savageWorldsConfig` (`src/controls/DiceHistory.tsx:67`). Nothing reads
   `savageWorldsConfig` after it is stored.
2. **Throw.** `startRoll` (`src/dice/store.ts:115-148`) sets every value to `null`, puts every die in
   `pendingDice`, makes a random `DiceThrow` per die (`getRandomDiceThrow`,
   `src/helpers/DiceThrower.ts:102-114`), and marks a die as the Wild Die when it is a `NEBULA` `D6`
   (`store.ts:145`). Fixture: `diceStore.inProgress.traitWildDie.json`.
3. **Simulate.** `src/dice/DiceRoll.tsx:98-134` runs Rapier with `timeStep={1 / 120}` and
   `updateLoop="independent"`. Each die is a `PhysicsDice`. When its speed is low and it is in the
   tray, it reads the up face (`src/helpers/getValueFromDiceGroup.ts:10-39`) and calls
   `onRollFinished(id, value, transform)` (`src/dice/PhysicsDice.tsx:93-123`).
4. **Explode.** `checkAndProcessExplosion` (`src/dice/store.ts:219-241`) stores the value, adds it to the
   chain of the root die (`updateExplosionResults`, `src/dice/storeHelpers.ts:10-30`), and, when the value
   is the die maximum and the mode is not `STANDARD`, adds an explosion die with id
   `<rootId>_explosion_<n>` and a new random throw (`store.ts:271-295`, `storeHelpers.ts:33-49`).
   The limit is 50 explosions per die (`src/helpers/explosionHelpers.ts:33`). Fixture:
   `diceStore.explosionPending.json`.
5. **Finish.** When `pendingDice` is empty, `completeRoll` reads the modifier and TN from the controls
   store (`store.ts:297-303`) and `finalizeRoll` sets `currentRollResult` with
   `isComplete: true` and `timestamp: Date.now()` (`store.ts:305-320`). Outcomes come from
   `calculateOutcomes` (`store.ts:333-355`) and the helpers in `src/dice/storeHelpers.ts:69-164`.
6. **Live recalculation.** `useSavageWorldsResults` (`src/hooks/useSavageWorldsResults.ts:9-131`)
   recalculates outcomes from `currentRollResult` with the **current** TN, modifier and Wild Die
   setting, and adds `wildDieEnabled` (`:124-130`). This value is what is broadcast.

## 5. How results reach other clients

### 5.1 What is sent

`DiceRollSync` (`src/plugin/DiceRollSync.tsx`), mounted inside `PluginGate` in the action popover
(`App.tsx:25-28`), sends:

```ts
OBR.broadcast.sendMessage("rodeo.owlbear.savage-worlds-dice/roll-result", broadcast, { destination: "ALL" });
// broadcast: RollBroadcast = { playerId, player, result }   (DiceRollSync.tsx:9-13)
```

- `player` is built locally (`DiceRollSync.tsx:28-42`): `name`, `color` and `id` from
  `OBR.player.getName/getColor/getId`. Both `id` and `connectionId` are set to `OBR.player.getId()`,
  the **user id**, not the connection id. `role` is always `"PLAYER"`, `syncView` is `false`,
  `metadata` is `{}`.
- `playerId` is `player.connectionId`, which is the user id (`:102`, `:127`). The interface comment
  says "Player's connection ID" (`:10`).
- `result` is the `useSavageWorldsResults()` value (`:22`).
- `destination: "ALL"` means the sender also receives its own message (`:109`, `:134`).

Fixtures: `broadcast.rollResult.*.json`, `broadcast.event.traitWildDie.json`.

### 5.2 When it is sent

There are two send paths:

1. **Effect on the result** (`DiceRollSync.tsx:117-139`). It runs each time `currentResult` changes.
   It sends when `currentResult.isComplete` is true, the roll is not hidden, and the local player info
   has loaded. Because `useSavageWorldsResults` recalculates when the TN, a modifier or the Wild Die
   toggle changes, a change to these after a roll sends the **same roll again with the same
   `timestamp`** and new outcomes. Receivers replace their entry
   (fixture `broadcast.rollResult.traitWildDie.modifierChanged.json`). This continues until the roll is
   cleared (picking dice clears it: `src/controls/DicePicker.tsx:22-25`).
2. **Store subscription** (`DiceRollSync.tsx:58-114`). On each dice-store change it checks that all
   values are set and `pendingDice` is empty (`:75-77`), and that the die ids or the result
   `timestamp` changed (`:81-95`). It sends `currentResult` from the closure of the last render
   (`:99-105`), not a value read from `state`.

Not sent:

- A roll in progress. No message is sent until every die has a value (`:75-79`, `:122`).
- A cleared roll. There is no "clear" message (`:63-67`).
- A hidden roll (`roll.hidden`, set from the "hide" control `diceHidden`): `:99`, `:119-122`.
- A roll made before `OBR.player.getName/getColor/getId` resolved (`currentPlayer` is `null`).

### 5.3 Who reads it

| Reader | File | Iframe | What it does |
|---|---|---|---|
| `RollHistoryTray` | `src/plugin/RollHistoryTray.tsx:15-60` | Action popover | Adds or updates a history entry (section 7). |
| `NotificationPopover` | `src/plugin/NotificationPopover.tsx:44-69` | Notification popover | Shows a toast when the action popover is closed. |

Both cast `event.data` to `RollBroadcast` with no validation (section 9). Neither uses
`event.connectionId`.

## 6. Background page and notification popover

- `src/background.ts:4-17` opens the popover once on `OBR.onReady`: id
  `rodeo.owlbear.savage-worlds-dice/notification-popover`, url `/popover.html`, size 0 x 0, anchored at
  top center, `disableClickAway`, `hidePaper`. Fixture: `popover.notification.open.json`.
- `NotificationPopover` tracks the action open state (`OBR.action.isOpen` and `onOpenChange`,
  `NotificationPopover.tsx:24-41`). When a complete roll arrives while the action is closed, it shows
  `RollNotification` for 10 s (`:51-63`) and resizes its popover to 600 x 160; otherwise to 0 x 0
  (`:72-80`).
- The broadcast listener is removed and added again each time `isPanelOpen` changes (`:44-69`).
- With `destination: "ALL"`, a player whose own action popover is closed also gets a toast for their
  own roll. (In practice a roll needs the action open, but the result can be re-sent after it closes,
  see 5.2.)

## 7. Roll history

- **In use:** `RollHistoryTray` keeps `RollHistoryEntry[]` in React state (`RollHistoryTray.tsx:12`).
  For each complete broadcast (`:20`) it makes `id = "<playerId>-<result.timestamp>"` (`:26`). If the
  id exists, it replaces `result` and `player` (`:30-37`). Otherwise it appends
  `{ id, playerId, player, result, timestamp, addedAt: Date.now() }` (`:39-48`). It sorts by
  `timestamp` and keeps the last 20 (`:51-53`). Fixtures: `rollHistory.entries.json`,
  `rollHistory.empty.json`.
- The type is `RollHistoryEntry` in `src/types/SavageWorldsTypes.ts:87-96` (`player` is
  `PlayerDisplayInfo`, `:77-85`). A second, unused `RollHistoryEntry` is in
  `src/plugin/rollHistoryStore.ts:5-12`.
- The history lives only in the action iframe's memory. A reload, a late join, or a missed message
  means those rolls are not shown. Each client can have a different history.
- `PlayerRollPill` (`src/plugin/PlayerRollPill.tsx`) renders each entry with `player.name` and
  `player.color` from the payload.

## 8. Synced data reference

### 8.1 OBR metadata

| Kind | Keys |
|---|---|
| Player metadata | **None.** The app does not call `OBR.player.setMetadata` or read `Player.metadata`. |
| Room metadata | None. |
| Scene / item metadata | None. |

Legacy: before commit `2a374c3` ("migrate to broadcasts"), the app wrote player metadata keys
`rodeo.owlbear.savage-worlds-dice/roll`, `/rollThrows`, `/rollValues`, `/rollTransforms` and
`/currentRollResult`. The current code ignores them. Player metadata is per connection and resets on
reload (owlbear-platform.md 5.1), so these keys exist only while a client on an old version is
connected.

### 8.2 Broadcast channels

| Channel | Destination | Payload type | Writer | Readers | Fixtures |
|---|---|---|---|---|---|
| `rodeo.owlbear.savage-worlds-dice/roll-result` | `ALL` | `RollBroadcast` | `DiceRollSync.tsx:108-110`, `:133-135` | `RollHistoryTray.tsx:16`, `NotificationPopover.tsx:45` | `broadcast.rollResult.*.json`, `broadcast.event.traitWildDie.json` |

```ts
// src/plugin/DiceRollSync.tsx:9-13
interface RollBroadcast {
  playerId: string;          // OBR.player.getId() (user id)
  player: Player;            // { connectionId (= user id), id, name, color, metadata: {}, role: "PLAYER", syncView: false }
  result: PlayerRollResult;  // = SavageRollResult
}

// src/types/SavageWorldsTypes.ts:37-59 (+ wildDieEnabled from useSavageWorldsResults.ts:129)
interface SavageRollResult {
  mode: "TRAIT" | "DAMAGE" | "STANDARD";
  dieChains: DieChain[];      // every die: regular + Wild Die
  outcomes: RollOutcome[];    // TRAIT: one per regular die; DAMAGE: one; STANDARD: one per die
  targetNumber?: number;
  modifier?: number;
  wildDieEnabled?: boolean;
  isComplete: boolean;        // always true when sent
  timestamp: number;          // Date.now() at finalize; part of the history entry id
}
interface DieChain { dieId: string; dieType: "D4"|"D6"|"D8"|"D10"|"D12"|"D20"|"D100"; rolls: number[]; total: number; isWildDie?: boolean }
interface RollOutcome {
  chains: DieChain[]; modifier: number; total: number;
  success?: boolean; raises?: number; replacedByWild?: boolean;
  criticalFailure?: boolean; possibleCriticalFailure?: boolean; criticalFailureReason?: string; // declared, never set
}
```

Format notes, from the fixtures:

- Each chain in `outcomes[].chains` is a full copy of a chain in `dieChains`.
- `DAMAGE` outcomes also have `success` and `raises` against the TN, because `processDamageRoll`
  passes `targetNumber` (`storeHelpers.ts:157-164`). The live recalculation does not update them when
  the TN or modifier changes (`useSavageWorldsResults.ts:99-121` only updates them for TRAIT).
- `raises` is absent on a failed outcome from `createRollOutcome` (`storeHelpers.ts:83-88`), but the
  hook sets it to `0` (`useSavageWorldsResults.ts:46-53`, `:111-117`). Sent payloads have it.
- `STANDARD` outcomes have no `success`/`raises` and `modifier: 0` (`store.ts:344-351`).
- Critical failure is computed by the reader at render time (`src/helpers/criticalFailure.ts:17-107`),
  from `dieChains` and `wildDieEnabled`.
- There is **no version field**.

### 8.3 Browser storage

| Key | Value | Written | Read | Default |
|---|---|---|---|---|
| `swade-diceSetId` | Dice set id, e.g. `"IRON_STANDARD"` | `src/controls/store.ts:142` | `store.ts:51-58` (ignored when `NEBULA_STANDARD`, `all` or unknown) | first set that is not NEBULA or `all` (`store.ts:63-65`) |
| `swade-wildDieEnabled` | `"true"` / `"false"` | `store.ts:217` | `store.ts:87`, `:91` | `true` |
| `swade-targetNumber` | integer string, clamped 1..99 on write | `store.ts:227` | `store.ts:88`, `:92` (`parseInt`, no `NaN` check) | `4` |

All access is in `try/catch`. There is no zustand `persist` middleware and no `sessionStorage`.
Modifiers and mode choice are not stored (`store.ts:189`, `:195`, `:241`).
Fixtures: `localStorage.empty.json`, `localStorage.controls.json`.

### 8.4 Popover and other OBR ids

| Id | Use |
|---|---|
| `rodeo.owlbear.savage-worlds-dice/notification-popover` | `OBR.popover.open` (`background.ts:7`), `setWidth`/`setHeight` (`NotificationPopover.tsx:74-78`) |

There are no modals, context menus, tools or scene items. All ids come from `getPluginId`
(`src/plugin/getPluginId.ts:2-4`). Fixture: `ids.json`.

## 9. Determinism: what is shared and what is computed locally

- **Shared:** only the finished `SavageRollResult` (values per die and computed outcomes).
- **Local only:** `rollThrows`, `rollTransforms`, `rollValues`, `dieInfo` and the 3D scene. Other
  clients do not render the roller's dice.
- **Not seeded:** `random()` uses `Math.random()` (`src/helpers/random.ts:5-7`). `DiceRoll.masterSeed`
  is declared (`src/types/DiceRoll.ts:9-13`) but nothing sets or reads it. The comments at
  `src/dice/store.ts:32-38` ("Master seed ... deterministic seed derivation") and
  `src/dice/DiceRoll.tsx:95` ("networking relies on the deterministic nature of Rapier") describe the
  older design, in which throws were shared through player metadata. The project `CLAUDE.md`
  ("Results are reproducible across clients via shared seeds") is also out of date.
- The result is trusted as the roller's client computed it. Receivers do not re-simulate or check it.

## 10. Trust assumptions

Facts about the current code; see owlbear-platform.md 7 and 16.3 for the platform rules.

- **No validation of received data.** `event.data as RollBroadcast` at `RollHistoryTray.tsx:17` and
  `NotificationPopover.tsx:48`. The only checks are `result`, `result.timestamp` and
  `result.isComplete` being truthy (`RollHistoryTray.tsx:20`, `NotificationPopover.tsx:51`). Fields
  such as `outcomes`, `dieChains`, `player.name` and `player.color` are used as they arrive. No React
  error boundary was found in `src/`, so a malformed payload that throws during render can break the
  tray.
- **Sender identity comes from the payload.** `playerId`, `player.name` and `player.color` are read
  from `data` (`RollHistoryTray.tsx:26`, `:42-43`). `event.connectionId`, which the OBR host sets, is
  not used. Any client can send a message that looks like another player's roll, or that replaces an
  existing entry by reusing its `playerId` and `timestamp`.
- **Payload values reach styles.** `player.color` goes to `backgroundColor` and to a hex parser
  (`PlayerRollPill.tsx:38-52`, `:74-75`). `player.name` is rendered as React text (escaped).
- **Results are not checked.** Die values, totals, raises and success are shown as sent.
- **Hidden rolls are private** because they are not sent at all (`DiceRollSync.tsx:99`, `:122`).

## 11. Size and rate

- A typical payload is 1.0 to 1.7 kB as pretty JSON (fixtures). Each die adds about 70 bytes to
  `dieChains` and again to `outcomes`, plus explosion values. The broadcast limit is 16 kB per message
  (owlbear-platform.md 8). The dice count has no upper limit in `DicePicker`, and each die can explode
  up to 50 times. No size check exists before `sendMessage`.
- `sendMessage` is not awaited and has no `.catch` (`DiceRollSync.tsx:108`, `:133`). A failure
  (rate limit, size, timeout) is an unhandled rejection only.
- Every change of TN, modifier or Wild Die while a result is shown sends one message (5.2).
- `src/tests/FairnessTester.tsx:145-148` rolls again and again with `clearRoll`/`reroll`. Each finished,
  not hidden roll goes through the same broadcast path.
