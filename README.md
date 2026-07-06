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

Static site: `index.html` + `game.js`. Three.js **r164** vendored under
`vendor/` (ES modules via import map — no CDN dependency). No build step.

## Controls

| input | action |
|---|---|
| W A S D | footwork |
| mouse | the sword — swing speed and edge angle decide everything |
| hold RMB | guard — **raised in the last instant, it becomes a parry** |
| hold SHIFT | thrust grip (deep, narrow, half the bone toll) |
| G | grant mercy to a begging opponent |
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
- **The blade BITES** — a committed cut or thrust that doesn't pass clean
  through lodges in the body and must be wrenched free (pull away);
  severing strokes and glancing blows pass. The AI works its steel loose.
- **Technique assist** — the mouse supplies intent (line, power, timing);
  committed strokes are steered onto each weapon's honest lines: katana
  kiri-oroshi/kesa/do/kiri-age, axe chops, broadsword hews, fists
  jab/hook/uppercut. Guards and slow blade work stay fully manual.
- **Mercy** — a fighter who can no longer fight (disarmed, or both arms
  gone) kneels and begs. A begging player is executed where he kneels;
  a begging opponent can be spared with **G** — or not.
- **Anatomy** — carotid, femoral, brachial arteries with distinct bleed
  rates; grip tendons (drops the sword); skull/rib bone gates; heart, lungs,
  windpipe. Blood volume 5000ml; unconscious at 62%, dead at 48%. Bleeding
  slows as pressure falls. Forearms can be severed outright.
- **Living faces** — each face is a repainting canvas: fighters blink on
  their own clock, pain knits the brows and bares clenched teeth, and an
  unconscious man's face goes slack, eyes closed. The head itself is a
  sculpted skull (jaw, brow, sockets, cheekbones), not a sphere.
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
- **HDR pipeline** — the scene renders linear HDR into HalfFloat targets;
  exposure + ACES happen exactly once, in the composite. Bloom is a
  two-level pyramid (half-res tight halo + quarter-res wide glow) with an
  HDR bright-pass: lantern flames, the moon and raised steel emit brighter
  than white and truly glow. Falls back to direct render on any GPU hiccup.
- **Snow glitter** — per-centimeter crystal facets flare when they align
  with the moon/view half-vector, twinkling over time, near-field only.
- **Contact shadows** — a soft pool under each fighter grounds him against
  the bright snow; it spreads and thins when a body goes down.
- **Cloth** — the hakama is verlet cloth (front/back panels colliding with
  the legs), and the kimono sleeves are cloth too: they swing with the cut
  and drape over a corpse.
- **Sound** — all procedural WebAudio: wind that breathes and holds its
  breath at the kill, a heartbeat that rises as your blood falls, one taiko
  hit at first blood, a sub-boom on the deciding cut. Steel rings on parry.

## Tuning knobs (game.js)

- Duelist difficulty: `DUELISTS[n].ai` — skill, reaction, windupT, speedMul,
  parry probability, attack rates.
- Parry feel: freshness window `185` ms; interception width `.13`;
  attacker stun `.6`.
- Bloom: halo/glow strengths `.85`/`1.2`, HDR threshold `smoothstep(.9,1.9)`,
  exposure `uExposure` `1.12`.
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
- **Pivot-weighted turning** — planted feet resist yaw; the turn flows once
  a foot is in flight, so a change of facing *is* footwork, not rotation.
- **Stride mechanics** — the pelvis shifts laterally over the planted foot,
  dips through mid-swing, and the shoulders counter-rotate against the
  hips while striding.
- **Impact momentum** — the XPBD ragdoll's opinion is blended up under
  fresh hits and staggers, so shock travels through the body as momentum
  rather than scripted offsets.
- **Mocap locomotion (models)** — a picked character model that ships
  Idle/Walk/Run clips (bundled Soldier/Xbot do) plays them under the sim:
  crossfaded by ground speed, cadence matched to velocity, blended per
  bone so sword arms and planted feet stay simulation-true.
- **Mocap life (everyone)** — a greatsword mocap pack plays continuously
  on a hidden rig per fighter; the trunk's living oscillation (pelvis bob
  and sway, hip/shoulder counter-yaw at true mocap timing) is harvested,
  high-passed so stance constants stay behind, and layered onto the
  simulated pose. The sim keeps the feet and the sword; the mocap
  breathes. Two-handed-sword mocap deaths join the death-animation pool.
- **Fist pack (bare hands)** — bare-handed fighters draw their trunk life
  from a fighting-idle clip instead, warm up shadowboxing on an unseen
  bag before the duel, and finish a kill with one of three victory katas
  (elbow combo or a sparring flurry) after tearing the head free. The
  mocap layer as a whole speaks louder: wider oscillation clamps and
  heavier bob/sway/push and hip/chest yaw weights.
