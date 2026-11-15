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
- Two cuts landing together lock the blades in a **bind**: keep driving forward to win it and shove, kick, pommel-strike or throw.
- A kneeling opponent can be finished cleanly (attack), with a **fatality** (F — both arms, then the head), with **bare hands** (G), or spared (M).
- Every kill is followed by a slow-motion **replay** from a second camera; click to skip.
- The fifth duel is **two against one**; Q / Tab (or the Target button) switches who you face.

| | Desktop | Touch |
|---|---|---|
| Move | W A S D | left pad |
| Cut | left click (J): high by default, from the left while moving left (A), from the right while moving right (D) | tap the red pad, same rule; or swipe it toward a side |
| Thrust | double click (E, L, middle click) | double tap the red pad, or swipe it down |
| Guard / parry / feint | right click (K, Shift): guards high, or the side you are moving to | Guard button |
| Dodge | Space | Dodge button |
| Finish / mercy | F / M | on-screen buttons |

## Code

| File | What it holds |
|---|---|
| `src/main.js` | ladder, duel flow, camera, HUD |
| `src/duel.js` | combat rules (`Fighter`, `Duel`) and the opponent AI |
| `src/figure.js` | the posed figure: pose library, IK, stepping, beheading |
| `src/gfx.js` | renderer, ink-outline post pass, arena, blood / sparks / snow / trails |
| `src/replay.js` | snapshot tape and effect log for the kill replay |
| `src/input.js` | keyboard, mouse and touch → one intent per frame |
| `src/audio.js` | recorded fight effects (`audio/`, CC0 — see `audio/ATTRIBUTION.md`) and a live-synthesised orchestral score that follows the duel |

`window.ZAN.sim(seconds, intent)` steps the simulation without rendering, for tests.

The previous physics-sword version of the game (V65) is still playable at `classic.html`; its notes are in `README-classic.md`.
