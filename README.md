# 斬 ZAN — a duel in the snow

A samurai duel where **the simulation is the game**. No health bars, no attack
button, no hit points. Your mouse *is* the sword: a spring-mass blade with
mass, momentum and edge alignment, cutting into layered anatomy. One clean
cut can end it. So can a nick to the wrong artery, ninety seconds later.

Three duelists wait in the roped ring.

## Deploy

```
vercel --prod
```

Static site: `index.html` + `game.js`. Three.js r128 from cdnjs. No build step.

## Controls

| input | action |
|---|---|
| W A S D | footwork |
| mouse | the sword — swing speed and edge angle decide everything |
| hold RMB | guard — **raised in the last instant, it becomes a parry** |
| hold SHIFT | thrust grip (deep, narrow, half the bone toll) |
| R | next duel / retry |

## The ladder

1. **猪 KIYOMASA — the Boar.** Comes forward. Big committed cuts, long
   wind-ups, little patience with a guard.
2. **鏡 GENNOSUKE — the Mirror.** Rarely initiates. Blocks, parries (50%),
   and punishes your recovery. Beat him by feinting, not by swinging.
3. **静 SHIZUKA — First Draw.** Faster than you (1.02×), near-invisible
   wind-up, long patient distance. One mistake each.

Kill all three: **三人斬り**.

## Fencing model

- **Telegraphs** — every AI attack begins with a visible rise to jodan
  (0.2–0.5s by duelist). Read it.
- **Parry** — a guard raised within **185ms** of the incoming cut turns it
  aside: the attacker is stunned ~0.6s, blade flung wide, forced to recover.
  A held guard merely deflects. Blade-vs-blade contact is swept, so full-speed
  steel can't tunnel through a frame.
- **Cut mechanics** — kinetic energy of the effective blade mass, degraded by
  edge misalignment (^1.6), ~14 J/cm through tissue; thrusts penetrate ×1.8
  with half bone cost.
- **Anatomy** — carotid, femoral, brachial arteries with distinct bleed
  rates; grip tendons (drops the sword); skull/rib bone gates; heart, lungs,
  windpipe. Blood volume 5000ml; unconscious at 62%, dead at 48%. Bleeding
  slows as pressure falls. Forearms can be severed outright.
- **Bodies** — procedurally **skinned meshes** (9 world-space bones per
  fighter, driven by the same IK joints as the physics skeleton): continuous
  deformation at shoulders, waist, hips, knees; kimono darkens as its owner
  bleeds. Rigid forearms so severing still works. Verlet ragdoll on death
  drives the same bones.

## Presentation

- **Kill cam** — on the deciding cut: slow time, low orbiting push-in;
  the survivor holds zanshin over the fallen, flicks blood from the blade
  (**chiburi**), lowers it. Stillness, then the verdict.
- **Snow memory** — the ring is a live 1024² canvas: every footstep prints,
  crippled legs drag furrows, blood soaks in. Fresh snow between duels.
- **Bloom** — hand-rolled post pipeline (bright-pass → half-res separable
  gaussian ×2 → additive composite, manual sRGB). Lanterns, moon and sword
  trail glow. Falls back to direct render on any GPU hiccup.
- **Sound** — all procedural WebAudio: wind that breathes and holds its
  breath at the kill, a heartbeat that rises as your blood falls, one taiko
  hit at first blood, a sub-boom on the deciding cut. Steel rings on parry.

## Tuning knobs (game.js)

- Duelist difficulty: `DUELISTS[n].ai` — skill, reaction, windupT, speedMul,
  parry probability, attack rates.
- Parry feel: freshness window `185` ms; interception width `.13`;
  attacker stun `.6`.
- Bloom: composite strength `1.15`, threshold `smoothstep(.62,.95)`.
- Cut lethality: `TISSUE_J_CM`, `BLADE_EFF_MASS`, artery flow rates in `ANATOMY`.

