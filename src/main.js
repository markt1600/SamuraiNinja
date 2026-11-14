/* ZAN — the game: ladder, duel flow, camera, HUD. */
import * as THREE from 'three';
import * as G from 'zan/gfx';
import { Fighter, Duel, AI, MIRROR, MAX_WOUNDS, T } from 'zan/duel';
import * as Input from 'zan/input';
import { sfx } from 'zan/audio';
import * as Replay from 'zan/replay';

const $ = id => document.getElementById(id);
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const LADDER = [
  { name: 'Genta', title: 'the Ox', blurb: 'Strong, slow to think. He cuts from where his blade already sits.',
    look: { gi: 0x9a7436, hakama: 0x3b3230, pattern: 'check', crest: 0x2a1a0c }, bare: true,
    ai: { react: .36, block: .34, parry: .02, dodge: 0, aggr: .42, mix: .15, feint: 0, thrust: .08, track: .15, punish: .3 } },
  { name: 'Oharu', title: 'the Reed', blurb: 'She waits for you to miss. Do not swing at air.',
    look: { gi: 0x5d7050, hakama: 0x2b302a, hat: 'kasa', pattern: 'wave', crest: 0xe9e4d6 },
    ai: { react: .3, block: .56, parry: .14, dodge: .1, aggr: .26, mix: .4, feint: .04, thrust: .14, track: .45, punish: .85 } },
  { name: 'Jubei', title: 'the Crow', blurb: 'Half of what he shows you is a lie. Parry the cut, not the shoulder.',
    look: { gi: 0x3c4b6b, hakama: 0x20222b, pattern: 'stripe', crest: 0xe9e4d6, obi: 0x8e1c1c },
    ai: { react: .27, block: .55, parry: .12, dodge: .1, aggr: .6, mix: .6, feint: .4, thrust: .18, track: .5, punish: .6 } },
  { name: 'Kaede', title: 'the Needle', blurb: 'She fights from a long measure and her point comes straight.',
    look: { gi: 0x6f3b58, hakama: 0x2a1f28, hat: 'kasa', pattern: 'dots', crest: 0xe9c46a, obi: 0xe9c46a },
    ai: { react: .23, block: .6, parry: .2, dodge: .2, aggr: .62, mix: .7, feint: .18, thrust: .48, track: .6, punish: .8, range: 2.5 } },
  { name: 'Shiro', title: 'the White Death', blurb: 'The master of this shrine does not fight alone. Kuro, his shadow, circles behind you.',
    second: { name: 'Kuro', title: 'the Shadow', look: { gi: 0x1d1d22, hakama: 0x0f0f12, hat: 'kasa', saya: 0x111114, coat: 0x17171b, obi: 0x5a1010 },
      ai: { react: .33, block: .4, parry: .04, dodge: .05, aggr: .38, mix: .35, feint: .05, thrust: .12, track: .3, punish: .35 } },
    look: { gi: 0xeae5db, hakama: 0xcdc6b8, hair: 0xd9d9d6, saya: 0x8e1c1c, grip: 0x8e1c1c, pattern: 'bloom', obi: 0x8e1c1c, coat: 0xf3efe6, crest: 0xb3261e },
    ai: { react: .22, block: .58, parry: .2, dodge: .12, aggr: .6, mix: .75, feint: .25, thrust: .22, track: .65, punish: .8 } },
];
const PLAYER = { name: 'You', look: { gi: 0x24262f, hakama: 0x14151a, band: G.BLOOD, tails: G.BLOOD, crest: 0xe9e4d6, obi: 0x8e1c1c } };

const game = { state: 'menu', stage: 0, t: 0, time: 0, endT: 0, won: false, hintT: 0 };
let player, enemy, duel, ai, foes = [];
const { camera } = G.init($('c'));
Input.init($('c'));
const camPos = new THREE.Vector3(0, 3, 9), camLook = new THREE.Vector3(0, 1.2, 0);
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3(), _m = new THREE.Vector3();

