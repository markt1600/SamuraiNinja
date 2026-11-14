/* ZAN — the figure: a posed ink-drawn swordsman. The sword is animated, the
   body follows it: hands by IK to the hilt, feet planted and stepping. */
import * as THREE from 'three';
import { toon, flat, scene, Trail, footprint, puff, BLOOD, FX } from 'zan/gfx';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), _a = V(), _b = V(), _c = V(), _d = V(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- poses (fighter space: +Z ahead, +X own left, Y up) ---------- */
function P(h, d, o = {}) {
  return { h: V(...h), d: V(...d).normalize(), lean: o.lean || 0, twist: o.twist || 0, roll: o.roll || 0,
    hy: o.hy ?? .9, hz: o.hz || 0, nod: o.nod || 0, limp: o.limp || 0, kick: o.kick || 0 };
}
const mir = p => ({ ...p, h: V(-p.h.x, p.h.y, p.h.z), d: V(-p.d.x, p.d.y, p.d.z), twist: -p.twist, roll: -p.roll });
export const POSE = {
  // the three guards
  high:  P([0, 1.6, .14], [0, .86, -.5], { hy: .9 }),
  left:  P([.2, 1.2, .24], [.34, .92, -.18], { twist: .3, hy: .88 }),
  // cuts: chamber -> through -> end
  highC: P([0, 1.7, -.04], [0, .45, -.9], { lean: -.1, hy: .92 }),
  highM: P([0, 1.55, .34], [0, .75, .66], { lean: .12, hy: .86, hz: .15 }),
  highE: P([0, 1.02, .52], [0, -.42, .9], { lean: .34, hy: .78, hz: .3 }),
  leftC: P([.34, 1.34, 0], [.7, .5, -.5], { twist: .8, hy: .88 }),
  leftM: P([.12, 1.24, .46], [.86, .04, .5], { twist: .05, lean: .12, hy: .84, hz: .15 }),
  leftE: P([-.26, 1.1, .4], [-.8, -.2, .56], { twist: -.7, lean: .24, hy: .8, hz: .3 }),
  thrC:  P([-.2, 1.1, -.08], [.06, .04, 1], { twist: -.55, hy: .84, lean: .05 }),
  thrE:  P([-.02, 1.22, .66], [0, .02, 1], { twist: .3, lean: .36, hy: .76, hz: .42 }),
  // blocks: the blade meets the line of the cut
  bHigh: P([-.24, 1.6, .34], [.96, .26, .08], { lean: -.04, hy: .86 }),
  bLeft: P([.3, 1.02, .36], [.04, 1, .06], { twist: .15, hy: .84 }),
  // parry: the same line, thrown forward
  pHigh: P([-.2, 1.72, .5], [.94, .32, .1], { lean: .1, hy: .86, hz: .1 }),
  pLeft: P([.42, 1.12, .52], [.2, .96, .2], { twist: .25, lean: .08, hy: .84, hz: .1 }),
  // taking it
  reel:  P([-.36, 1.05, .08], [-.62, .34, .7], { lean: -.3, twist: -.4, hy: .84, nod: -.3 }),
  hurt:  P([-.2, .95, .2], [-.5, .1, .85], { lean: .3, twist: .45, hy: .78, nod: .4 }),
  broken:P([-.3, .62, .3], [-.5, -.6, .62], { lean: .5, hy: .66, nod: .6 }),
  kneel: P([-.3, .2, .42], [-.5, -.08, .86], { lean: .32, hy: .5, nod: .55 }),
  deadF: P([-.34, .05, .6], [-.5, 0, .86], { lean: 1.5, hy: .14, nod: .1, limp: 1 }),
  deadB: P([-.4, .05, -.2], [-.9, 0, -.3], { lean: -1.5, hy: .13, limp: 1 }),
  // ceremony
  flick: P([-.5, .95, .16], [-.55, -.72, .42], { twist: -.2, hy: .9 }),
  rest:  P([-.26, .9, .2], [-.2, -.9, .4], { hy: .93 }),
  dodge: P([.1, 1.1, .2], [.5, .8, .2], { hy: .74, lean: .15 }),
  // the bind and what comes out of it
  bind:  P([-.04, 1.28, .5], [.5, .84, .2], { lean: .2, hy: .82, hz: .2 }),
  shove: P([0, 1.3, .66], [.62, .76, .16], { lean: .34, hy: .8, hz: .34 }),
  pommel:P([.04, 1.42, .62], [-.25, .55, -.8], { lean: .26, hy: .84, hz: .3, twist: .3 }),
  kick:  P([-.2, 1.2, .1], [.3, .9, -.3], { lean: -.22, hy: .9, kick: 1 }),
};
POSE.right = mir(POSE.left); POSE.rightC = mir(POSE.leftC); POSE.rightM = mir(POSE.leftM); POSE.rightE = mir(POSE.leftE);
POSE.bRight = mir(POSE.bLeft); POSE.pRight = mir(POSE.pLeft);

const clonePose = p => ({ ...p, h: p.h.clone(), d: p.d.clone() });
function slerpDir(out, a, b, t) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1), th = Math.acos(dot);
  if (th < 1e-3) return out.copy(b);
  const s = Math.sin(th); return out.copy(a).multiplyScalar(Math.sin((1 - t) * th) / s).addScaledVector(b, Math.sin(t * th) / s);
}
function blend(out, a, b, t) {
  out.h.lerpVectors(a.h, b.h, t); slerpDir(out.d, a.d, b.d, t);
  for (const k of ['lean', 'twist', 'roll', 'hy', 'hz', 'nod', 'limp', 'kick']) out[k] = lerp(a[k], b[k], t);
}
const EASE = {
  lin: t => t, out: t => 1 - (1 - t) ** 3, in: t => t * t * t, io: t => t * t * (3 - 2 * t),
  back: t => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
};

