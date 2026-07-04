# 斬 ZAN — a duel in the snow

A physics-and-anatomy-first samurai duel. **There is no health bar and no attack
button.** Your blade is a spring-mass system driven by your mouse; the body is a
stack of tissue layers at realistic depths. One cut decides.

## Deploy to Vercel

This is a static site — two files, zero build step.

```bash
cd samurai-duel
vercel          # or: vercel --prod
```

Or push the folder to a Git repo and import it in the Vercel dashboard
(Framework preset: **Other**, no build command, output directory: root).

## Controls

| Input | Action |
|---|---|
| Mouse | Sword control — the tip has mass and momentum. Swing hard to cut; slow taps glance off. |
| Hold RMB | Guard — your blade auto-tracks his to intercept |
| Hold Shift | Thrust posture — the point concentrates force and slips between ribs |
| W A S D | Footwork (distance is life) |
| R | Restart |

## The simulation

**Cut model.** Cut energy = ½ · m_eff · v², where v is the actual blade-tip
velocity and m_eff ≈ 2 kg (katana + the arms behind it). Energy is degraded by
edge alignment (*hasuji*) raised to the 1.6 power — a blade that wobbles across
its own line lands partly flat and delivers blunt trauma instead. Tissue
resists ~14 J per cm of cut depth. Thrusts multiply penetration ×1.8 and pay
only half the bone toll (the point slips between ribs).

**Anatomy.** Every body zone is a layer stack with real depths:
skin → carotid at 1.4 cm → windpipe → cervical spine; ribs (160 J gate) →
lung → heart at 5.5 cm; femoral artery at 2.8 cm in the thigh; grip tendons at
1 cm in the forearm (severing them makes the sword fall); bones gate deeper
progress and can be split or, at high energies, cut through — taking the
forearm with them.

**Physiology.** 5,000 ml blood volume. Each severed vessel bleeds at its own
rate (carotid 75 ml/s, femoral 42, brachial 26, lung 14), scaled by remaining
blood pressure. Consciousness fades below ~62 % volume; death near 48 %. A
heart strike gives 4.5–8 seconds of consciousness — enough for one last cut,
for either of you. Pneumothorax drains stamina; a crushed windpipe suffocates;
pain and stun degrade sword control. Within one swing, flesh drags the blade —
each successive body part hit in the same pass sees a much slower edge.

**Death** switches the skeleton to a Verlet ragdoll with distance constraints,
arterial spray paced to a rising pulse, and a blood pool that grows with actual
volume lost into the snow.

## Tuning

All constants live at the top of their sections in `game.js`:
`ANATOMY` (layer depths, bleed rates, bone gates), `BLADE_EFF_MASS`,
`cutDepth()` (J/cm), `UNCONSCIOUS_AT` / `DEAD_AT`, and the AI's `skill`,
reaction time, and attack cadence in `class AI`.