/* ---------- flow ---------- */
function newEnemy(i, alone) {
  foes.forEach(f => f.fig.dispose());
  const defs = [LADDER[i]]; if (LADDER[i].second && !alone) defs.push(LADDER[i].second);
  foes = defs.map(d => new Fighter(d, false)); enemy = foes[0]; ai = new AI(defs[0].ai);
  return defs.map((d, k) => k ? new AI(d.ai) : ai);
}
function startLadder() { game.stage = 0; player.wounds = 0; G.clearGround(); startDuel(); }
function startDuel() {
  const keep = player ? player.wounds : 0;
  if (player) player.fig.dispose();
  player = new Fighter(PLAYER, true); player.wounds = keep;
  const ais = newEnemy(game.stage);
  player.reset(0, 2.3, Math.PI); foes.forEach((f, k) => f.reset(foes.length > 1 ? (k ? 1.7 : -1.7) : 0, -2.3, 0));
  duel = new Duel(player, foes, ais, onEvent);
  game.state = 'intro'; game.t = 0; game.finish = game.mercy = false; game.bowed = false; Replay.reset(); show('replay', false); G.look.kill = 0; G.look.dim = 0; G.clearGround();
  const d = LADDER[game.stage];
  $('card-n').textContent = 'Duel ' + ROMAN[game.stage] + ' of ' + ROMAN[LADDER.length - 1]; $('card-seal').textContent = ['一', '二', '三', '四', '五'][game.stage];
  $('card-name').textContent = d.name + ', ' + d.title + (d.second ? ' — and ' + d.second.name : ''); $('card-blurb').textContent = d.blurb;
  show('card', true); show('menu', false); show('verdict', false); show('hud', true); show('prompt', false);
  document.body.classList.remove('ended'); document.body.classList.toggle('two', foes.length > 1);
  sfx.music('intro'); sfx.taiko(.7); camSnap = true; hud();
}
function onEvent(type, who, extra) {
  const mine = who === player;
  if (SFX[type] && !(type === 'over' && who.mercy)) pop(SFX[type], (type === 'over' ? who.loser : who || player).fig.chest, type === 'over' || type === 'down' ? 'big red' : type === 'wound' || type === 'sever' ? 'red' : type === 'whiff' || type === 'evade' || type === 'block' ? 'small' : '');
  if (type === 'parry') say(mine ? 'Parry' : 'Parried', mine ? 'good' : 'bad');
  else if (type === 'bind') say('Bind — drive forward', '', 1.2);
  else if (type === 'clinch') { const me = who === player; say(({ throw: me ? 'Thrown down' : 'You are thrown', pommel: me ? 'Pommel strike' : 'Struck by the pommel', kick: me ? 'Kick' : 'Kicked back', shove: me ? 'Shoved off' : 'Shoved back' })[extra], me ? 'good' : 'bad'); }
  else if (type === 'down') { say(who.name + ' falls', 'good', 1.6); const sl = $('slash'); sl.classList.remove('go'); void sl.offsetWidth; sl.classList.add('go'); }
  else if (type === 'broken') say(mine ? 'Your guard is broken' : 'Guard broken — strike now', mine ? 'bad' : 'good', 1.6);
  else if (type === 'wound') say(mine ? 'You are cut' : 'A clean cut', mine ? 'bad' : 'good');
  else if (type === 'evade') say(mine ? 'Slipped' : 'Evaded');
  else if (type === 'yield') say(mine ? 'You fall to your knees' : who.name + ' yields', mine ? 'bad' : 'good', 2);
  else if (type === 'over') {
    game.state = 'end'; game.endT = 0; $('msg').className = ''; sayT = 0; game.won = who.victor === player; show('prompt', false); sfx.music('after');
    Input.state.fighting = false; if (document.exitPointerLock) document.exitPointerLock();
    document.body.classList.add('ended');
    if (!who.mercy) { const sl = $('slash'); sl.classList.remove('go'); void sl.offsetWidth; sl.classList.add('go'); }
  }
}
function slash() { const sl = $('slash'); sl.classList.remove('go'); void sl.offsetWidth; sl.classList.add('go'); }
function verdict() {
  game.state = 'verdict'; const last = game.stage === LADDER.length - 1, mercy = duel.over.mercy;
  $('v-title').textContent = game.won ? (last ? 'The shrine is yours' : mercy ? 'Mercy' : 'Victory') : 'Death';
  $('v-sub').textContent = game.won
    ? (last ? 'Five duels. No one is left to stand against you.' : mercy ? LADDER[game.stage].name + ' lives, and will remember.' : LADDER[game.stage].name + ' lies in the snow.') +
      (player.wounds ? ' You carry ' + player.wounds + (player.wounds > 1 ? ' wounds' : ' wound') + ' — one will close before the next duel.' : '')
    : 'Cut down by ' + duel.over.victor.name + ' in duel ' + ROMAN[game.stage] + '.';
  $('v-go').textContent = game.won ? (last ? 'Begin again' : 'Next duel') : 'Begin again';
  $('v-retry').style.display = game.won ? 'none' : '';
  show('verdict', true); show('hud', false); if (game.won) sfx.victory(); else sfx.death();
}
function proceed(retry) {
  sfx.boot();
  if (game.state === 'menu') return startLadder();
  if (game.state !== 'verdict') return;
  if (game.won && game.stage < LADDER.length - 1) { game.stage++; player.wounds = Math.max(0, player.wounds - 1); startDuel(); }
  else if (!game.won && retry) { player.wounds = game.woundsIn || 0; startDuel(); }
  else startLadder();
}
$('m-go').onclick = () => proceed(); $('v-go').onclick = () => proceed(); $('v-retry').onclick = () => proceed(true);

