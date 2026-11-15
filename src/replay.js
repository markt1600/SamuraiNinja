/* ZAN — replay: a tape of figure snapshots and effect calls, played back
   slowly from a different seat. */
import * as G from 'zan/gfx';

const KEEP = 11;
let tape = [], fx = [], clock = 0, play = null;
const FX = { bleed: G.bleed, sparks: G.sparks, inkSplash: G.inkSplash, puff: G.puff, spray: G.spray, gush: G.gush, burst: G.burst };
const log = (name, args) => fx.push({ t: clock, name, args });

export function reset() { tape = []; fx = []; play = null; G.fxTap.on = log; }
/** call once per simulation step with the duel clock */
export function record(t, figs) {
  clock = t; if (tape.length && t <= tape[tape.length - 1].t) return;
  tape.push({ t, s: figs.map(f => f.snapshot()) });
  while (tape.length && tape[0].t < t - KEEP) tape.shift();
  while (fx.length && fx[0].t < t - KEEP) fx.shift();
}
export function start(from, killT) {
  if (tape.length < 10) return false;
  const t0 = Math.max(tape[0].t, from), t1 = Math.min(tape[tape.length - 1].t, killT + 1.5);
  play = { t: t0, t0, t1, killT, i: 0, fi: fx.findIndex(e => e.t >= t0) }; if (play.fi < 0) play.fi = fx.length;
  G.fxTap.on = null; return true;
}
export const state = () => play;
/** advance and pose the figures; true when the tape has run out */
export function tick(dt, figs) {
  const P = play, near = P.t > P.killT - .25 && P.t < P.killT + .3;
  const step = dt * (near ? .16 : .6); P.t += step;
  while (P.fi < fx.length && fx[P.fi].t <= P.t) { const e = fx[P.fi++]; FX[e.name](...e.args); }
  while (P.i < tape.length - 2 && tape[P.i + 1].t < P.t) P.i++;
  const A = tape[P.i], B = tape[Math.min(tape.length - 1, P.i + 1)], k = Math.max(0, Math.min(1, (P.t - A.t) / ((B.t - A.t) || 1)));
  figs.forEach((f, i) => { f.restore(A.s[i], B.s[i], k); f.update(step, true); });
  return P.t >= P.t1;
}
/** put everything back exactly where the live game left it */
export function finish(figs) {
  if (!play) return; const L = tape[tape.length - 1];
  figs.forEach((f, i) => { f.restore(L.s[i], L.s[i], 0); f.update(0, true); });
  play = null; G.fxTap.on = log;
}
