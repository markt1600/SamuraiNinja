/* ZAN — the rules of the duel. Three guards, cuts from the guard you hold,
   a thrust, a timed parry, feints, a posture meter that opens the killing cut. */
import * as THREE from 'three';
import { Figure, POSE } from 'zan/figure';
import * as G from 'zan/gfx';
import { sfx } from 'zan/audio';

export const MIRROR = { high: 'high', left: 'right', right: 'left' };
export const DIRS = ['high', 'left', 'right'];
export const MAX_WOUNDS = 3;
export const T = {
  wind: .52, thrustWind: .42, riposteWind: .3, follow: .14,
  recover: .4, whiff: .5, thrustRecover: .62, feint: .2,
  parry: .2, regrip: .24, stagger: .9, hit: .55, broken: 1.9, clash: .42, bind: 1.25,
  dodge: .3, dodgeCd: .55, stance: .09,
  reach: 2.4, thrustReach: 2.8,
};
const cap = s => s[0].toUpperCase() + s.slice(1);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
let ATK_ID = 1;

export class Fighter {
  constructor(def, isPlayer) {
    this.def = def; this.name = def.name; this.isPlayer = isPlayer;
    this.fig = new Figure(def.look); this.pos = this.fig.pos; this.wounds = 0;
    this.fig.onStep = sp => sfx.step(sp);
    this.reset(0, 0, 0);
  }
  reset(x, z, yaw) {
    this.yaw = yaw; this.fig.place(x, z, yaw); this.fig.snap('rest');
    this.state = 'idle'; this.t = 0; this.dur = 0; this.stance = 'high'; this.stanceT = 1; this.poseName = '';
    this.posture = 0; this.lastPosture = -9; this.guard = false; this.guardAt = -9; this.guardUp = -9; this.guardHeld = false;
    this.atk = null; this.atkId = 0; this.atkW = 0; this.dodgeCd = 0; this.buffer = null; this.riposteUntil = 0;
    this.vel = new THREE.Vector3(); this.push = new THREE.Vector3(); this.alive = true; this.dripT = 0; this.dodgeSide = false;
    this.chops = []; this.drive = 0; this.spared = false;
  }
  get busy() { return this.state !== 'idle'; }
  get helpless() { return this.state === 'broken' || this.state === 'kneel'; }
  set(state, dur = 0) { this.state = state; this.t = 0; this.dur = dur; this.fig.striking = false; }
  fwd(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  left(out) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  addPosture(n, duel) {
    this.posture = Math.min(100, this.posture + n); this.lastPosture = duel.time;
    if (this.posture >= 100 && this.state !== 'broken' && this.alive && this.state !== 'kneel') {
      this.set('broken', T.broken); this.atk = null; this.fig.go(['reel', .16], ['broken', .4, 'io']);
      sfx.breakPosture(); duel.emit('broken', this); return true;
    }
    return false;
  }

  startAttack(thrust, duel) {
    const rip = duel.time < this.riposteUntil;
    const W = rip ? T.riposteWind : thrust ? T.thrustWind : T.wind;
    this.atk = { dir: this.stance, thrust, rip }; this.atkId = ATK_ID++; this.atkW = W; this.set('windup', W);
    this.riposteUntil = 0; this.buffer = null;
    if (thrust) this.fig.go(['thrC', W * .62, 'out'], ['thrE', W * .38 + .03, 'in']);
    else { const d = this.stance; this.fig.go([d + 'C', W * .58, 'out'], [d + 'M', W * .24, 'in'], [d + 'E', W * .18 + .05, 'lin']); }
    sfx.windup(thrust);
  }

  update(dt, I, foe, duel) {
    this.t += dt; this.stanceT += dt; this.dodgeCd -= dt;
    const fig = this.fig, time = duel.time;
    _v.subVectors(foe.pos, this.pos).setY(0); const dist = _v.length();
    if (this.alive && this.state !== 'kneel' && this.state !== 'dodge') {
      let d = Math.atan2(_v.x, _v.z) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * (this.state === 'windup' || this.state === 'strike' ? 5 : 12));
    }
    // guard edges: a parry is a fresh press, not a held or mashed button
    const gEdge = I.guard && !this.guardHeld;
    if (gEdge && time - this.guardUp > T.regrip) this.guardAt = time;
    if (!I.guard && this.guardHeld) this.guardUp = time;
    this.guardHeld = I.guard; this.guard = I.guard && this.state === 'idle';
    this.vel.set(0, 0, 0);

    switch (this.state) {
      case 'idle': {
        if (I.stance && I.stance !== this.stance) { this.stance = I.stance; this.stanceT = 0; sfx.stance(); }
        const want = this.guard ? 'b' + cap(this.stance) : this.stance;
        if (want !== this.poseName) { this.poseName = want; fig.go([want, this.guard ? .09 : .16, 'out']); }
        const sp = this.guard ? 1.3 : 1;
        this.fwd(_v).multiplyScalar(I.mz * (I.mz > 0 ? 2.7 : 2.2) * sp); this.left(_w).multiplyScalar(I.mx * 2.3 * sp);
        this.vel.add(_v).add(_w); if (this.guard) this.vel.multiplyScalar(.55);
        const b = this.buffer; this.buffer = null;
        if (I.dodge && this.dodgeCd <= 0) {
          let mx = I.mx, mz = Math.min(0, I.mz); if (!mx && !mz) mz = -1;
          const l = Math.hypot(mx, mz); this.dodgeSide = Math.abs(mx) > .5;
          this.fwd(_v).multiplyScalar(mz / l); this.left(_w).multiplyScalar(mx / l);
          this.dodgeDir = _v.add(_w).clone(); this.set('dodge', T.dodge); this.dodgeCd = T.dodgeCd + T.dodge; this.poseName = '';
          fig.go(['dodge', .1, 'out'], [this.stance, .22, 'io']); sfx.dash(); G.puff(this.pos, 6);
        } else if (I.attack || b === 'cut') this.startAttack(false, duel);
        else if (I.thrust || b === 'thrust') this.startAttack(true, duel);
        break;
      }
      case 'windup': {
        const reach = this.atk.thrust ? T.thrustReach : T.reach;
        if (this.t > this.dur * .25 && dist > reach - .45) this.fwd(this.vel).multiplyScalar(this.atk.thrust ? 3.6 : 2.8);
        fig.striking = this.t > this.dur * .58;
        if (gEdge && this.t < this.dur * .6 && !this.atk.rip) {           // feint
          this.atk = null; this.set('recover', T.feint); this.poseName = ''; fig.go([this.stance, T.feint, 'out']); duel.emit('feint', this);
        } else if (this.t >= this.dur) { duel.resolve(this, foe); if (this.state === 'windup') { this.set('strike', T.follow); fig.striking = true; } }
        break;
      }
      case 'strike':
        fig.striking = true;
        if (this.t >= this.dur) { const d = this.recoverDur || T.recover; this.set('recover', d); this.poseName = ''; fig.go([this.stance, d * .95, 'io']); }
        break;
      case 'recover':
        if (I.attack) this.buffer = 'cut'; else if (I.thrust) this.buffer = 'thrust';
        if (this.t >= this.dur) { this.set('idle'); this.atk = null; this.recoverDur = 0; }
        break;
      case 'dodge':
        this.vel.copy(this.dodgeDir).multiplyScalar(5.6 * (1 - this.t / this.dur * .6));
        if (this.t >= this.dur) this.set('recover', .1);
        break;
      case 'stagger': case 'hit': case 'clash':
        if (this.t >= this.dur) { this.set('idle'); this.poseName = ''; }
        break;
      case 'broken':
        if (this.t >= this.dur) { this.posture = 45; this.set('idle'); this.poseName = ''; duel.emit('recovered', this); }
        break;
      case 'bind':
        if (I.mz > .3) this.drive += dt;
        if (I.dodge) { this.fwd(this.dodgeDir = new THREE.Vector3()).multiplyScalar(-1); this.dodgeSide = false; this.set('dodge', T.dodge); this.dodgeCd = T.dodgeCd; this.poseName = ''; fig.go(['dodge', .1, 'out'], [this.stance, .22, 'io']); sfx.dash(); }
        break;
      case 'execute': {
        const A = this.atk;
        if (!A) {
          while (this.chops.length && this.chops[0] !== 'head' && foe.fig.armOff[this.chops[0] === 'armR' ? 1 : 0]) this.chops.shift();
          if (!foe.alive || !this.chops.length) { this.endExec(duel); break; }
          if (dist > 1.5) this.fwd(this.vel).multiplyScalar(1.5);
          else {
            const part = this.chops.shift(), d = part === 'head' ? 'left' : 'high';
            this.atk = { dir: d, thrust: false, exec: true, part }; this.t = 0;
            fig.go([d + 'C', .5, 'io'], [d + 'C', .2], [d + 'M', .07, 'in'], [d + 'E', .08, 'lin']); sfx.windup(false);
          }
        } else {
          fig.striking = this.t > .7 && this.t < .98;
          if (this.t >= .8 && !A.done) { A.done = true; duel.chop(this, foe, A.part); }
          if (this.t >= 1.35) { if (this.chops.length && foe.alive) { this.atk = null; this.t = 0; } else this.endExec(duel); }
        }
        break;
      }
    }
    // shoves and knock-back bleed off quickly
    this.vel.add(this.push); this.push.multiplyScalar(Math.max(0, 1 - 7 * dt));
    this.pos.addScaledVector(this.vel, dt);
    // composure returns when the pressure is off
    if (this.alive && this.state !== 'broken' && time - this.lastPosture > 1.5 && !this.guard)
      this.posture = Math.max(0, this.posture - 11 * (1 - .22 * this.wounds) * dt);
    if (this.alive && this.wounds > 0 && (this.dripT -= dt) < 0) {
      this.dripT = rnd(.25, .7) / this.wounds; G.bleed(fig.chest, _v.set(0, -1, 0), 1, .6, .3);
    }
    fig.yaw = this.yaw; fig.vel.copy(this.vel);
  }
  endExec(duel) { if (duel.over) this.flourish(); else { this.atk = null; this.set('idle'); this.poseName = ''; } }
  flourish() { this.atk = null; this.set('done'); this.fig.go(['flick', .22, 'out'], ['flick', .5], ['rest', .9, 'io']); sfx.flick(); }
}

