# ZAN — one cut decides

A samurai duelling game in the browser. Ink-and-paper visuals, directional sword combat, five duels up a ladder.

Static site: open `index.html` through any web server (`python3 -m http.server`). No build step. Three.js r164 is vendored in `vendor/`.

## How it plays

- **Three guards** — high, left, right. Your blade sits in one of them; your cut comes from the guard you hold.
- **Guard** the side the cut comes from to block it. Blocking costs posture.
- **Parry** by pressing guard just before impact: the attacker reels and you get a fast riposte.
- **Feint** by pressing guard early in your own swing.
- **Thrust** goes through any held guard at a heavy posture cost; a parry or a sidestep answers it.
- **Dodge** sideways slips thrusts and high cuts; backwards gets you out of reach.
- A **clean cut** wounds. Three wounds and a fighter kneels — finish or show mercy.
- A **broken guard** (full posture bar) leaves a fighter open: the next cut kills.
- Wounds carry into the next duel; one closes between duels.

| | Desktop | Touch |
|---|---|---|
| Move | W A S D | left pad |
| Set guard | move the mouse (or arrow keys) | hold Guard and swipe the red pad |
| Cut | left click (J) | swipe the red pad up / left / right, or tap it |
| Guard / parry / feint | right click (K, Shift) | Guard button |
| Thrust | E (L, middle click) | swipe the red pad down |
| Dodge | Space | Dodge button |
| Finish / mercy | F / M | on-screen buttons |

## Code

| File | What it holds |
|---|---|
| `src/main.js` | ladder, duel flow, camera, HUD |
| `src/duel.js` | combat rules (`Fighter`, `Duel`) and the opponent AI |
| `src/figure.js` | the posed figure: pose library, IK, stepping, beheading |
| `src/gfx.js` | renderer, ink-outline post pass, arena, blood / sparks / snow / trails |
| `src/input.js` | keyboard, mouse and touch → one intent per frame |
| `src/audio.js` | synthesised sound and music |

`window.ZAN.sim(seconds, intent)` steps the simulation without rendering, for tests.

The previous physics-sword version of the game is still playable at `classic.html` (`game.js`, `physics.js`, `models/`).
