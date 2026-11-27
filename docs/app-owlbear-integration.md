# How this app integrates with Owlbear Rodeo

This document describes the code of this repository as it is now. For the OBR platform itself, see
[owlbear-platform.md](owlbear-platform.md). Old example payloads (the format before payload version 1)
are in [`src/test/fixtures/golden/`](../src/test/fixtures/golden/README.md).

## 1. Summary

- Three entry points: the dice tray (OBR action popover), a hidden background page, and an invisible
  notification popover.
- Each client rolls its dice **locally** with Rapier physics. The physics is **not** replayed on other
  clients. Other clients get only the finished result.
- The finished result goes to everyone through **one broadcast channel**,
  `rodeo.owlbear.savage-worlds-dice/roll-result` (payload version 1, section 5).
- Each player keeps its **last 10 rolls** in its own **player metadata** under
  `rodeo.owlbear.savage-worlds-dice/history` (section 7). The party history is rebuilt from it, so late
  joiners and reloads see recent rolls.
- Every received payload goes through one validating parser (`src/plugin/rollWire.ts`). Sender name,
  color and role come from OBR, never from the payload.
- Settings (dice set, Wild Die on/off, target number) are in `localStorage`.

## 2. Entry points

Vite builds three HTML pages (`vite.config.ts`). The manifest is `public/manifest.json`.

| Page | Code | OBR surface | What it does |
|---|---|---|---|
| `index.html` | `src/main.tsx` -> `src/App.tsx` | Action popover | The dice tray, the controls, the party roll history (`RollHistoryTray`) and the sender (`DiceRollSync`). Also works without OBR (open `localhost:5173` directly): the OBR parts are inside `PluginGate` and do not render. |
| `background.html` | `src/background.ts` | Background page | On `OBR.onReady`, opens the notification popover. Nothing else. |
| `popover.html` | `src/popover.tsx` -> `src/plugin/PopoverApp.tsx` | Popover `rodeo.owlbear.savage-worlds-dice/notification-popover` | Shows a toast for another player's roll while the action popover is closed (section 6). |

## 3. Plugin modules

| File | Role |
|---|---|
| `src/plugin/rollWire.ts` | Channel and metadata key, payload types, `buildRollBroadcast`, the validating parsers `parseRollBroadcast` / `parseRollResult` / `parseHistoryMetadata`, the compact history encoding, `safeColor` / `safeName`, limits. |
| `src/plugin/rollSender.ts` | The one sender: dedupe, debounce, serial queue, retry, size guard, history writes, error notices. |
| `src/plugin/DiceRollSync.tsx` | Feeds the finished (and post-roll edited) result of the dice store to the sender. |
| `src/plugin/partyDirectory.ts` | Connection id -> name, color (validated), role, from `OBR.party` and `OBR.player`. |
| `src/plugin/useRollFeed.ts` | One subscription per iframe to the roll channel, the party and the player; parses everything; resolves the sender. |
| `src/plugin/rollHistory.ts` | Pure history reducer: keys, order, revisions, caps, flood limit. |
| `src/plugin/RollHistoryTray.tsx`, `RollHistoryPanel.tsx`, `PlayerRollPill.tsx` | History UI (action popover). |
| `src/plugin/NotificationPopover.tsx`, `RollNotification.tsx` | Toast UI (notification popover). |

## 4. A roll, step by step (local client)

1. `handleRoll` (`src/controls/DiceRollControls.tsx`) builds the dice with `getDiceToRoll`
   (`src/controls/store.ts`; at most 40 dice per roll, plus the Wild Die) and calls
   `startRoll(roll, { mode, speedMultiplier, settings })` (`src/dice/store.ts`). The roll records its own
   mode; `roll.hidden` comes from the hide toggle.
2. Each die gets a random throw (`getRandomDiceThrow`, `src/helpers/DiceThrower.ts`). Rapier simulates
   it; the resting pose gives the face value (`checkAndProcessExplosion`). A maximum face adds an
   explosion die (not in STANDARD mode).
3. When no die is pending, the store sets `currentRollResult`: the result from the rules engine
   (`src/rules/outcomes.ts`), plus `rollId` (new UUID) and `hidden` (copied from the roll).
4. `useSavageWorldsResults` recalculates the result with the **live** TN, modifiers and Wild Die
   setting. That value is shown, sent and stored (post-roll edits, section 5.3).

## 5. Roll broadcast

### 5.1 What is sent (payload version 1)