## Movement model (v4 — toward mocap feel)

- **CoM-led locomotion** — the body is an inverted pendulum: it falls where
  it's going and a foot reaches out to *catch* it (~0.26s prediction).
  Stride and cadence scale with speed; acceleration produces anticipation
  lean before the body moves.
- **Foot locking** — planted feet are pinned in position **and yaw** (zero
  slide, harness-asserted at 1e-6). Feet re-aim only in flight; >41° of
  body turn triggers a repositioning pivot step. Toe-off → flight → heel-
  first strike → sole settle, as a rotation profile per step. Steps crunch.
- **Minimum-jerk trajectories** — steps and AI sword wind-ups follow
  quintic minimum-jerk profiles (Flash–Hogan), the velocity shape of real
  human point-to-point movement, replacing robotic sine ramps.
- **Powered-ragdoll overlay** — every major joint (trunk, neck, shoulders,
  elbows, knees) is a soft particle spring-tracked to its kinematic target;
  children compute from softened parents so the chain never detaches. Cuts
  and parries inject velocity: the body physically absorbs and ripples.
- **Balance + wound gaits** — the CoM is monitored against the support
  polygon; escapes trigger urgent catch-steps. Leg wounds accumulate
  per-side damage: shorter stride, slower cadence, lower foot lift, and a
  pelvis dip whenever weight passes over the hurt leg — a synthesized limp,
  driven by the anatomy model.
- **Kamae** — five authored guards (chudan, seigan, jodan, gedan, waki).
  Kiyomasa waits in jodan, Gennosuke in seigan, Shizuka in waki: you can
  read each duelist's school from their silhouette.

## v5 — the duel becomes a life

- **The bind** — sustained blade contact locks into a pressure contest:
  drive with the mouse and W, or pull S to disengage. Win it and his blade
  flies wide; lose it and he counters. Gennosuke deliberately *yields* to
  whirl into a cut. Steel scrapes; the camera leans in.
- **A mind and a heart** — the AI remembers your cut heights and your
  retreat-then-attack habit; once read (4+ observations), he parries and
  pre-positions his guard at your favorite line. Fear (blood, pain) makes
  his technique brittle and finally desperate; your passivity makes him
  bold. He tells you, in the log, when either happens.
- **Kinetic-chain power** — cut energy is gated by body mechanics:
  off-balance −35%, mid-step −12%, hips driving +16%. A knee-drop
  knockdown triggers when stagger (heavy hits, lost binds, being parried)
  overwhelms; he fights on one knee, sword slow, until he rises.
- **Perceptual death** — as blood falls: color desaturates, the vignette
  closes, the world's sound sinks under your heartbeat, your sword grows
  heavy (spring constant scales with consciousness). First blood grants
  22s of adrenaline: warm, sharp, faster hands.
- **A living ring** — snow is deeper near the rope (drag + stamina cost +
  high-stepping); most nights an ice patch waits somewhere: poor grip,
  slips under hard turns, no footprints. Raised steel catches the moon —
  telegraphs literally flash. Breath vapor quickens with exhaustion and
  stops with death.
- **Film grammar** — hard cut to the reverse angle on severe wounds;
  patient wide framing when both duelists wait; letterbox bars close in
  for the kill.
- **The endless life** — beyond the named three, procedurally generated
  challengers arrive forever, harder each time. **Wounds follow you**,
  60% unhealed: the limp from duel four is still there in duel nine.
  Death shows the career — duels survived, men cut down — and keeps a
  best-run record.
- **Better bodies** — UV-mapped woven kimono and pleated hakama textures
  (palette-tinted per duelist), a contoured torso with shoulder yoke and
  waist, deltoid swell into the sleeve flare, and a geometric face: eyes,
  brows, nose, mouth.

## v6 — the engine (ZPhys)