/* ---------- HUD ---------- */
/* lettered sound effects: katakana where the device can draw it, Latin where it cannot */
const KANA = (() => {
  try {                                    // draw a kana and an unassigned glyph: the same picture, or none, means no Japanese font
    const ink = ch => { const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d', { willReadFrequently: true }); x.font = '30px sans-serif'; x.textBaseline = 'top'; x.fillText(ch, 4, 4); return Array.from(x.getImageData(0, 0, 40, 40).data.filter((v, i) => i % 4 === 3)).join(''); };
    const a = ink('ザ'), b = ink('\uE000'); return /[1-9]/.test(a) && a !== b;
  } catch (_) { return false; }
})();
const SFX = KANA
  ? { parry: 'ガキィン', block: 'ガッ', bind: 'ギリギリ', wound: 'ザシュッ', broken: 'グラッ', evade: 'ヒュッ', whiff: 'スカッ', clinch: 'ドカッ', sever: 'ブシャッ', yield: 'ガクッ', down: 'ズバァッ', over: 'ズバァッ' }
  : { parry: 'KLANG!', block: 'TOK', bind: 'GRRK', wound: 'SLASH!', broken: 'CRACK', evade: 'FWIP', whiff: 'WHIFF', clinch: 'THUD!', sever: 'SPLAT', yield: 'UGH', down: 'ZAN!', over: 'ZAN!' };
if (!KANA) document.documentElement.classList.add('latin');
/** a drawn sound effect, lettered beside the action */
function pop(text, at, cls) {
  _p.copy(at).project(camera); if (_p.z > 1) return;
  const e = document.createElement('div'); e.className = 'koe ' + cls; e.textContent = text;
  const side = Math.random() < .5 ? -1 : 1;
  e.style.left = ((_p.x * .5 + .5) * innerWidth + side * (60 + Math.random() * 70)) + 'px'; e.style.top = ((-_p.y * .5 + .5) * innerHeight - 40 - Math.random() * 60) + 'px';
  e.style.setProperty('--r', (side * (6 + Math.random() * 10)) + 'deg');
  $('koe').appendChild(e); setTimeout(() => e.remove(), 900);
}
let dizzyT = 0;
function show(id, on) { $(id).classList.toggle('on', !!on); }
let sayT = 0;
function say(text, cls = '', hold = 1.1) { const m = $('msg'); m.textContent = text; m.className = 'on ' + cls; sayT = hold; }
function pips(el, n) { let h = ''; for (let i = 0; i < MAX_WOUNDS; i++) h += `<i class="${i < n ? 'cut' : ''}"></i>`; if (el._h !== h) { el.innerHTML = h; el._h = h; } }
function ring(el, f, foe, mirror) {
  _p.copy(f.fig.chest); _p.project(camera);
  const vis = _p.z < 1 && f.alive && f.state !== 'kneel' && (game.state === 'fight' || game.state === 'intro');
  el.style.display = vis ? '' : 'none'; if (!vis) return;
  const d = camera.position.distanceTo(f.fig.chest), ppm = innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360) * d);
  const s = (mirror ? .52 : .44) * ppm / 70.8;
  el.style.transform = `translate(${(_p.x * .5 + .5) * innerWidth}px,${(-_p.y * .5 + .5) * innerHeight}px) translate(-50%,-50%) scale(${s})`;
  const st = mirror ? MIRROR[f.stance] : f.stance, w = f.state === 'windup' && f.atk ? f.atk : null;
  const now = w && f.dur - f.t < T.parry;
  let cls = 'ring ' + st + (f.guard ? ' guard' : '') + (w ? (w.thrust ? ' thrust' : ' atk') : '') + (now ? ' now' : '') + (f.state === 'broken' ? ' broken' : '') + (mirror ? ' foe' : '');
  if (el._c !== cls) { el.className = cls; el._c = cls; }
}
function hud() {
  const nm = enemy.def.name + ' ' + enemy.def.title, en = $('e-name'); if (en.textContent !== nm) en.textContent = nm;
  $('p-post').style.width = player.posture + '%'; $('e-post').style.width = enemy.posture + '%';
  $('p-post').classList.toggle('hot', player.posture > 70); $('e-post').classList.toggle('hot', enemy.posture > 70);
  pips($('p-pips'), player.wounds); pips($('e-pips'), enemy.wounds);
  ring($('ring-p'), player, enemy, false); ring($('ring-e'), foes[0], player, true);
  if (foes[1]) ring($('ring-e2'), foes[1], player, true); else $('ring-e2').style.display = 'none';
  $('ring-e').classList.toggle('dim', foes.length > 1 && enemy !== foes[0]); $('ring-e2').classList.toggle('dim', enemy !== foes[1]);
}