- **Melee pack (the axe)** — five melee-attack clips are sampled offline
  at load: each stroke's fast core (the impact moment, not the
  follow-through) yields a direction in the performer's chest frame,
  rising backswings and rechambering pull-backs are rejected, and each
  kept arc gains its backhand twin. The surviving arcs REPLACE the
  hand-authored axe technique lines, so a committed axe swing steers
  onto a true mocap arc. The axe fighter also takes a mocap practice
  chop at the bow and performs a combo flourish over the fallen in
  place of the swordsman's noto.
- **Axe locomotion pack** — the axe fighter's trunk life comes from an
  armed standing idle plus four directional walks, blended by where the
  body is going relative to where it faces: circling a foe reads as a
  true strafe, retreating as a backpedal, each with its own mocap
  rhythm. Bare fists now fold hard at the knuckle (per-pose curl
  multipliers) instead of half-wrapping an invisible handle, and every
  build's neck was shortened to human proportion.

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

## v8 — pointer lock, honest hands, and the road to photoreal

- **Pointer lock** — click to duel and the cursor is captured: relative
  mouse deltas drive a virtual sword hand that cannot leave the browser.
  Esc frees it; clicking takes up the sword again. Locked automatically
  on BEGIN and after every restart.
- **Arm & sword feel** — elbows are twice as taut; physics lag now
  *yields to committed cuts* (arm blend scales down with blade speed, so
  a swing is pure intent and the follow-through carries the weight); the
  steel's motor answers the hand 2× faster and its momentum bends the
  rendered line more subtly (swordBlend 0.16).
- **Material realism** — procedural **normal maps** (Sobel-derived from
  height fields) on the kimono weave, hakama pleats, skin pores, and
  crystalline snow grain; a **roughness map** gives the snow its sparkle;
  a canvas **environment cube** makes the blade, hamon, lacquer — and the
  eyes — actually reflect the night. Moon shadows at 2048², tight frustum,
  plus a cold rim light. Cloth/skin textures at 512².
- **Faces v4** — rounded brow ridges, sphere-sculpted two-tone lips,
  cheekbones that catch the moonlight, wet-glint eyes.
- **Photoreal overrides (your ComfyUI rig's job)** — drop JPGs into
  `/textures/` beside index.html and they silently replace the procedural
  maps on load: `kimono.jpg`, `hakama.jpg`, `skin.jpg`. Suggested prompts:
  seamless tileable indigo tsumugi silk weave macro, 1024²; seamless
  tileable charcoal pleated hakama fabric; seamless tileable human skin
  macro, pores, neutral tone. Flat lighting, "seamless texture" in the
  prompt, and near-greyscale luminance works best (the game tints them
  per duelist).

## v9 — real models, retargeted live

Two rigged characters ship in `/models/` (from the three.js project, MIT;
originally Mixamo rigs): **Xbot** (neutral mannequin) and **Soldier**.
Press **M** in-game to cycle: procedural samurai → samurai.glb (yours) →
Xbot → Soldier. The retargeter drives any **Mixamo-convention skeleton**
(`mixamorig:` bones, or bare names) in world space from the same IK +
physics joints every frame — alive, kneeling, bleeding out, or collapsing
under motor cutoff. Blood still darkens the model's materials. The katana
stays ours.

**To get a real samurai:** download any Mixamo-rigged samurai GLB (e.g.
Sketchfab, filter CC0/CC-BY; or auto-rig any mesh through Mixamo itself),
drop it at `models/samurai.glb`, press M once. Height auto-scales; bone
names resolve `mixamorig:X`, `mixamorigX`, or `X`.

The world-space bone math (basis construction + parent-inverse assignment
through arbitrarily rotated hierarchies) is harness-verified to 0 rad.

## v10 — the sword is held, not pointed

The old grip placed the katana on the shoulder→tip ray: blade always
collinear with the arm, zero wrist angle, ever — the root of "doesn't
look handheld." Rebuilt as real kenjutsu mechanics:

- **Compressed-arc grip** — both hands travel a small arc anchored at the
  solar plexus while the tip travels the full one; the difference *is*
  the wrist. Raise overhead and the blade cocks back (furikaburi); cut
  through and the tip snaps far ahead of the hands.
- **Correct katana grip** — right hand at the tsuba, left at the pommel
  (the old code had the left hand ON THE BLADE, above the right).
- **Hasuji (edge line)** — the blade rolls its edge into the direction of
  travel during cuts (fast smoothing), and settles edge-forward-down at
  rest, instead of arbitrary roll.
- **Living elbows** — IK hints morph with hand height: tucked down-and-in
  at guard, flaring out-and-up through the raise, as arms actually do.

All combat numbers unchanged and re-verified: kills, parries, binds, and
the physics sword all operate on the new geometry.

## v11 — the grip cone and the arcade look

- **The grip cone** — a two-handed katana now has a hard orientation
  envelope enforced in body frame: never inverted (floor ≈46° below
  horizontal), never backward through your own chest — while jodan's
  overhead cock and waki's flank carry remain legal (explicit carve-outs,
  all four cases unit-tested). Applied to the player's intent, the AI,
  and the rendered blade after physics blending.