export class Duel {
  /** a: the player; foes / ais: one or two opponents and their minds */
  constructor(a, foes, ais, emit) {
    this.a = a; this.foes = foes; this.ais = ais; this.emit = emit || (() => {});
    this.all = [a, ...foes]; foes.forEach(f => { f.target = a; }); a.target = foes[0];
    ais.forEach((x, i) => { x.flank = foes.length > 1 ? (i ? -1 : 1) : 0; });
    this.time = 0; this.hitStop = 0; this.slow = 0; this.over = null; this.fountains = []; this.yieldT = 0; this.bind = null; this.swap = false;
  }
  get b() { return this.a.target; }
  get standing() { return this.foes.filter(f => f.alive && !f.spared && f.state !== 'kneel'); }
  get kneeling() { return this.foes.filter(f => f.alive && !f.spared && f.state === 'kneel'); }
  /** every opponent still breathing is on their knees: the victor chooses */
  get awaiting() { return !this.over && this.a.alive && this.a.state !== 'kneel' && !this.standing.length && this.kneeling.length > 0; }
  retarget() {
    const a = this.a; if (a.state === 'execute' || a.state === 'bind') return;
    let pool = this.standing; if (!pool.length) pool = this.kneeling; if (!pool.length) return;
    const d = f => Math.hypot(f.pos.x - a.pos.x, f.pos.z - a.pos.z);
    if (this.swap && pool.length > 1) { a.target = pool.find(f => f !== a.target) || a.target; this.emit('target', a.target); }
    else if (!pool.includes(a.target)) { a.target = pool.reduce((m, f) => d(f) < d(m) ? f : m); this.emit('target', a.target); }
    else if (pool.length > 1 && a.state === 'idle') { const o = pool.find(f => f !== a.target); if (d(o) < d(a.target) - .9) { a.target = o; this.emit('target', o); } }
    this.swap = false;
  }
  step(dt, intent) {
    if (this.hitStop > 0) { this.hitStop -= dt; return; }
    if (this.slow > 0) { this.slow -= dt; dt *= .22; }
    this.time += dt;
    const { a, foes, all } = this;
    this.retarget();
    const ints = foes.map((f, i) => this.ais[i].think(dt, f, a, this));
    a.update(dt, intent, a.target, this); foes.forEach((f, i) => f.update(dt, ints[i], a, this));
    this.tickBind(dt);
    // bodies do not pass through each other, and the ring holds them
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const p = all[i], q = all[j]; if (!p.alive || !q.alive) continue;
      _v.subVectors(q.pos, p.pos).setY(0); let d = _v.length();
      if (d < 1.12) { if (d < 1e-3) { _v.set(0, 0, 1); d = 1; } _v.multiplyScalar((1.12 - d) / d * .5); q.pos.add(_v); p.pos.sub(_v); }
    }
    for (const f of all) { const r = Math.hypot(f.pos.x, f.pos.z); if (r > G.RING - .4) f.pos.multiplyScalar((G.RING - .4) / r); f.fig.update(dt); }
    for (const f of this.fountains) if (this.time < f.until) {
      const k = (f.until - this.time) / f.span;
      G.bleed(f.at, _v.set((Math.random() - .5) * .5 + f.dx, 1, (Math.random() - .5) * .5 + f.dz), Math.ceil(3 * k), (2 + 4.5 * k * (.7 + .3 * Math.sin(this.time * 9))) * f.k, .22);
    }
    // the player on their knees: the opponent does not hesitate, and takes everything
    if (a.state === 'kneel' && !this.over) {
      this.yieldT += dt;
      const ex = foes.find(f => f.alive && f.state === 'idle');
      if (this.yieldT > 1.3 && ex && !foes.some(f => f.state === 'execute')) this.execute(ex, a, true);
    }
  }
  fountain(fig, at, span, k = 1, dx = 0, dz = 0) { this.fountains.push({ fig, at, until: this.time + span, span, k, dx, dz }); }
  execute(vic, target, fatal) {
    if (vic.state !== 'idle' && vic.state !== 'recover') return;
    vic.target = target; vic.chops = fatal ? ['armR', 'armL', 'head'] : ['head']; vic.set('execute'); vic.atk = null; vic.poseName = '';
  }
  spare(vic) {
    if (this.over) return; const k = this.kneeling; if (!k.length) return;
    k.forEach(f => { f.spared = true; }); vic.flourish();
    this.over = { victor: vic, loser: k[0], mercy: this.foes.every(f => f.spared), t: this.time }; this.emit('over', this.over);
  }
  /** one blow of an execution */
  chop(att, def, part) {
    if (part === 'head') return this.kill(att, def, 'left', true);
    const side = part === 'armR' ? 1 : 0, out = def.left(new THREE.Vector3()).multiplyScalar(side ? -1 : 1);
    if (!def.fig.sever(side, out)) return;
    this.fountain(def.fig, def.fig.shW[side], 1.5, .55, out.x * .8, out.z * .8);
    G.bleed(def.fig.shW[side], out.setY(.5), 40, 5, .5); G.look.shake = .6; this.hitStop = .09;
    G.burst('streak', def.fig.shW[side], G.BLOOD, 3.4, .3, _w.set(0, -1, 0), 1.4); G.burst('streak', def.fig.shW[side], 0xffffff, 2.6, .16, _w, 1.5);
    sfx.cut(); sfx.grunt(def.isPlayer); def.fig.go(['hurt', .12, 'out'], ['kneel', .4, 'io']); this.emit('sever', def);
  }

  tickBind(dt) {
    const B = this.bind; if (!B) return;
    const { x, y } = B; B.t += dt;
    if (x.state !== 'bind' || y.state !== 'bind') {                      // someone slipped out, or was cut out of it
      for (const f of [x, y]) if (f.state === 'bind') { f.set('idle'); f.poseName = ''; }
      this.bind = null; return;
    }
    if (Math.random() < dt * 14) G.sparks(_v.copy(x.fig.tip).lerp(y.fig.tip, .5), 2);
    const diff = x.drive - y.drive;
    if (Math.abs(diff) > .32) { this.bind = null; this.clinch(diff > 0 ? x : y, diff > 0 ? y : x); }
    else if (B.t > T.bind) {
      this.bind = null; const away = _v.subVectors(y.pos, x.pos).setY(0).normalize();
      x.push.addScaledVector(away, -3); y.push.addScaledVector(away, 3);
      for (const f of [x, y]) { f.set('clash', .3); f.poseName = ''; f.fig.go([f.stance, .28, 'io']); f.addPosture(8, this); }
      this.emit('unbind');
    }
  }
  /** whoever drove harder through the bind takes the clinch */
  clinch(w, l) {
    const away = _v.subVectors(l.pos, w.pos).setY(0).normalize().clone();
    let kind, post, shove, stun;
    if (l.posture >= 62) { kind = 'throw'; post = 100; shove = 3.5; stun = .7; }
    else if (l.wounds > 0) { kind = 'pommel'; post = 30; shove = 3; stun = .85; }
    else if (Math.random() < .5) { kind = 'kick'; post = 28; shove = 6; stun = .65; }
    else { kind = 'shove'; post = 20; shove = 7.5; stun = .55; }
    const pose = kind === 'throw' ? 'shove' : kind;
    w.set('recover', .42); w.poseName = ''; w.atk = null; w.fig.go([pose, .1, 'out'], [pose, .12], [w.stance, .2, 'io']);
    l.push.addScaledVector(away, shove); l.atk = null; G.look.shake = .55; this.hitStop = .07; G.burst('ring', l.fig.chest, 0x15120f, .8, .28, null, 3); G.inkSplash(l.fig.chest, away, 10); sfx.thud(); sfx.grunt(l.isPlayer); G.puff(l.pos, 8);
    if (!l.addPosture(post, this)) { l.set('stagger', stun); l.poseName = ''; l.fig.go(['reel', .12, 'out'], ['reel', stun - .4], [l.stance, .28, 'io']); }
    this.emit('clinch', w, kind);
  }

  resolve(att, def) {
    const atk = att.atk, dist = _v.subVectors(def.pos, att.pos).setY(0).length();
    att.recoverDur = atk.thrust ? T.thrustRecover : T.recover;
    if (!def.alive || def.state === 'kneel' || def.spared) return;
    if (dist > (atk.thrust ? T.thrustReach : T.reach)) { sfx.whoosh(); att.recoverDur = atk.thrust ? T.thrustRecover + .08 : T.whiff; this.emit('whiff', att); return; }
    if (def.state === 'dodge' && def.dodgeSide && def.t > .02 && def.t < .27 && (atk.thrust || atk.dir === 'high')) {
      sfx.whoosh(); att.recoverDur += .1; this.emit('evade', def); return;
    }
    const mid = _w.copy(att.fig.tip).lerp(def.fig.chest, .5); mid.y = Math.max(mid.y, 1.1);
    const away = _v.multiplyScalar(1 / (dist || 1)).clone();
    // both blades arriving together: they lock
    if (def.state === 'windup' && def.target === att && def.dur - def.t < .12 && !def.atk.exec && !this.bind) {
      for (const f of [att, def]) { f.atk = null; f.drive = 0; f.set('bind'); f.poseName = ''; f.fig.go(['bind', .1, 'out']); }
      G.sparks(mid, 26); sfx.clang(1.25); G.look.shake = .5; this.hitStop = .08;
      G.burst('star', mid, 0xfff3c4, 1.1, .16); G.burst('ring', mid, 0x15120f, .9, .3, null, 3);
      att.addPosture(10, this); def.addPosture(10, this);
      if (att.state === 'bind' && def.state === 'bind') { this.bind = { x: att, y: def, t: 0 }; this.emit('bind'); }
      return;
    }
    const covered = def.state === 'idle' && def.guard && (atk.thrust || (def.stance === MIRROR[atk.dir] && def.stanceT > T.stance));
    if (covered && this.time - def.guardAt <= T.parry) {                  // parry
      const pn = 'p' + cap(def.stance);
      def.fig.go([pn, .05, 'out'], [pn, .12], ['b' + cap(def.stance), .15, 'io']); def.poseName = 'b' + cap(def.stance);
      def.riposteUntil = this.time + .7;
      G.sparks(mid, 34); sfx.parry(); G.look.shake = .45; G.look.flash = .22; this.hitStop = .1;
      G.burst('star', mid, 0xffffff, 1.2, .18); G.burst('ring', mid, 0x15120f, 1, .34, null, 3.6); G.burst('streak', mid, 0xffe9a8, 2.4, .16, away);
      att.atk = null; att.push.addScaledVector(away, -2.4);
      if (!att.addPosture(40, this)) { att.set('stagger', T.stagger); att.poseName = ''; att.fig.go(['reel', .14, 'out'], ['reel', .4], [att.stance, .36, 'io']); }
      this.emit('parry', def); return;
    }
    if (covered) {                                                        // block
      G.sparks(mid, 12); sfx.clang(atk.thrust ? .85 : 1); G.look.shake = .25; this.hitStop = .04;
      G.burst('star', mid, 0xfff3c4, .7, .12); G.inkSplash(mid, away, 6);
      def.push.addScaledVector(away, atk.thrust ? 3 : 2); att.recoverDur = T.recover - .04;
      const pn = 'b' + cap(def.stance), bp = POSE[pn];                     // a jolt through the guard, not a reel
      const jolt = { ...bp, h: bp.h.clone().add(_v.set(0, -.05, -.14)), d: bp.d.clone(), lean: bp.lean - .12 };
      def.fig.go([jolt, .05, 'out'], [pn, .22, 'io']); def.poseName = pn; def.addPosture(atk.thrust ? 32 : 22, this);
      this.emit('block', def); return;
    }
    if (def.state === 'broken') { this.kill(att, def, atk.thrust ? 'thrust' : atk.dir); return; }
    // a clean cut
    def.wounds++; def.atk = null;
    const sweep = this.sweep(att, atk, new THREE.Vector3());
    G.bleed(def.fig.chest, sweep, 46, 5.5, .5); G.look.shake = .7; this.hitStop = .13; this.slow = .25;
    G.burst('streak', def.fig.chest, 0xffffff, 3.2, .2, sweep, 1.5); G.burst('streak', def.fig.chest, G.BLOOD, 4.2, .34, sweep, 1.4); G.inkSplash(def.fig.chest, sweep, 12); G.look.flash = .18;
    sfx.cut(); sfx.grunt(def.isPlayer);
    def.push.addScaledVector(away, 3.4); def.posture = Math.min(96, def.posture + 18); def.lastPosture = this.time;
    if (def.wounds >= MAX_WOUNDS) {
      def.set('kneel'); def.fig.go(['hurt', .2, 'out'], ['kneel', .6, 'io']); def.fig.dropSword(); this.yieldT = 0; this.emit('yield', def);
    } else { def.set('hit', T.hit); def.poseName = ''; def.fig.go(['hurt', .12, 'out'], ['hurt', .2], [def.stance, .22, 'io']); this.emit('wound', def); }
  }
  sweep(att, atk, out) {
    if (atk.thrust) return att.fwd(out).setY(.25);
    if (atk.dir === 'high') return att.fwd(out).multiplyScalar(.5).setY(.9);
    return att.left(out).multiplyScalar(atk.dir === 'left' ? -1 : 1).setY(.45);
  }
  kill(att, def, how, exec) {
    if (!def.alive) return;
    def.alive = false; def.set('dead'); def.atk = null; def.wounds = MAX_WOUNDS;
    const sw = this.sweep(att, { dir: how, thrust: how === 'thrust' }, new THREE.Vector3());
    const fig = def.fig;
    if (how === 'left' || how === 'right') {
      fig.behead(sw); this.fountain(fig, fig.neckW, 2.6);
      fig.go(['kneel', exec ? .3 : .55, 'io'], ['kneel', .35], ['deadF', .8, 'in']);
      G.bleed(fig.neckW, sw, 60, 6, .5);
    } else if (how === 'high') {
      G.bleed(fig.chest, sw, 110, 7.5, .7); fig.go(['reel', .28, 'out'], ['deadB', .85, 'in']);
    } else {
      G.bleed(fig.chest, sw, 80, 7, .35); fig.go(['hurt', .3, 'out'], ['kneel', .5, 'io'], ['deadF', .8, 'in']);
    }
    const back = how === 'high' ? -.5 : .5;
    setTimeout(() => G.pool(def.pos.x + Math.sin(def.yaw) * back, def.pos.z + Math.cos(def.yaw) * back, .5), 1700);
    sfx.kill(); if (!exec) att.recoverDur = .7;
    const last = def === this.a || !this.foes.some(f => f.alive && !f.spared);
    G.look.shake = 1; G.look.flash = .5; this.hitStop = .16; this.slow = last ? 1.5 : .5;
    const at = how === 'left' || how === 'right' ? fig.neckW : fig.chest;
    G.burst('streak', at, 0xffffff, 5, .3, sw, 1.5); G.burst('streak', at, G.BLOOD, 7, .6, sw, 1.3); G.burst('ring', at, G.BLOOD, 1.2, .5, null, 4); G.inkSplash(at, sw, 26);
    if (!last) { this.emit('down', def); return; }
    this.over = { victor: att, loser: def, how, t: this.time, mercy: false }; this.emit('over', this.over);
    if (!exec) setTimeout(() => { if (att.alive && att.state !== 'done') att.flourish(); }, 1500);
  }
}