/* ---------- camera ---------- */
let camSnap = true, menuA = 0, camFov = 40;
function cam(dt) {
  let fov = 40;
  if (game.state === 'menu') {
    menuA += dt * .06; _p.set(Math.sin(menuA) * 10.5, 2.4, Math.cos(menuA) * 10.5 + 1); _l.set(0, 1.5, -3);
  } else {
    _f.subVectors(enemy.pos, player.pos).setY(0); const dist = _f.length() || 1; _f.multiplyScalar(1 / dist);
    _r.set(-_f.z, 0, _f.x);                                   // the player's right hand side
    if (game.state === 'replay') {
      // a slow walk around the dying, low and close
      const R = Replay.state(), k = (R.t - R.t0) / ((R.t1 - R.t0) || 1), v = duel.over.loser.pos, a = Math.atan2(_r.x, _r.z) + Math.PI - .5 - k * 1.5;
      _m.copy(v).lerp(duel.over.victor.pos, .4);
      _p.set(_m.x + Math.sin(a) * (4.6 - k * 1.2), .75 + k * .5, _m.z + Math.cos(a) * (4.6 - k * 1.2)); _l.copy(_m); _l.y = 1; fov = 33;
    } else if (game.state === 'end' || game.state === 'verdict') {
      // step out to the side: the whole cut, drawn in profile
      const v = duel.over.loser.pos; _m.addVectors(player.pos, enemy.pos).multiplyScalar(.5);
      const k = Math.min(1, game.endT / 5);
      _p.copy(_m).addScaledVector(_r, 5.4 - k * 1.2).addScaledVector(_f, duel.over.loser === enemy ? -.6 : .6); _p.y = 1.15 + k * .5;
      _l.copy(_m).lerp(v, .35); _l.y = .95; fov = 36;
    } else {
      _p.copy(player.pos).addScaledVector(_f, -(3.3 + dist * .3)).addScaledVector(_r, 2.1 + dist * .1); _p.y = 2.3 + dist * .06;
      _l.copy(player.pos).addScaledVector(_f, dist * .72).addScaledVector(_r, .1); _l.y = 1.05;
    }
  }
  const k = camSnap ? 1 : 1 - Math.exp(-dt * (game.state === 'end' ? 2.4 : game.state === 'replay' ? 3 : 5)); camSnap = false;
  camPos.lerp(_p, k); camLook.lerp(_l, k);
  camera.position.copy(camPos); camera.lookAt(camLook);
  camFov += (fov - camFov) * Math.min(1, dt * 3); camera.fov = camFov - G.look.punch * 4.5; camera.updateProjectionMatrix();
}

