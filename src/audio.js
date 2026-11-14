/* ZAN — sound: everything synthesised, nothing loaded. */
let ctx, master, noiseBuf, musicOn = false, nextNote = 0, windGain;
const now = () => ctx.currentTime;
function boot() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
  ctx = new AC(); master = ctx.createGain(); master.gain.value = .7;
  const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // wind over the snow, always
  const w = noise(), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = .6;
  windGain = ctx.createGain(); windGain.gain.value = .05; w.loop = true; w.connect(f); f.connect(windGain); windGain.connect(master); w.start();
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = .11; lg.gain.value = 190; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
  return true;
}
function noise() { const s = ctx.createBufferSource(); s.buffer = noiseBuf; return s; }
function env(g, t, a, peak, d) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d); }
function tone(freq, type, peak, a, d, t = now(), slide) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + a + d);
  env(g, t, a, peak, d); o.connect(g); g.connect(master); o.start(t); o.stop(t + a + d + .05); return o;
}
function burst(freq, q, peak, a, d, type = 'bandpass', t = now(), slide) {
  const s = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + a + d);
  env(g, t, a, peak, d); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + a + d + .05);
}
const ok = () => ctx && ctx.state === 'running';
const SCALE = [146.83, 155.56, 196, 220, 233.08, 293.66, 311.13, 392];   // D hirajoshi

export const sfx = {
  boot,
  whoosh() { if (ok()) burst(500, 1.2, .3, .05, .16, 'bandpass', now(), 1800); },
  windup(thrust) { if (ok()) burst(thrust ? 900 : 300, 1.5, .1, .1, .22, 'bandpass', now(), thrust ? 1500 : 900); },
  stance() { if (ok()) burst(2400, 2, .035, .004, .05); },
  dash() { if (ok()) burst(700, .8, .16, .02, .16, 'lowpass', now(), 250); },
  step(sp) { if (ok()) burst(1500 + Math.random() * 500, .9, .03 + Math.min(.05, sp * .012), .006, .07, 'bandpass'); },
  clang(p = 1) {
    if (!ok()) return; const t = now();
    for (const [f, g, d] of [[1860, .16, .32], [2710, .12, .24], [4140, .08, .18], [640, .1, .1]]) tone(f * p * (1 + Math.random() * .02), 'triangle', g, .002, d, t);
    burst(5200, .8, .22, .001, .05, 'highpass', t);
  },
  parry() {
    if (!ok()) return; const t = now();
    for (const [f, g, d] of [[2480, .2, .7], [3720, .14, .55], [5230, .1, .4], [7410, .05, .3]]) tone(f, 'sine', g, .002, d, t);
    burst(6000, .7, .3, .001, .06, 'highpass', t); tone(180, 'sine', .3, .004, .14, t, 60);
  },
  cut() { if (!ok()) return; const t = now(); burst(2600, .7, .5, .004, .12, 'bandpass', t, 500); burst(300, .8, .5, .01, .2, 'lowpass', t + .02); tone(110, 'sine', .4, .005, .16, t, 50); },
  grunt(player) { if (!ok()) return; const t = now() + .05, f = player ? 150 : 125; const o = tone(f, 'sawtooth', .13, .02, .22, t, f * .62); burst(700, 3, .1, .02, .2, 'bandpass', t); },
  breakPosture() { if (!ok()) return; const t = now(); tone(92, 'sine', .7, .005, .5, t, 40); burst(180, .7, .5, .005, .3, 'lowpass', t); tone(1320, 'triangle', .1, .003, .5, t); },
  thud() { if (!ok()) return; const t = now(); tone(120, 'sine', .6, .004, .16, t, 55); burst(400, .8, .4, .003, .1, 'lowpass', t); },
  flick() { if (ok()) burst(1900, 1.5, .16, .02, .12, 'bandpass', now(), 3600); },
  taiko(v = .8) { if (!ok()) return; const t = now(); tone(88, 'sine', v, .004, .55, t, 44); burst(140, .8, v * .6, .002, .12, 'lowpass', t); },
  kill() {
    if (!ok()) return; const t = now();
    burst(3000, .6, .6, .003, .2, 'bandpass', t, 400); tone(58, 'sine', .9, .01, 1.6, t + .05, 30);
    tone(1976, 'sine', .08, .3, 2.6, t + .2); tone(2960, 'sine', .04, .5, 2.4, t + .3);
    master.gain.setValueAtTime(.7, t); 
  },
  bell() { if (!ok()) return; const t = now(); for (const [f, g] of [[392, .2], [784.5, .1], [1180, .06], [1571, .03]]) tone(f, 'sine', g, .005, 3, t); },
  music(on) { musicOn = on; },
  /** sparse flute phrases over the wind; called every frame */
  tick(tension) {
    if (!ok() || !musicOn || now() < nextNote) return;
    const t = now() + .05, n = 2 + (Math.random() * 3 | 0); let at = t, i = Math.random() * SCALE.length | 0;
    for (let k = 0; k < n; k++) {
      i = Math.max(0, Math.min(SCALE.length - 1, i + (Math.random() * 5 | 0) - 2));
      const f = SCALE[i] * 2, len = .5 + Math.random() * 1.1;
      const o = ctx.createOscillator(), g = ctx.createGain(), v = ctx.createOscillator(), vg = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f * .97, at); o.frequency.linearRampToValueAtTime(f, at + .12);
      v.frequency.value = 5.2; vg.gain.setValueAtTime(0, at); vg.gain.linearRampToValueAtTime(f * .012, at + len); v.connect(vg); vg.connect(o.frequency);
      g.gain.setValueAtTime(.0001, at); g.gain.linearRampToValueAtTime(.075, at + .1); g.gain.linearRampToValueAtTime(.0001, at + len);
      o.connect(g); g.connect(master); o.start(at); v.start(at); o.stop(at + len + .05); v.stop(at + len + .05);
      burst(f * 2, 6, .012, .05, len * .7, 'bandpass', at);
      at += len * .92;
    }
    if (tension > .5) setTimeout(() => sfx.taiko(.5), (at - t) * 1000);
    nextNote = at + 2.5 + Math.random() * 5 * (1 - tension * .5);
  },
};