- **Fighting-game render kit** — 90s-arcade readability: every fighter
  wears a dark **inverted-hull outline** (normal-displaced in the vertex
  shader, so it deforms with the skinned body); cool **fresnel rim
  light** pops the silhouette off the night; the palette is punched to
  arcade saturation; and severe hits burst an additive **impact flare**.
  Press **O** to toggle outlines.

## v12 — connected bodies and the painted face

- **Disconnection eliminated by construction** — three-layer fix: soft
  joints re-project to exact bone lengths after flesh lag (elbow capped
  at 7cm around the IK answer), every limb mesh stretch-spans its true
  endpoints, the grip never leaves the sword arm's honest reach, and the
  left hand *slides up the tsuka* on full extension instead of tearing
  off the pommel (as real hands do). Asserted in-engine every duel:
  bone drift ~1e-16, mesh span gap ~1e-17. Machine epsilon.
- **The painted face** — 90s-MK approach: the face is an airbrushed
  512² texture painted per fighter in his own skin tone (socketed eyes
  with iris/pupil/catchlight, lash lines and lid creases, feathered
  brows, two-tone lips with highlight, jaw shading, optional stubble)
  mapped onto a higher-poly skull. Geometry keeps only silhouette:
  nose, ears, facial hair. Primitive eye/lip meshes retired.
- **Fighting-game physique** — broader chest and shoulder yoke, bigger
  deltoids, fuller sleeves, thicker forearms.

## v13 — the light itself

- **Image-based lighting** — a lighting-only scene (gradient night sky,
  bright snowfield, moon) is prefiltered through PMREM into
  `scene.environment`: every material now receives soft light from the
  world itself instead of floating over black. This is the single
  largest perceived-quality lever available without external assets.
- **Produced post stack** — the scene renders at **1.4× supersampling**
  (honest anti-aliasing through the whole pipeline), then grades through
  film grain, subtle radial chromatic aberration, a contrast lift and
  +12% saturation before the sRGB out.
- **Contact shadows** — soft blob shadows under each foot and the body
  (spreading and fading with lift height; wide and faint under a
  corpse) ground the fighters against the snow in a way a single
  directional shadow map cannot.

**The honest ceiling, and the door through it:** primitive-assembled
characters cap out below "quality game" no matter the shading. The GLB
slot is the door — any Mixamo-rigged samurai dropped at
`models/samurai.glb` (Sketchfab CC0/CC-BY, ~5 minutes) is driven by the
full IK + physics + connectivity system and inherits the IBL, outlines,
rim and grade above. That single file is the remaining distance.

## v14 — any model, and honest gore

- **Model auto-discovery** — three ways in, zero code edits:
  (1) **drag-and-drop any .glb onto the game window** — parses and
  fights immediately; (2) drop files named `samurai.glb`, `samurai2.glb`,
  `samurai3.glb`, or `fighter.glb` into `/models/` — probed in the M
  cycle, `samurai.glb` auto-loads at BEGIN; (3) optionally list any
  filenames in `models/index.json` (`["mizu.glb","ronin.glb"]`) and
  they join the cycle. Clear log lines report rig status (20/20 bones)
  or tell you the model needs a Mixamo auto-rig pass.
- **Gore** — severing now tears: a **jagged flesh stump with protruding
  bone** caps both the body and the flying piece; the tumbling forearm
  **trails blood** as it spins and splashes where it lands; the fresh
  stump **pumps arterially** for two seconds in time with the heart;
  and every severe cut leaves a **jagged gash decal** stuck to the body
  part it opened (up to 12), riding the animation.

## v15 — Mixamo FBX, straight in