function twoBone(a, t, l1, l2, pole, mid, end) {
  _a.subVectors(t, a); let dist = _a.length(); const max = l1 + l2 - .002;
  if (dist < 1e-4) { _a.set(0, -1, 0); dist = 1e-4; }
  _a.multiplyScalar(1 / dist); dist = Math.min(dist, max);
  const proj = (l1 * l1 + dist * dist - l2 * l2) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - proj * proj));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1); _b.normalize();
  mid.copy(a).addScaledVector(_a, proj).addScaledVector(_b, h);
  end.copy(a).addScaledVector(_a, dist);
}

const cyl = (rTop, rBot, seg = 10) => new THREE.CylinderGeometry(rTop, rBot, 1, seg).translate(0, .5, 0);
const GEO = {
  thigh: cyl(.118, .112), shin: cyl(.175, .12), upper: cyl(.082, .07), fore: cyl(.1, .084),
  torso: cyl(.215, .165, 12), skirt: cyl(.25, .175, 12), neck: cyl(.05, .055, 8),
  head: new THREE.SphereGeometry(.125, 14, 10), hand: new THREE.SphereGeometry(.046, 8, 6),
  hair: new THREE.SphereGeometry(.134, 14, 8, 0, Math.PI * 2, 0, Math.PI * .56),
  knot: new THREE.CylinderGeometry(.03, .04, .1, 6), kasa: new THREE.ConeGeometry(.37, .17, 14),
  band: new THREE.CylinderGeometry(.139, .139, .036, 14), foot: new THREE.BoxGeometry(.1, .06, .25).translate(0, 0, .045),
  blade: new THREE.BoxGeometry(.007, .78, .034).translate(0, .47, 0), tsuba: new THREE.CylinderGeometry(.046, .046, .012, 10).translate(0, .075, 0),
  grip: new THREE.CylinderGeometry(.016, .019, .27, 8).translate(0, -.065, 0), saya: new THREE.CylinderGeometry(.022, .017, .8, 8),
  stump: new THREE.CylinderGeometry(.052, .052, .02, 8),
};
const L_TH = .46, L_SH = .45, L_UA = .3, L_FA = .29;