```ts
OBR.broadcast.sendMessage("rodeo.owlbear.savage-worlds-dice/roll-result", payload, { destination: "ALL" });

interface RollBroadcastV1 {
  v: 1;                    // payload version (new)
  rollId: string;          // [A-Za-z0-9_-]{1,64}, the same for every revision of the roll (new)
  rev: number;             // 0 for the finished roll, +1 per post-roll edit (new)
  playerId: string;        // the sender's connection id   } kept only for clients on an older version;
  player: {                //                              } receivers on this version ignore it
    id, connectionId, name, color, role, syncView: false, metadata: {}   // real values from OBR
  };
  result: {                // exactly the golden result keys
    mode: "TRAIT" | "DAMAGE" | "STANDARD";
    dieChains: DieChain[]; // every die: regular + Wild Die; explosions folded into the root chain
    outcomes: RollOutcome[];
    targetNumber: number; modifier: number; wildDieEnabled: boolean;
    isComplete: true;
    timestamp: number;     // Date.now() at finish; display only, never used for order
  };
}
interface DieChain { dieId: string; dieType: "D4"|"D6"|"D8"|"D10"|"D12"; rolls: number[]; total: number; isWildDie: boolean }
interface RollOutcome {
  chains: DieChain[]; modifier: number; total: number; replacedByWild: boolean;
  success?: boolean; raises?: number;                  // TRAIT only (DAMAGE/STANDARD: absent, OD-5)
  criticalFailure?: true; possibleCriticalFailure?: true; criticalFailureReason?: string;  // TRAIT only
}
```

- STANDARD results have `modifier: 0` in the result and in every outcome.
- `hidden` and other local fields are never in the payload.

### 5.2 When it is sent

The rules are in `src/plugin/rollSender.ts`:

- A finished roll that is **not hidden** is sent **at once** with `rev: 0`.
- A **hidden** roll is never sent and never stored, also after edits. The flag is read from the finished
  roll (`currentRollResult.hidden`), not from the live toggle.
- Nothing is sent while dice still roll, on clear, or for an edit after the roll was cleared.
- Every OBR write runs in one serial queue and is awaited. An error (for example `RateLimitHit`, or a
  timeout) is retried after 0.6, 1.2, 2.4, 4.8 and 6 s. Only the newest revision of a roll is sent; an
  older one waiting in the queue is skipped. When the last retry fails, the roller sees an OBR ERROR
  notification ("Your roll could not be shared with the table…").
- Size guard: before a roll is queued, the payload is built with 64-character placeholder ids and name,
  measured, and parsed with the receivers' parser. If it is over 16 000 bytes or would be rejected, it is
  neither sent nor stored, and the roller sees "This roll is too large to share with the table".
  With 40 dice the largest possible roll fits (test `T-57`).
- Sender info (`getId`, `getConnectionId`, `getName`, `getColor`, `getRole`) is read when a send runs,
  so a roll that finishes before player info is ready is still sent.

### 5.3 Post-roll edits (owner decision OD-1)

Changing the TN, a modifier or the Wild Die after a roll is a feature: the result is recalculated
(every field, by the rules engine) and sent again as a new revision of the same roll.

- Same `rollId` and `timestamp`, `rev + 1`.
- Trailing debounce of 300 ms: quick clicks send one revision with the final value.
- A change that does not alter the result (for example the damage modifier during a TRAIT result), or
  a change back to the last sent value within the window, sends nothing.
- Every client replaces its entry for that roll, in place. The entry shows the new modifier, and the
  TN when it is not 4 ("vs TN 6", OD-6).
- A revised roll toasts once on other clients, 1.5 s after the last revision, marked "(revised)" (OD-7).
- The revision is also written to the roller's history metadata, so late joiners see the edited values.

### 5.4 Receiving and validation

Both receiver iframes use `useRollFeed`: one subscription each to the roll channel, `OBR.party.onChange`
and `OBR.player.onChange`, made once.

- `parseRollBroadcast(event.data)` returns a new, typed object or `null`. It reads only known own keys
  and builds new objects (no prototype keys). Rules: `mode` and `dieType` from fixed lists; integers
  everywhere (`Number.isInteger`); faces 1..max of the die; chain `total` must equal the sum of its rolls;
  1..50 chains and outcomes, 1..51 rolls per chain, at most 300 rolls in all; modifier -99..99; TN 1..99;
  outcome total within ±100 000; raises 0..10 000; `criticalFailureReason` at most 200 characters;
  `timestamp` 1..8.64e15; ids `[A-Za-z0-9_-]{1,64}`; `rev` 0..1 000 000.
- **Version:** no `v` = a client on an older version: accepted, `rollId = "t" + result.timestamp`,
  `rev = 0` (old clients keep the timestamp for every revision, so their revisions replace by arrival).
  `v >= 1` is read with the v1 rules; a later version must stay a superset of v1. Anything else is dropped.
