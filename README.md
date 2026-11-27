# Savage Worlds Dice

3D dice roller for Savage Worlds Adventure Edition (SWADE), built with React, three.js and the Rapier
physics engine. It runs as an Owlbear Rodeo extension, and standalone for development.

![Example](public/docs/header.png)

## Add to Owlbear Rodeo

1. Open your Owlbear Rodeo room.
2. Open the **Extensions** menu in the settings menu.
3. Press **Add Custom Extension**.
4. Enter this manifest URL: `https://swade-dice.ewal.app/manifest.json`
5. Click **Add**.

## Features

**Dice**
- d4, d6, d8, d10 and d12, up to 40 dice per roll, in several dice sets (materials).
- Press and hold on the tray to charge the throw, release to roll. Physics decides each result.

**SWADE rules**
- Roll modes: Auto (one die = trait test, more dice = damage), Trait, Damage and Standard (raw values,
  no explosions, no modifier).
- Trait tests with one or more trait dice and an optional Wild Die (d6). The Wild Die replaces the
  lowest trait result when it is higher.
- Target number (default 4) with success and raises (every full 4 over the TN).
- Critical Failure: the Wild Die is a 1 and more than half of all dice (Wild Die included) are 1s.
  With one trait die, that is a 1 on both. Modifiers do not change it. Without a Wild Die, the result
  shows a "possible" Critical Failure (for Extras, the GM rolls the d6).
- Damage rolls: all dice are added; no success, raises or Critical Failure.
- Dice explode (ace) on their maximum value and add to the total.
- Separate trait and damage modifiers (-99 to +99).
- Change the TN, modifier or Wild Die after a roll: the result is recalculated and the shared result
  is updated for everyone.

**Table play**
- Each finished roll is shared with the other players at once. Other players see the result, not
  your 3D dice.
- Party roll history at the bottom of the tray. Each player stores their last 10 rolls in Owlbear
  Rodeo, so players who join late or reload see recent rolls.
- A toast shows other players' rolls while your dice tray is closed.
- Private rolls (eye icon): only you see them. They are not shared and not stored in the party history.
- Local history of recent dice combinations for quick rerolls.
- Built-in fairness tester with distribution charts and a chi-squared test.

## Development

```bash
yarn              # install dependencies (Node 26 or later)
yarn dev          # dev server at http://localhost:5173
yarn lint         # ESLint and type checks
yarn test         # Vitest tests (yarn test:watch for watch mode)
yarn build        # production build to dist/
yarn preview      # serve the production build
```

To test in Owlbear Rodeo, add `http://localhost:5173/manifest.json` as a custom extension while
`yarn dev` runs. Opened directly in a browser, the app shows the dice tray without the Owlbear parts.

CI runs `yarn lint`, `yarn test` and `yarn build` on every pull request to `main`.

More detail:
- [CLAUDE.md](CLAUDE.md) - architecture, directory map, tech stack, test conventions.
- [docs/app-owlbear-integration.md](docs/app-owlbear-integration.md) - how the app uses Owlbear
  Rodeo: entry points, roll payload, history metadata, validation.
- [docs/owlbear-platform.md](docs/owlbear-platform.md) - the Owlbear Rodeo platform.

## Technology

React 19, TypeScript, MUI, three.js with @react-three/fiber and drei, Rapier via @react-three/rapier,
Zustand with Immer, Vite (three entry points: dice tray, background page, notification popover),
Vitest, and the Owlbear Rodeo SDK.

## Attributions

d8 icon by Leonardo Henrique Martini from [Noun Project](https://thenounproject.com/browse/icons/term/d8/) (CC BY 3.0)

## License

GNU GPLv3. See [LICENSE](LICENSE).