/* ---------- frame ---------- */
const IDLE = { mx: 0, mz: 0, stance: null, attack: false, thrust: false, guard: false, dodge: false };
function pressure() {
  if (!duel || game.state !== 'fight') return .3;
  const f = duel.all, busy = f.some(x => x.state === 'windup' || x.state === 'strike' || x.state === 'bind') ? .15 : 0;
  if (f.some(x => x.state === 'broken' || x.state === 'kneel')) return 1;
  return .25 + Math.max(...f.map(x => x.posture)) / 100 * .45 + Math.max(player.wounds, ...foes.map(x => x.wounds)) * .12 + busy;
}
function update(dt, forced) {
  game.time += dt; game.t += dt; sfx.tick(pressure());
  const inp = Input.read(), intent = forced || inp.intent;
  if (inp.confirm) proceed();
  if (sayT > 0 && (sayT -= dt) <= 0) $('msg').className = '';
  if (game.state === 'menu') return;
  if (game.state === 'intro') {
    duel.hold = true; duel.step(dt, IDLE); duel.time = 0; duel.hold = false;
    if (!game.bowed && game.t > .7) { game.bowed = true; for (const f of duel.all) f.fig.go(['rest', .25, 'io'], ['bow', .45, 'io'], ['bow', .3], [f.stance, .55, 'io']); }
    if (game.t > 2.6 || (game.t > .6 && (inp.intent.attack || inp.confirm))) {
      game.state = 'fight'; show('card', false); Input.state.fighting = true; game.woundsIn = player.wounds; sfx.bell(); sfx.music('duel');
      for (const f of [player, enemy]) { f.poseName = ''; }
    }
  } else if (game.state === 'fight') {
    const vic = duel.awaiting;
    if (inp.swap) duel.swap = true;
    if (vic && inp.finish) game.finish = 'fatal'; else if (vic && inp.bare) game.finish = 'bare'; else if (vic && intent.attack && !game.finish) game.finish = 'clean';
    else if (vic && inp.mercy && !game.finish) game.mercy = true;
    show('prompt', vic && !game.finish && !game.mercy);
    if (vic && game.finish && player.state !== 'execute') duel.execute(player, duel.kneeling[0], game.finish);
    else if (vic && game.mercy && player.state === 'idle') duel.spare(player);
    if ((dizzyT -= dt) < 0) { dizzyT = .16; for (const f of duel.all) if (f.state === 'broken') { const a = game.time * 7; G.burst('star', _p.copy(f.fig.neckW).add(_l.set(Math.cos(a) * .24, .34, Math.sin(a) * .24)), 0xe9b949, .2, .32, null, 1.2); } }
    duel.step(dt, vic ? IDLE : intent); enemy = duel.b; Replay.record(duel.time, duel.all.map(f => f.fig));
  } else if (game.state === 'replay') {
    const figs = duel.all.map(f => f.fig), R = Replay.state(), before = R.t < R.killT;
    const done = Replay.tick(dt, figs) || (game.t > .5 && (inp.intent.attack || inp.confirm));
    if (before && R.t >= R.killT) { slash(); sfx.kill(); }
    G.look.kill = R.t >= R.killT ? Math.max(0, 1 - (R.t - R.killT) / .45) : 0;
    if (done) { Replay.finish(figs); show('replay', false); G.look.kill = 0; verdict(); }
  } else {
    duel.step(dt, IDLE); game.endT += dt;
    if (game.state === 'end') Replay.record(duel.time, duel.all.map(f => f.fig));
    G.look.kill = duel.over.mercy || game.state !== 'end' ? 0 : Math.max(0, Math.min(1, game.endT / .12) * (1 - Math.max(0, game.endT - 1.5) / .9));
    if (game.state === 'end' && game.endT > (duel.over.mercy ? 2.4 : 3.4)) {
      const k = duel.over.t;
      if (!duel.over.mercy && Replay.start((duel.fatalT != null ? Math.min(duel.fatalT - 1, k - 2.5) : k - 3.2), k)) { game.state = 'replay'; game.t = 0; camSnap = true; show('replay', true); }
      else verdict();
    }
    if (game.state === 'verdict') G.look.dim = Math.min(.5, G.look.dim + dt);
  }

}
let last = performance.now();
function frame(ts) {
  const dt = Math.min(.05, Math.max(0, (ts - last) / 1000)); last = ts;
  if (!game.paused) { update(dt); G.tick(dt, game.time); }
  cam(dt); if (player) hud(); G.render(dt);
  requestAnimationFrame(frame);
}
// a quiet pair on the menu so the court is not empty
player = new Fighter(PLAYER, true); newEnemy(4, true);
player.reset(1.9, -1.2, -Math.PI / 2); enemy.reset(-1.9, -1.2, Math.PI / 2);
player.fig.snap('left'); enemy.fig.snap('high'); player.fig.update(0); enemy.fig.update(0);
show('menu', true);
// sound may only start on a gesture: the first touch or key brings up the wind and the menu theme
const wake = () => { if (sfx.boot() && game.state === 'menu') sfx.music('menu'); };
addEventListener('pointerdown', wake); addEventListener('keydown', wake);
requestAnimationFrame(frame);

/* test hook: drive the simulation without the render loop */
window.ZAN = { game, G, T, AI, LADDER, pop, sfx, get player() { return player; }, get enemy() { return enemy; }, get foes() { return foes; }, get duel() { return duel; }, get ai() { return ai; },
  proceed, sim(sec, intent, dt = 1 / 60) { for (let t = 0; t < sec; t += dt) { update(dt, typeof intent === 'function' ? intent() : intent); G.tick(dt, game.time); } } };