export class Figure {
  /** look: {gi, hakama, skin, hair, hat:'kasa'|'knot'|'band', band} */
  constructor(look) {
    this.root = new THREE.Group(); scene.add(this.root);
    const gi = this.gi = toon(look.gi), hk = toon(look.hakama), skin = toon(look.skin ?? 0xe8cfb4), dark = toon(0x1b1716);
    const add = (g, m, parent = this.root) => { const o = new THREE.Mesh(g, m); o.castShadow = true; parent.add(o); return o; };
    this.m = {
      torso: add(GEO.torso, gi), skirt: add(GEO.skirt, hk), neck: add(GEO.neck, skin),
      thL: add(GEO.thigh, hk), shL: add(GEO.shin, hk), thR: add(GEO.thigh, hk), shR: add(GEO.shin, hk),
      ftL: add(GEO.foot, dark), ftR: add(GEO.foot, dark),
      uaL: add(GEO.upper, gi), faL: add(GEO.fore, gi), uaR: add(GEO.upper, gi), faR: add(GEO.fore, gi),
      hdL: add(GEO.hand, skin), hdR: add(GEO.hand, skin),
      saya: add(GEO.saya, toon(look.saya ?? 0x3a1512)), stump: add(GEO.stump, flat(BLOOD)),
      stL: add(GEO.hand, flat(BLOOD)), stR: add(GEO.hand, flat(BLOOD)),
    };
    this.m.torso.scale.z = .64; this.m.skirt.scale.z = .74; this.m.stump.visible = this.m.stL.visible = this.m.stR.visible = false; this.m.stL.scale.setScalar(1.5); this.m.stR.scale.setScalar(1.5);
    // chest dressing: white under-collar, obi and its knot ride the torso
    this.chestG = new THREE.Group(); this.root.add(this.chestG);
    const white = toon(look.collar ?? 0xf1ece0), obi = toon(look.obi ?? 0x16130f);
    for (const sx of [-1, 1]) { const l = add(new THREE.BoxGeometry(.036, .34, .02), white, this.chestG); l.position.set(sx * .052, .33, .128); l.rotation.z = sx * .36; l.rotation.x = -.1; }
    const ob = add(new THREE.CylinderGeometry(.176, .172, .1, 12), obi, this.chestG); ob.scale.z = .68; ob.position.y = .02;
    const kn = add(new THREE.BoxGeometry(.1, .06, .04), obi, this.chestG); kn.position.set(.03, .02, .125);
    const sh = add(new THREE.BoxGeometry(.5, .035, .2), this.gi, this.chestG); sh.position.set(0, .45, 0);     // squared shoulders
    this.headG = new THREE.Group(); this.root.add(this.headG);
    add(GEO.head, skin, this.headG);
    const ink = flat(0x15120f);
    for (const sx of [-1, 1]) {
      const e = add(new THREE.BoxGeometry(.032, .012, .01), ink, this.headG); e.position.set(sx * .046, .012, .118); e.castShadow = false;
      const b = add(new THREE.BoxGeometry(.046, .01, .01), ink, this.headG); b.position.set(sx * .046, .042, .116); b.rotation.z = -sx * .28; b.castShadow = false;
    }
    if (look.hat === 'kasa') { const k = add(GEO.kasa, toon(0xc7ad72), this.headG); k.position.y = .12; }
    else {
      const h = add(GEO.hair, toon(look.hair ?? 0x18120f), this.headG); h.rotation.x = -.28;
      const k = add(GEO.knot, toon(look.hair ?? 0x18120f), this.headG); k.position.set(0, .14, -.05); k.rotation.x = -.5;
    }
    if (look.band) { const b = add(GEO.band, flat(look.band), this.headG); b.position.y = .035; b.rotation.x = -.12; }
    this.sword = new THREE.Group(); this.root.add(this.sword);
    add(GEO.blade, toon(0xeef2f6), this.sword); const hb = add(new THREE.CylinderGeometry(.014, .014, .03, 6), toon(0xc9a24a), this.sword); hb.position.y = .095; hb.scale.z = 1.8; add(GEO.tsuba, dark, this.sword); add(GEO.grip, toon(look.grip ?? 0x2a2a30), this.sword);
    this.trail = new Trail(); this.glint = new Trail(8, [1, 1, 1], .95); this._g0 = V(); this._g1 = V();
    this.pose = clonePose(POSE.rest); this.from = clonePose(POSE.rest); this.keys = []; this.kt = 0;
    this.feet = [{ p: V(), from: V(), to: V(), t: -1, home: [.15, -.25] }, { p: V(), from: V(), to: V(), t: -1, home: [-.12, .24] }];
    this.pos = V(); this.yaw = 0; this.vel = V(); this.striking = false;
    this.tip = V(); this.base = V(); this.chest = V(); this.neckW = V(); this.headless = false; this.pieces = []; this.armOff = [false, false]; this.shW = [V(), V()]; this.swordGone = false;
    if (look.tails) this.tails = new Tails(look.tails, this.headG);
    this.breath = Math.random() * 6;
  }
  dispose() { scene.remove(this.root); scene.remove(this.trail.mesh); scene.remove(this.glint.mesh); for (const o of this.pieces) scene.remove(o.g); if (this.tails) scene.remove(this.tails.mesh); }

