# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

## Commands

- `yarn` - install dependencies (Node >= 26)
- `yarn dev` - Vite dev server at http://localhost:5173 (CORS allows only the Owlbear Rodeo origins)
- `yarn build` - `tsc` then `vite build` to `dist/` (source maps are written but not linked)
- `yarn preview` - serve the production build
- `yarn lint` - ESLint (0 warnings allowed) + `tsc --noEmit` + `tsc -p tsconfig.node.json`
- `yarn test` - Vitest, one run; `yarn test:watch` - Vitest in watch mode

CI (`.github/workflows/ci.yml`, Node 26) runs `yarn install --frozen-lockfile`, `yarn lint`, `yarn test`,
`yarn build`. Keep all four green.

## Architecture

React app with a 3D dice tray (three.js + Rapier physics) for Savage Worlds Adventure Edition (SWADE).
It runs as an Owlbear Rodeo (OBR) extension, and standalone at `localhost:5173` (OBR parts do not render).

### Entry points (`vite.config.ts`, manifest `public/manifest.json`)

- `index.html` -> `src/main.tsx` -> `src/App.tsx`: the OBR action popover. Dice tray, controls, party
  roll history (`RollHistoryTray`) and the roll sender (`DiceRollSync`).
- `background.html` -> `src/background.ts`: on `OBR.onReady`, opens the notification popover. Nothing else.
- `popover.html` -> `src/popover.tsx` -> `src/plugin/PopoverApp.tsx`: an invisible popover that shows a
  toast for another player's roll while the action popover is closed.

### State (Zustand 5 + Immer)

- `src/dice/store.ts` - the roll in the tray: throws, values, explosions, `currentRollResult`.
- `src/controls/store.ts` - dice selection, mode (AUTO/TRAIT/DAMAGE/STANDARD), TN, modifiers, Wild Die,
  limits (40 dice per roll, modifiers -99..99, TN 1..99). Persists `swade-diceSetId`,
  `swade-wildDieEnabled`, `swade-targetNumber` in `localStorage`.
- `src/controls/history.ts` - local "recent rolls" list for reroll.
- `src/debug/store.ts` - debug flags. Dev builds only: Ctrl+Alt+Shift+D toggles the Rapier debug view,
  Ctrl+Alt+Shift+C toggles the orbit camera. In production the listener is stripped and the flags stay false.

### Rules engine

`src/rules/outcomes.ts` is the one pure SWADE outcome engine (no React, no stores). The dice store,
`useSavageWorldsResults` (live recalculation) and history readers all use it. Rules:
- Trait: each trait die (one or more) vs TN; the Wild Die replaces the lowest trait result if higher.
  Success at TN, a raise per full 4 over TN.
- Critical Failure with a Wild Die: Wild Die is a natural 1 AND more than half of all dice (Wild Die
  included) are natural 1s. Modifiers do not change it. Without a Wild Die it is only "possible".
- Damage: no success, raises or crit. STANDARD: raw values, no modifier, no explosions.
- Dice explode (ace) on their maximum face, at most 50 explosions per die.

### Sync (details: `docs/app-owlbear-integration.md`)

- Physics is NOT synced. Each client rolls locally with `Math.random` throws; other clients get only the
  finished result and do not render the roller's dice.
- One broadcast channel, `rodeo.owlbear.savage-worlds-dice/roll-result`, payload version 1
  (`src/plugin/rollWire.ts`). One sender (`src/plugin/rollSender.ts`): dedupe, debounce, retry, size guard.
- History: each player stores its last 10 rolls in its own player metadata
  (`rodeo.owlbear.savage-worlds-dice/history`); the party history is rebuilt from it plus live broadcasts.
- Every received payload and metadata record is validated by `rollWire.ts`; sender identity comes from OBR,
  never from the payload. Old payloads (no `v`) are still read.
- Post-roll edits (TN, modifier, Wild Die) recalculate and re-send the same `rollId` with `rev + 1`.
- Hidden (private) rolls are never sent and never written to metadata.

### Loading

Rapier and the physics scene are lazy loaded (`React.lazy` in `src/tray/InteractiveTray.tsx`); the
fairness tester and its charts are lazy too. Vendor chunks: react, three, mui (`vite.config.ts`).

## Directory map (`src/`)

- `dice/` - roll store, physics dice, explosion handling
- `rules/` - SWADE outcome engine
- `plugin/` - OBR integration: wire format, sender, receivers, history, toasts, theme
- `controls/` - sidebar, top bar, mode/TN/modifier/Wild Die/hidden controls, results display
- `tray/` - 3D tray, WebGL context-loss handling
- `hooks/`, `helpers/`, `constants/`, `types/` - shared logic and types
- `sets/` - dice set definitions; `materials/`, `meshes/`, `colliders/` - 3D assets
- `previews/` - 2D dice preview images (`DicePreview.tsx`) for the picker and history
- `audio/` - collision sounds; `icons/` - custom icons; `components/` - `ErrorBoundary`
- `fairness/` - fairness tester UI (distribution charts, chi-squared); a product feature, not tests
- `debug/` - dev-only debug store (see above)
- `test/` - test setup, OBR mock, Rapier node world, golden fixtures, cross-client tests

## Tech stack (installed versions)

React 19.3, TypeScript 6.0, three 0.187, @react-three/fiber 9.8, @react-three/drei 10.7,
@react-three/rapier 2.2 (@dimforge/rapier3d-compat 0.19.2), MUI 9.5, Zustand 5.1, Immer 11.2,
@owlbear-rodeo/sdk 3.1, Vite 8.3, Vitest 5.1, ESLint 10, jsdom 31.

## Testing

- Vitest with jsdom (`vitest.config.ts`); setup `src/test/setup.ts`; tests are `src/**/*.test.{ts,tsx}`
  next to the code.
- OBR: mock the SDK with the in-memory multi-client fake `src/test/obrMock.ts` (usage in its header).
- Golden fixtures in `src/test/fixtures/golden/` record the legacy wire and storage format;
  `src/test/golden.compat.test.tsx` must keep passing (mixed-version rooms depend on it).

## Docs

- `docs/app-owlbear-integration.md` - how this app uses OBR: entry points, payload, sender rules,
  validation, history metadata, storage keys. Update it when sync behavior changes.
- `docs/owlbear-platform.md` - the OBR platform itself (copied from another repo; do not edit here).