No Blender, no GLB conversion. On mixamo.com: pick or auto-rig a
character → **Download → Format: FBX Binary, Skin: With Skin** → then
either **drag the .fbx straight onto the game window**, or save it as
`models/samurai.fbx` (auto-probed alongside the .glb names, and
listable in `models/index.json`). The FBX loader ships in the bundle
(fflate + FBXLoader, three.js r128, MIT). Mixamo's centimeter scale is
auto-normalized by the height fitter, and bone prefixes
(`mixamorig:`, `mixamorig1:`, underscores, bare) resolve fuzzily.
Note: any animation clips in the file are ignored by design — the
game's IK + physics drive the skeleton live.

## v16 — deep trauma

- **Open wounds** — severe cuts are no longer flat decals: each is a
  parted wound — two raised flesh lips flanking a wet dark interior over
  the jagged gash line, parented to the body part so it rides the
  animation and the eventual collapse.
- **The cleft skull** — a mortal skull blow ("skull cleaved — the
  brain") opens a bone-rimmed breach at the exact hit point, the
  convoluted brain visible beneath, oriented outward on the head
  wherever the cut landed.
- **Evisceration** — a deep abdominal or liver wound opens the belly: a
  torn wound cap and a **hanging intestinal loop** stay attached and
  swing with the body, while two more loops and the liver **fall**,
  bleeding as they tumble, staining the snow where they land (they use
  the severed-piece physics, so they respect the same trajectories).
  Bleed rate and pain spike accordingly.

All harness-verified: brain exposure, three organs falling and landing,
the hanging loop attached, alongside the existing stump/severing tests.

## v17 — animation-directed death (clips installed)

Four mocap death performances ship in `models/anims/` (all verified:
49/49 tracks bind, hips descend 91→12-20cm): `death_back` (struck from
the front), `death_fwd` (from behind), and two kneel-collapses. The
killing blow's direction selects the performance; the actor owns the
rig for ~2.5s of clutch-and-fall; then the pose **melts** (per-bone
slerp, ~0.6s) into the motor-cutoff physics corpse that has been
collapsing underneath in parallel. Hips-position tracks are kept for
death clips only, with automatic cm/meter unit detection per rig.
The draw and sheath ritual clips ship alongside.

## v18 — dramatic gore (the MK dial)

- **Squirt emitters** — every artery, mortal, and severe wound gets a
  pressurized emitter anchored to the body part: heart-paced arcing
  spurts (0.11–0.2s pulses) that ride the fighter as he staggers.
  Arteries pump 3.5s, mortal wounds 3s, severe 1.6s.
- **Decapitation** — the through-the-spine neck kill now takes the head:
  it flies (face, hair, and all), trailing blood, lands in the snow; a
  bone-rimmed stump erupts a 4-second fountain; time drops to 0.3 with
  a screen shake.
- **The heart** — a heart strike launches the organ itself, aorta stub
  attached, on a blood arc with slow-mo.
- **Evisceration doubled** — four loops plus the liver fall at the
  opening, a squirter attaches, and the gutted man **keeps shedding**:
  every ~2–4s of movement, another loop slips out.
- **Pools** — spread 1.8× faster and half again as wide. The floor gets
  painted.

## v19 — choose your fighter

The main menu now has two pickers: **YOUR FIGHTER** and **THE
OPPONENT**. The roster is: 武 MUSASHI (the classic procedural samurai)
plus every model the game can find — `samurai.fbx/.glb`, `Old Man.fbx`,
`Zombiegirl W Kurniawan.fbx`, Xbot, Soldier, anything listed in
`models/index.json`, and anything drag-and-dropped (drops join the
roster and become your fighter). Any mix works: modeled vs procedural,
Old Man vs Zombiegirl. In-game, **M** cycles your fighter and **N**
cycles the opponent, mid-duel if you like. Selections persist across
duels and the endless ladder; missing files show "(missing)" in the
picker instead of failing silently. Duelist identities (KIYOMASA's
aggression, SHIZUKA's speed) are unchanged — models are skins over the
same souls.

## v20 — the clothing comes off

Any severe wound to the chest or belly now STRIPS that region: the
fabric is cut away from the body (bind-space vertex collapse on the
skinned kimono — 513→155 verts in the band, harness-measured), a flesh
under-body appears beneath (skin-textured, blood-tinting as he bleeds),
and two torn kimono panels physically tear off and FLUTTER down (cloth
aerodynamics: low gravity + drag) to lie in the snow. Combined with the
wound plates, gashes, flaps, and squirters, a fighter late in a duel is
stripped to the waist and painted red — every wound visible.

## Headless tests

`node test_harness.js` — jsdom + real three.js math, stubbed GPU/audio.
Verifies: wound/bleed/death pipeline, fair-duel integrity, ladder
progression, parry mechanics (deterministic), kill-cam trigger, skinned-bone
finiteness, ring containment, restart reset, no NaN anywhere.