`physics.js` is a from-scratch **XPBD articulated rigid-body engine** —
the same class of method used in modern game physics. Real masses and
capsule inertia tensors, ball joints as compliant positional constraints,
**joint motors as compliant angular constraints** (the torque drive),
positional anchors (dialable balance assist), sphere-ground contacts with
Coulomb friction. 60Hz × 6 substeps × 3 iterations. Zero dependencies
beyond THREE math types; ~200 lines.

Each fighter is an articulated body of **10 rigid bodies** (~66kg: pelvis
11, chest+head 19, thighs 8, shins+feet 5, arms 2.2/1.9) with 9 joints,
per-bone motors driven toward the kinematic pose, and a pelvis anchor.
Cuts and parries apply **true impulses** (J·m⁻¹ into velocity, torque
noise into spin). The physical solution blends into the render through
the soft layer.

**Live dials:** `[` `]` physics blend (0 = pure animation, 1 = pure
physics; ships at 0.5) · `;` `'` loosen/tighten the balance assist.
Crank blend up and loosen assist to watch the body become genuinely
physical; the current controller is pose-tracking + assist (SIMBICON-
style stance feedback and motor-cutoff death are the staged next steps).

Engine verification (`node physics_test.js`): free-fall distance vs ½gt²,
physical-pendulum period vs analytic, joint integrity under whip impulses
(<2cm), motor tracking of a moving target (<0.001 rad), gravity collapse
settling at exactly capsule radius. In-game: 10 bodies finite through
full duels, chest tracking error ~2cm.

## v7 — the engine closes the loop

- **The trunk fixed** — v6's spine could fold like rope. Now: cone-limited
  joints in the engine (spine ~29° max, verified holding 20.0° under a
  violent kick in the law tests), much stiffer trunk motors, per-joint
  physics blend weights (taut trunk, physical limbs), and a tauter soft
  layer. Chest tracks the fight to ~6cm while remaining a real body.
- **SIMBICON-lite balance** — the pelvis hand-of-god is 6× weaker; in its
  place, a real controller: center-of-mass position + velocity error
  against the support line feeds capped corrective forces and an
  ankle-strategy tilt on the shin motors. Balance is now mostly earned.
- **Death by motor cutoff** — the Verlet ragdoll is retired when physics
  is on. Dying is continuous: motor strength scales with consciousness
  (a bleeding man's motors brown out — the sword arm droops first), and
  at death the motors fade over ~1s and gravity wins. The corpse falls,
  settles at capsule radius, and does not bounce (contacts made properly
  inelastic — a real XPBD bug found and fixed by the harness).
- **The sword is steel** — a 1.1kg rigid body with real inertia, jointed
  to the sword hand, motor-driven toward your intent. Its momentum bends
  the rendered blade's line (`PHYS.swordBlend`), the arm physically
  carries its mass, and a disarm releases a real object.
- **Fighters collide** — capsule-capsule contacts between the two bodies
  (opt-in collision groups so joints don't fight themselves). Corps-à-
  corps shoving and stumbling into the fallen are now physical facts.
- **A clear winter night** — fog and mist removed. In their place: a
  gradient sky dome, ~420 stars densest at the zenith, and two ranges of
  snow-capped silhouette ridgelines encircling the ring.
- **Faces and skin** — sculpted geometric faces: sclera + iris eyes with
  lids, brow ridges with hair, nose bridge and tip, two-tone lips, ears;
  per-duelist facial hair (Kiyomasa's beard, Shizuka's mustache, random
  for the endless road). Skin has a subsurface-mottled, pored texture;
  kimono and hakama keep their weave and pleats.

## Headless tests

`node test_harness.js` — jsdom + real three.js math, stubbed GPU/audio.
Verifies: wound/bleed/death pipeline, fair-duel integrity, ladder
progression, parry mechanics (deterministic), kill-cam trigger, skinned-bone
finiteness, ring containment, restart reset, no NaN anywhere.