  /** queue pose keys: [name|pose, seconds, ease] ...; replaces whatever was playing */
  go(...keys) { this.from = clonePose(this.pose); this.keys = keys.map(k => ({ p: typeof k[0] === 'string' ? POSE[k[0]] : k[0], d: Math.max(.001, k[1]), e: EASE[k[2] || 'out'] })); this.kt = 0; }
  snap(name) { this.pose = clonePose(POSE[name]); this.from = clonePose(this.pose); this.keys = []; }
  place(x, z, yaw) {
    this.pos.set(x, 0, z); this.yaw = yaw; this.vel.set(0, 0, 0);
    for (const f of this.feet) { this.homeOf(f, f.p); f.t = -1; }
  }
  homeOf(f, out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), hx = f.home[0], hz = f.home[1] + (f.home[1] > 0 ? this.pose.hz * 1.25 : this.pose.hz * .2);
    return out.set(this.pos.x + hx * c + hz * s, 0, this.pos.z - hx * s + hz * c);
  }

  update(dt) {
    // pose track
    if (this.keys.length) {
      const k = this.keys[0]; this.kt += dt;
      const t = Math.min(1, this.kt / k.d); blend(this.pose, this.from, k.p, k.e(t));
      if (t >= 1) { this.from = clonePose(k.p); this.keys.shift(); this.kt = 0; }
    }
    const p = this.pose, R = this.root;
    R.position.copy(this.pos); R.rotation.y = this.yaw;
    this.breath += dt;
    const br = Math.sin(this.breath * 1.7) * .006 * (1 - p.limp);

    // feet: planted in the world, stepping when the body leaves them behind
    const sp = this.vel.length();
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], o = this.feet[1 - i];
      this.homeOf(f, _a).addScaledVector(this.vel, .13);
      if (f.t >= 0) {
        f.t += dt / (sp > 3.4 ? .11 : .17); f.to.copy(_a);
        const t = Math.min(1, f.t); f.p.lerpVectors(f.from, f.to, t * t * (3 - 2 * t)); f.p.y = Math.sin(t * Math.PI) * .09;
        if (t >= 1) { f.t = -1; f.p.y = 0; if (!p.limp) { footprint(f.p.x, f.p.z, this.yaw); if (sp > 3.4) puff(f.p, 3); } this.onStep && this.onStep(sp); }
      } else if (p.limp < .5) {
        const d = _b.subVectors(_a, f.p).setY(0).length();
        if (d > (o.t >= 0 ? .62 : .2 + (sp < .2 ? .12 : 0))) { f.t = 0; f.from.copy(f.p); f.to.copy(_a); }
      }
    }

    // joints, in fighter space
    const hip = _j.hip.set(0, p.hy + br, p.hz);
    const lift = (this.feet[0].p.y + this.feet[1].p.y) * .25; hip.y += lift;
    const qC = _j.qC.setFromEuler(_e.set(p.lean, p.twist, p.roll, 'YXZ'));
    const qH = _j.qH.setFromEuler(_e.set(p.lean * .35, p.twist * .35, 0, 'YXZ'));
    const neck = _j.neck.set(0, .5, 0).applyQuaternion(qC).add(hip);
    const qHead = _j.qHead.setFromEuler(_e.set(p.lean * (p.limp ? 1 : .35) + p.nod, p.twist * .3, p.roll * .5, 'YXZ'));

    const M = this.m;
    this.chestG.position.copy(hip); this.chestG.quaternion.copy(qC);
    M.torso.position.copy(hip).addScaledVector(_a.set(0, -.06, 0).applyQuaternion(qC), 1); M.torso.quaternion.copy(qC); M.torso.scale.y = .58;
    M.skirt.position.copy(hip).add(_a.set(0, .04, 0)); M.skirt.quaternion.copy(qH).multiply(_q.setFromAxisAngle(_c.set(1, 0, 0), Math.PI)); M.skirt.scale.y = .34;
    M.saya.position.copy(_a.set(.2, -.02, -.1).applyQuaternion(qH).add(hip)); M.saya.quaternion.copy(qH).multiply(_q.setFromEuler(_e.set(1.25, 0, .12)));
    seg(M.neck, neck, _a.set(0, .08, 0).applyQuaternion(qHead).add(neck));
    if (!this.headless) { this.headG.position.copy(_a.set(0, .17, .01).applyQuaternion(qHead).add(neck)); this.headG.quaternion.copy(qHead); }
    M.stump.position.copy(_a.set(0, .08, 0).applyQuaternion(qHead).add(neck)); M.stump.quaternion.copy(qHead);

    // legs
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    for (let i = 0; i < 2; i++) {
      const sgn = i ? -1 : 1, f = this.feet[i];
      const hj = _j.a.set(sgn * .1, -.03, 0).applyQuaternion(qH).add(hip);
      const dx = f.p.x - this.pos.x, dz = f.p.z - this.pos.z;
      const ank = _j.b.set(dx * c + dz * s, f.p.y + .07, -dx * s + dz * c);
      if (i && p.kick > 0) ank.lerp(_c.set(-.08, .78, .92), p.kick);
      twoBone(hj, ank, L_TH, L_SH, _c.set(sgn * .35, .1, 1), _j.mid, _j.end);
      seg(i ? M.thR : M.thL, hj, _j.mid); seg(i ? M.shR : M.shL, _j.mid, _j.end);
      const ft = i ? M.ftR : M.ftL; ft.position.copy(_j.end).setY(_j.end.y - .04); ft.rotation.set(0, sgn * .22 * (i ? .4 : 1.6), 0);
    }

    // sword and arms
    const grip = _j.grip.copy(p.h); grip.y += (hip.y - .9) * .8; grip.z += p.hz * .6;
    const shR = _j.sR.set(-.2, .42, 0).applyQuaternion(qC).add(hip), shL = _j.sL.set(.2, .42, 0).applyQuaternion(qC).add(hip);
    twoBone(shR, grip, L_UA, L_FA, _c.set(-.6, -.8, -.35).applyQuaternion(qC), _j.mid, _j.end);
    if (!this.swordGone) grip.copy(_j.end);          // the sword never leaves the hand
    seg(M.uaR, shR, _j.mid); seg(M.faR, _j.mid, _j.end); M.hdR.position.copy(_j.end); M.stR.position.copy(shR);
    const lh = _j.b.copy(grip).addScaledVector(p.d, -.15);
    if (p.limp > .5) lh.set(.34, .05, shL.z + .2);
    twoBone(shL, lh, L_UA, L_FA, _c.set(.6, -.8, -.35).applyQuaternion(qC), _j.mid, _j.end);
    seg(M.uaL, shL, _j.mid); seg(M.faL, _j.mid, _j.end); M.hdL.position.copy(_j.end); M.stL.position.copy(shL);
    if (!this.swordGone) { this.sword.position.copy(grip); this.sword.quaternion.setFromUnitVectors(UP, p.d); }

    // world-space handles for the rules and the effects
    R.updateMatrixWorld(true);
    this.base.copy(grip).addScaledVector(p.d, .1).applyMatrix4(R.matrixWorld);
    this.tip.copy(grip).addScaledVector(p.d, .86).applyMatrix4(R.matrixWorld);
    this.chest.set(0, .34, 0).applyQuaternion(qC).add(hip).applyMatrix4(R.matrixWorld);
    this.neckW.copy(neck).applyMatrix4(R.matrixWorld);
    this.shW[0].copy(shL).applyMatrix4(R.matrixWorld); this.shW[1].copy(shR).applyMatrix4(R.matrixWorld);
    if (this.tails) this.tails.update(dt);
    this.trail.push(this.base, this.tip, this.striking, dt);
    this.glint.push(this._g0.lerpVectors(this.base, this.tip, .55), this._g1.lerpVectors(this.base, this.tip, .97), this.striking, dt);

    for (const o of this.pieces) {
      if (o.rest) continue;
      o.v.y -= 9.8 * dt; o.g.position.addScaledVector(o.v, dt);
      if (o.roll) {
        if (o.g.position.y < o.h) { o.g.position.y = o.h; if (o.v.y < -1) o.v.y *= -.32; else o.v.y = 0; o.v.x *= 1 - 2.2 * dt; o.v.z *= 1 - 2.2 * dt; }
        const hs = Math.hypot(o.v.x, o.v.z); o.g.rotateOnWorldAxis(_a.set(o.v.z, 0, -o.v.x).normalize(), hs * dt / o.h || 0);
      } else {
        o.g.rotateOnWorldAxis(o.axis, o.spin * dt);
        if (o.g.position.y < o.h) {
          o.g.position.y = o.h;
          if (o.v.y < -2.2) { o.v.y *= -.25; o.v.x *= .5; o.v.z *= .5; o.spin *= .5; }
          else { o.rest = true; o.g.quaternion.setFromEuler(_e.set(Math.PI / 2, o.yaw, 0, 'YXZ')); puff(o.g.position, 4); }
        }
      }
    }
  }

  /** the head leaves the shoulders */
  behead(dir) {
    if (this.headless) return; this.headless = true; this.m.stump.visible = true;
    this.headG.updateMatrixWorld(true); const g = this.headG; scene.attach(g);
    this.pieces.push({ g, roll: true, h: .125, v: V(dir.x * 2.6, 3.4, dir.z * 2.6) });
  }
  /** an arm comes off at the shoulder; side 0 = left, 1 = right */
  sever(side, dir) {
    if (this.armOff[side]) return false; this.armOff[side] = true;
    const M = this.m; for (const k of side ? ['uaR', 'faR', 'hdR'] : ['uaL', 'faL', 'hdL']) M[k].visible = false;
    (side ? M.stR : M.stL).visible = true;
    const g = new THREE.Group(), arm = new THREE.Mesh(GEO.upper, this.gi), hand = new THREE.Mesh(GEO.hand, M.hdL.material), cap = new THREE.Mesh(GEO.stump, M.stump.material);
    arm.scale.y = .56; arm.castShadow = true; hand.position.y = .6; g.add(arm, hand, cap);
    g.position.copy(this.shW[side]); g.rotation.x = Math.PI; scene.add(g);
    this.pieces.push({ g, h: .08, spin: 7, yaw: Math.random() * 6, axis: V(dir.z, 0, -dir.x).normalize(), v: V(dir.x * 2.2 + (Math.random() - .5), 2.8, dir.z * 2.2 + (Math.random() - .5)) });
    return true;
  }
  /** the sword falls from the hand */
  dropSword() {
    if (this.swordGone) return; this.swordGone = true; this.striking = false;
    this.root.updateMatrixWorld(true); scene.attach(this.sword);
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    this.pieces.push({ g: this.sword, h: .03, spin: 3, yaw: this.yaw + 1.2, axis: V(c, 0, -s), v: V(-c * .8, .6, s * .8) });
  }
}