/* ---------- the opponent's mind ---------- */
export class AI {
  /** p: react, block, parry, dodge, aggr, mix, feint, thrust, track, punish, range */
  constructor(p) {
    this.p = p; this.I = { mx: 0, mz: 0, stance: null, attack: false, thrust: false, guard: false, dodge: false };
    this.seen = 0; this.plan = null; this.atkT = rnd(1.2, 2); this.strafe = 1; this.strafeT = 1; this.stT = 1;
    this.guardUntil = 0; this.queue = null; this.feintAt = 0; this.punished = null; this.flank = 0; this.engaged = false; this.inBind = false;
  }
  think(dt, me, foe, duel) {
    const I = this.I, p = this.p, time = duel.time;
    I.attack = I.thrust = I.dodge = false; I.stance = null; I.mx = I.mz = 0;
    this.engaged = !!this.queue || me.state === 'windup' || me.state === 'strike';
    if (!me.alive || duel.over || me.state === 'kneel' || foe.state === 'kneel' || me.spared) { I.guard = false; this.engaged = false; this.queue = null; return I; }
    if (me.state === 'bind') {                                           // lean in, or give ground
      if (!this.inBind) { this.inBind = true; this.bindPush = Math.random() < .3 + p.aggr * .55; this.bindLag = rnd(.1, .4); }
      I.mz = this.bindPush && me.t > this.bindLag ? 1 : 0; I.guard = false; return I;
    }
    this.inBind = false;
    const dist = Math.hypot(foe.pos.x - me.pos.x, foe.pos.z - me.pos.z);

    // read an incoming attack once, then act on the read after a human delay
    if (foe.state === 'windup' && foe.atkId !== this.seen && dist < 4.2) {
      this.seen = foe.atkId; const r = Math.random(), impact = time + foe.dur - foe.t;
      const need = foe.atk.thrust ? me.stance : MIRROR[foe.atk.dir], late = foe.atk.rip ? .5 : 1;
      if (r < p.parry * late) this.plan = { kind: 'parry', setAt: time + p.react, at: impact - rnd(.05, .15), stance: need };
      else if (r < (p.parry + p.block) * late) this.plan = { kind: 'block', setAt: time + p.react * rnd(.8, 1.4), stance: need, until: impact + .22 };
      else if (r < (p.parry + p.block + p.dodge) * late) this.plan = { kind: 'dodge', at: impact - .2, side: Math.random() < .5 ? 1 : -1 };
      else this.plan = Math.random() < .5 ? { kind: 'block', setAt: time + p.react, stance: me.stance, until: impact + .2 } : null;
    }
    const pl = this.plan;
    if (pl) {
      if (pl.kind === 'block' && time >= pl.setAt) { I.stance = pl.stance; this.guardUntil = pl.until; this.plan = null; this.queue = null; }
      else if (pl.kind === 'parry') {
        if (time >= pl.setAt) I.stance = pl.stance;
        if (time >= pl.at) { this.guardUntil = pl.at + .32; this.plan = null; this.queue = { dir: DIRS[Math.random() * 3 | 0], rip: true }; }
      } else if (pl.kind === 'dodge' && time >= pl.at) { I.dodge = true; I.mx = pl.side; this.plan = null; }
    }
    I.guard = time < this.guardUntil;
    if (this.feintAt && me.state === 'windup' && time >= this.feintAt) {
      this.feintAt = 0; I.guard = true; this.guardUntil = 0;
      const o = DIRS.filter(d => d !== me.stance); this.queue = { dir: o[Math.random() * 2 | 0] };
    }
    if (me.state !== 'idle') { if (me.state !== 'windup') this.feintAt = 0; return I; }
    if (I.guard || pl) return I;

    // an opening: the foe reeling, broken, or caught recovering from a miss
    const open = foe.state === 'broken' || foe.state === 'stagger' || (foe.state === 'recover' && foe.dur > .45);
    if (open && !this.queue && this.punished !== foe.state + foe.atkId + (foe.t < .1)) {
      this.punished = foe.state + foe.atkId + (foe.t < .1);
      if (foe.state === 'broken' || Math.random() < p.punish) this.queue = { dir: DIRS[Math.random() * 3 | 0], now: true };
    }
    const q = this.queue;
    if (q) {
      if (dist > T.reach + .7) I.mz = 1;
      else if (!q.thrust && me.stance !== q.dir) I.stance = q.dir;
      else if (me.stanceT > .12) {
        if (q.thrust) I.thrust = true; else I.attack = true;
        this.feintAt = q.feint ? time + T.wind * rnd(.35, .5) : 0; this.queue = null;
      }
      return I;
    }
    // footwork: hold the measure, drift around it
    const mate = duel.ais.find(x => x !== this && x.engaged);             // two on one: only one blade comes in at a time
    const want = (p.range ?? 2.15) + (mate ? .8 : 0), hurt = me.posture > 68;
    if (dist > want + (hurt ? 1.2 : .25)) I.mz = hurt ? 0 : 1; else if (dist < want - .45 || hurt && dist < want + .8) I.mz = -1;
    if ((this.strafeT -= dt) < 0) { this.strafeT = rnd(1.2, 3.2); this.strafe = [1, -1, 0][Math.random() * 3 | 0]; }
    I.mx = this.flank && duel.standing.length > 1 ? this.flank * .8 : this.strafe * .55;
    // guard: follow the foe's blade, or guess
    if ((this.stT -= dt) < 0) {
      this.stT = rnd(.45, 1.3);
      const s = Math.random() < p.track ? MIRROR[foe.stance] : DIRS[Math.random() * 3 | 0];
      if (s !== me.stance) I.stance = s;
    }
    // attack
    if (dist < T.reach + .9 && !hurt && !mate) this.atkT -= dt;
    if (this.atkT <= 0 && foe.alive) {
      this.atkT = (2.1 - 1.5 * p.aggr) * rnd(.6, 1.4) * (this.flank && duel.standing.length > 1 ? 1.6 : 1);
      if (Math.random() < p.thrust + (foe.guard ? .22 : 0)) this.queue = { thrust: true };
      else {
        const openDirs = DIRS.filter(d => MIRROR[d] !== foe.stance);
        const dir = Math.random() < p.mix ? openDirs[Math.random() * openDirs.length | 0] : DIRS[Math.random() * 3 | 0];
        this.queue = { dir, feint: Math.random() < p.feint };
      }
    }
    return I;
  }
}