- Defaults for fields old senders may omit: `targetNumber` 4, `modifier` 0, `wildDieEnabled` false (crit
  then shows as "possible" only), `isWildDie` / `replacedByWild` false.
- Invalid payloads are dropped with one `console.warn` per sender connection and source.
- **Identity (C-02):** the sender is `event.connectionId` (set by the OBR host), resolved through
  `OBR.party.getPlayers()` / `onChange` and `OBR.player` (self). Name (max 64 characters) and color
  (`#rrggbb` only, else `#888888`) come from OBR. If the connection is unknown, the party is fetched once
  more; if it is still unknown, the message is dropped with a warning.
- **Error boundaries** (`src/components/ErrorBoundary.tsx`) wrap the history tray ("History unavailable"),
  each history pill (a bad entry hides only itself), the notification popover and each toast. A toast that
  fails to render sets the popover to 0 x 0, so no empty iframe blocks clicks in OBR.

## 6. Background page and notification popover

- `src/background.ts` opens the popover once on `OBR.onReady`: id
  `rodeo.owlbear.savage-worlds-dice/notification-popover`, url `/popover.html`, size 0 x 0, anchored at
  top center, `disableClickAway`, `hidePaper`. Fixture: `popover.notification.open.json`.
- `NotificationPopover` reads `OBR.action.isOpen()` once and follows `onOpenChange` in a ref (no
  resubscribe on open/close). While the open state is still unknown, a toast asks `isOpen()` first.
- A toast shows only while the action popover is closed, for 10 s, at 600 x 160; otherwise the popover
  is 0 x 0. Resize errors are caught and logged.
- No toast for this client's own roll. A new roll toasts at once. A revision toasts once after the edits
  settle (section 5.3). An older or identical revision toasts nothing.
- The name is cut with an ellipsis (16em, and at most 64 characters).

## 7. Roll history

### 7.1 Player metadata (owner decision OD-2)

| Key | Written by | Value |
|---|---|---|
| `rodeo.owlbear.savage-worlds-dice/history` | each client, for itself only (`OBR.player.setMetadata`) | `HistoryMetadataV1` |

```ts
interface HistoryMetadataV1 {
  v: 1;
  rolls: {                  // oldest first, at most 10
    id: string;             // rollId
    rev: number;
    t: number;              // result timestamp (display only)
    m: "TRAIT" | "DAMAGE" | "STANDARD";
    tn: number;             // target number
    mod: number;            // modifier of the mode (0 for STANDARD)
    w: 0 | 1;               // Wild Die on
    c: (string | number)[][];  // chains: [dieType, isWildDie 0|1, ...rolls]
  }[];
}
```

- Only completed, not hidden rolls. A revision updates its record in place.
- Compact: outcomes are not stored. A reader recomputes them with the rules engine
  (`computeRollResult`), so stored data cannot carry wrong totals. A typical trait roll costs under
  200 bytes; 10 rolls of the largest possible size are under 32 kB, half of the 64 kB per-update limit
  (test `T-57`).
- Written after each send through the same queue (awaited, retried, ERROR notice on final failure).
- On start, the sender reads its own key first, so a remount of the action popover on the same
  connection keeps the earlier rolls.
- Player metadata is per connection: a page reload (new connection) starts empty
  (owlbear-platform.md 5.1). The roller's own rolls from before a page reload are then gone, but every
  other player's rolls are still read from their metadata.
- Each record is validated on read (same limits as section 5.4); invalid records are dropped one by
  one with one warning per player.

### 7.2 Party history (`RollHistoryTray`, reducer `src/plugin/rollHistory.ts`)

- **Sources:** on load, the history metadata of every player in `OBR.party` and of this client; on each
  party or player change, only players whose history value changed; and live broadcasts.
- **Key:** `<sender connectionId>:<rollId>`. A roll that arrives by broadcast and by metadata is one
  entry. Only the original connection can revise its entry; another client that reuses a `rollId` makes
  its own entry under its own name.
- **Order:** by arrival in this client, never by the sender's clock. A revision keeps the position. The
  first load from metadata has no arrival order, so it is sorted by the sender timestamp **clamped to the
  local clock** (a forged future timestamp cannot pin an entry at the end).
- **Revisions:** an entry is replaced when the new `rev` is not lower than the stored one; an older
  revision is ignored.
- **Cap:** the newest 20 arrivals are kept and rendered. Keys that dropped out are remembered, so a later
  metadata read does not bring them back.
- **Flood limit:** at most 5 new entries per connection per 10 s from broadcasts.
- **Players who leave:** their entries stay until newer arrivals push them out; they keep the last known
  name and color.