/* headband tails: two verlet ribbons that trail every movement */
class Tails {
  constructor(color, head) {
    this.head = head; this.n = 6; this.r = [0, 1].map(() => Array.from({ length: 6 }, () => ({ p: V(), q: V() })));
    this.pos = new Float32Array(2 * 6 * 2 * 3); const idx = [];
    for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) { const a = (r * 6 + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false }));
    this.mesh.layers.set(FX); this.mesh.frustumCulled = false; scene.add(this.mesh); this.init = false; this.t = 0;
  }
  update(dt) {
    const h = this.head; h.updateMatrixWorld(true); dt = Math.min(dt, .033);
    for (let r = 0; r < 2; r++) {
      const pts = this.r[r]; _a.set(r ? -.035 : .035, .03, -.138).applyMatrix4(h.matrixWorld);
      if (!this.init) for (const o of pts) { o.p.copy(_a); o.q.copy(_a); }
      pts[0].p.copy(_a);
      for (let i = 1; i < 6; i++) {
        const o = pts[i]; _b.subVectors(o.p, o.q).multiplyScalar(.965); o.q.copy(o.p);
        o.p.add(_b); o.p.y -= 9 * dt * dt; o.p.x += (.9 + Math.sin(this.t * 2.3 + i + r) * .7) * dt * dt;
        if (o.p.y < .02) o.p.y = .02;
      }
      for (let k = 0; k < 3; k++) for (let i = 1; i < 6; i++) {
        const a = pts[i - 1].p, b = pts[i].p; _b.subVectors(b, a); const l = _b.length() || 1e-4; b.copy(a).addScaledVector(_b, .085 / l);
      }
      for (let i = 0; i < 6; i++) {
        const o = (r * 6 + i) * 6, q = pts[i].p, w = .02 + i * .002;
        this.pos[o] = q.x; this.pos[o + 1] = q.y + w; this.pos[o + 2] = q.z; this.pos[o + 3] = q.x; this.pos[o + 4] = q.y - w; this.pos[o + 5] = q.z;
      }
    }
    this.init = true; this.t = (this.t || 0) + dt; this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
const _j = { hip: V(), neck: V(), a: V(), b: V(), mid: V(), end: V(), grip: V(), sR: V(), sL: V(),
  qC: new THREE.Quaternion(), qH: new THREE.Quaternion(), qHead: new THREE.Quaternion() };
function seg(mesh, a, b) {
  mesh.position.copy(a); _d.subVectors(b, a); const l = _d.length() || 1e-4;
  mesh.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / l)); mesh.scale.y = l;
}