- **Clearing** a roll (`clearRoll`) sends nothing; other clients keep the entry.

## 8. Synced data reference

### 8.1 OBR metadata

| Kind | Keys |
|---|---|
| Player metadata | `rodeo.owlbear.savage-worlds-dice/history` (section 7.1). |
| Room metadata | None. |
| Scene / item metadata | None. |

Legacy: before commit `2a374c3` ("migrate to broadcasts"), the app wrote player metadata keys
`rodeo.owlbear.savage-worlds-dice/roll`, `/rollThrows`, `/rollValues`, `/rollTransforms` and
`/currentRollResult`. The current code ignores them.

### 8.2 Broadcast channels

| Channel | Destination | Payload | Writer | Readers |
|---|---|---|---|---|
| `rodeo.owlbear.savage-worlds-dice/roll-result` | `ALL` | `RollBroadcastV1` (section 5.1); legacy payloads without `v` are read too | `rollSender.ts` | `useRollFeed.ts` (history tray, notification popover) |

### 8.3 Mixed versions in one room

- **Old client -> new client:** old payloads (no `v`, `player` block from the payload) are validated and
  shown; the name and color come from OBR. Their revisions (same timestamp) replace the entry by arrival.
- **New client -> old client:** the payload keeps every golden key and type (`playerId`, `player`,
  `result` with exactly the golden result keys), so old clients show new rolls. Old clients key entries on
  `playerId + timestamp`; both stay constant across revisions.
- Old clients do not read or write the history key. Their rolls appear in new clients' history only while
  the new client is open (as before). Tests: `T-60` in `src/plugin/rollWire.test.ts` and
  `src/test/sync.multiClient.test.tsx`, and `src/test/golden.compat.test.tsx`.

### 8.4 Browser storage

| Key | Value | Default |
|---|---|---|
| `swade-diceSetId` | Dice set id, e.g. `"IRON_STANDARD"` (ignored when `NEBULA_STANDARD`, `all` or unknown) | first set that is not NEBULA or `all` |
| `swade-wildDieEnabled` | `"true"` / `"false"` | `true` |
| `swade-targetNumber` | integer string, 1..99 (validated on read and write) | `4` |

All access is in `try/catch`. Modifiers and mode choice are not stored.

### 8.5 Popover and other OBR ids

| Id | Use |
|---|---|
| `rodeo.owlbear.savage-worlds-dice/notification-popover` | `OBR.popover.open` (`background.ts`), `setWidth`/`setHeight` (`NotificationPopover.tsx`, `PopoverApp.tsx`) |

All ids come from `getPluginId` (`src/plugin/getPluginId.ts`).

## 9. What is shared and what is local

- **Shared:** the finished result (values per die and computed outcomes), and the last 10 results per
  player in player metadata.
- **Local only:** `rollThrows`, `rollTransforms`, `rollValues`, `dieInfo` and the 3D scene. Throws are
  random (`Math.random`; the RNG is injectable in `DiceThrower` for tests). Other clients do not render
  the roller's dice.
- The result is trusted as the roller's client computed it: a player can fake their own results. This is
  inherent to the design (no shared physics).

## 10. Trust assumptions

- All received data (broadcasts and other players' metadata) is untrusted and validated (section 5.4).
- Identity comes from the OBR host (`event.connectionId`, `OBR.party`), never from a payload.
- Only validated `#rrggbb` colors reach styles; names are rendered as React text (escaped) and capped.
- Hidden rolls are private because they are never sent or stored. Everything in player metadata can be
  read by every client in the room.

## 11. Size and rate

- A typical payload is 1.0 to 1.7 kB. The broadcast limit is 16 kB per message; the sender's guard is
  16 000 bytes. The UI allows at most 40 dice per roll and modifiers within -99..99.
- OBR's rate limit counts messages (owlbear-platform.md 4.3). The sender sends one message per finished
  roll and one per settled edit, and one metadata write after each; failures are retried with backoff.
- `src/fairness/FairnessTester.tsx` rolls hidden, so its rolls are never sent or stored.

## 12. Content Security Policy

Production builds get a CSP `<meta>` tag at the start of `<head>` in all three pages (`cspPlugin` in
`vite.config.ts`, build only; the dev server has no policy). The app needs `'wasm-unsafe-eval'` (Rapier),
inline styles (Emotion) and Google Fonts:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' data: blob:;
connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'
```

A production build was checked in a live OBR room (tray, trait and damage rolls, party list, fonts). When a
change adds a new external source (fonts, CDN, fetch), update the policy and check it in a live room again.
