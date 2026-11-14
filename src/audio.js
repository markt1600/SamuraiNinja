/* ZAN — sound. Fighting uses recorded steel, flesh, snow and voice (CC0, see
   audio/ATTRIBUTION.md) sweetened with synthesis. The score is played live by
   a small synthesised orchestra — strings, horns, koto, shakuhachi, taiko —
   in a hall reverb, and follows the pressure of the duel. */
let ctx, master, sfxBus, musDry, musWet, sfxWet, musBus, noiseBuf;
const now = () => ctx.currentTime, ok = () => ctx && ctx.state === 'running';
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const LITE = matchMedia('(pointer:coarse)').matches;

/* ---------- samples ---------- */
const SETS = { steel: 6, parry: 4, flesh: 4, impact: 4, snow: 9, swish: 5, voice: 5, cloth: 4, scrape: 3 };
const bank = {};
function load() {
  for (const [name, n] of Object.entries(SETS)) {
    bank[name] = [];
    for (let i = 1; i <= n; i++) fetch(`audio/${name}-${i}.wav`).then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(b => ctx.decodeAudioData(b)).then(buf => bank[name].push(buf)).catch(() => {});
  }
}
/** play a random take from a set; false when the set has not loaded */
function smp(name, vol = 1, rate = 1, wet = .15, at = 0, pan = 0) {
  const set = bank[name]; if (!set || !set.length) return false;
  const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = set[Math.random() * set.length | 0];
  s.playbackRate.value = rate * rnd(.95, 1.06); g.gain.value = vol; s.connect(g); g.connect(sfxBus);
  if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(sfxWet); }
  s.start(now() + at); return true;
}

/* ---------- plumbing ---------- */
function boot() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
  ctx = new AC(); master = ctx.createGain(); master.gain.value = .9;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = .004; comp.release.value = .22;
  master.connect(comp); comp.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = .95; sfxBus.connect(master);
  musBus = ctx.createGain(); musBus.gain.value = .62; musBus.connect(master);
  musDry = ctx.createGain(); musDry.connect(musBus);
  // the hall: a long, dark tail that every instrument sits in
  const sr = ctx.sampleRate, len = sr * 3.1 | 0, ir = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const t = i / len, k = .5 - .42 * t; lp += ((Math.random() * 2 - 1) - lp) * k; d[i] = lp * (1 - t) ** 2.6 * (i < sr * .012 ? i / (sr * .012) : 1); } }
  const hall = ctx.createConvolver(); hall.buffer = ir; const hallOut = ctx.createGain(); hallOut.gain.value = .85; hall.connect(hallOut);
  musWet = ctx.createGain(); musWet.connect(hall); sfxWet = ctx.createGain(); sfxWet.connect(hall);
  const hm = ctx.createGain(); hm.gain.value = 1; hallOut.connect(hm); hm.connect(master);
  noiseBuf = ctx.createBuffer(1, sr * 2, sr); const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  // wind over the snow, always
  const w = noise(), f = ctx.createBiquadFilter(), wg = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = .6; wg.gain.value = .045;
  w.loop = true; w.connect(f); f.connect(wg); wg.connect(master); w.start();
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = .11; lg.gain.value = 190; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
  load(); return true;
}
function noise() { const s = ctx.createBufferSource(); s.buffer = noiseBuf; return s; }
/** route a voice to the dry bus and the hall */
function out(node, wet, sfx) { node.connect(sfx ? sfxBus : musDry); if (wet) { const w = ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(sfx ? sfxWet : musWet); } }
function env(g, t, a, peak, d) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d); }
function tone(freq, type, peak, a, d, t = now(), slide, wet = .2, sfx = true) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + a + d);
  env(g, t, a, peak, d); o.connect(g); out(g, wet, sfx); o.start(t); o.stop(t + a + d + .05);
}
function burst(freq, q, peak, a, d, type = 'bandpass', t = now(), slide, wet = .2, sfx = true) {
  const s = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + a + d);
  env(g, t, a, peak, d); s.connect(f); f.connect(g); out(g, wet, sfx); s.start(t, Math.random()); s.stop(t + a + d + .05);
}

/* ---------- the orchestra ---------- */
function strings(m, t, dur, vol, bright = 1700, att = .32, rel = .7, trem = 0) {
  const f = mtof(m), g = ctx.createGain(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright; lp.Q.value = .5;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att); g.gain.setValueAtTime(vol, t + Math.max(att, dur)); g.gain.linearRampToValueAtTime(0, t + Math.max(att, dur) + rel);
  const end = t + Math.max(att, dur) + rel + .05, vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = rnd(5, 5.8); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(5, t + .5); vib.connect(vg); vib.start(t); vib.stop(end);
  for (const det of LITE ? [-6, 7] : [-9, 0, 8]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det + rnd(-2, 2); vg.connect(o.detune); o.connect(lp); o.start(t); o.stop(end); }
  let last = lp;
  if (trem) { const tg = ctx.createGain(), tl = ctx.createOscillator(), tlg = ctx.createGain(); tg.gain.value = .6; tl.frequency.value = trem; tlg.gain.value = .4; tl.connect(tlg); tlg.connect(tg.gain); tl.start(t); tl.stop(end); lp.connect(tg); last = tg; }
  last.connect(g); out(g, .6);
}
function horn(m, t, dur, vol) {
  const f = mtof(m), g = ctx.createGain(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(260, t); lp.frequency.exponentialRampToValueAtTime(600 + 1500 * Math.min(1, vol * 6), t + .11); lp.frequency.exponentialRampToValueAtTime(700, t + dur + .3);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .07); g.gain.setValueAtTime(vol * .85, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + .35);
  for (const det of [-5, 5]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + .4); }
  lp.connect(g); out(g, .65);
}
function flute(m, t, dur, vol) {                      // shakuhachi: breath first, then the note, bending up into pitch
  const f = mtof(m), g = ctx.createGain(), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain();
  o.type = 'sine'; o2.type = 'triangle'; g2.gain.value = .16; o.frequency.setValueAtTime(f * .955, t); o.frequency.exponentialRampToValueAtTime(f, t + .14); o2.frequency.setValueAtTime(f * 1.91, t); o2.frequency.exponentialRampToValueAtTime(f * 2, t + .14);
  vib.frequency.value = 4.8; vg.gain.setValueAtTime(0, t + .2); vg.gain.linearRampToValueAtTime(f * .013, t + Math.max(.4, dur)); vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .09); g.gain.setValueAtTime(vol * .9, t + dur * .7); g.gain.linearRampToValueAtTime(0, t + dur + .25);
  const n = noise(), bp = ctx.createBiquadFilter(), ng = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = f * 2.2; bp.Q.value = 1.4;
  ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(vol * .5, t + .03); ng.gain.exponentialRampToValueAtTime(vol * .09, t + .22); ng.gain.linearRampToValueAtTime(0, t + dur + .2);
  o.connect(g); o2.connect(g2); g2.connect(g); n.connect(bp); bp.connect(ng); out(g, .7); out(ng, .7);
  const end = t + dur + .3; for (const x of [o, o2, vib]) { x.start(t); x.stop(end); } n.start(t, Math.random()); n.stop(end);
}
const kotoBuf = {};
function koto(m, t, vol) {                            // a plucked string, modelled: noise fed round a damped delay
  let b = kotoBuf[m];
  if (!b) {
    const sr = ctx.sampleRate, N = Math.round(sr / mtof(m)), len = sr * 1.7 | 0; b = ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    let p = 0; for (let i = 0; i < N; i++) { p += ((Math.random() * 2 - 1) - p) * .55; d[i] = p * (i < N * .18 ? i / (N * .18) : 1); }
    for (let i = N; i < len; i++) d[i] = .4975 * (d[i - N] + d[i - N + 1]);
    kotoBuf[m] = b;
  }
  const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.playbackRate.setValueAtTime(1.014, t); s.playbackRate.exponentialRampToValueAtTime(1, t + .06);
  g.gain.value = vol; s.connect(g); out(g, .5); s.start(t);
}
function taiko(t, vol, pitch = 1) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(118 * pitch, t); o.frequency.exponentialRampToValueAtTime(46 * pitch, t + .2);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + .75); o.connect(g); out(g, .55); o.start(t); o.stop(t + .8);
  burst(170 * pitch, .7, vol * .7, .002, .13, 'lowpass', t, null, .5, false); burst(1700, 1.2, vol * .22, .001, .018, 'bandpass', t, null, .3, false);
}
function shime(t, vol) { burst(2300, 3, vol, .001, .05, 'bandpass', t, null, .3, false); tone(390, 'sine', vol * .5, .001, .06, t, 300, .3, false); }
function swell(t, dur, vol) { const s = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 4200; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur); g.gain.exponentialRampToValueAtTime(.0001, t + dur + 1.6); s.loop = true; s.connect(f); f.connect(g); out(g, .6); s.start(t); s.stop(t + dur + 1.7); }

/* ---------- the score: D hirajoshi over D minor ---------- */
const HJ = [57, 58, 62, 64, 65, 69, 70, 74, 76, 77, 81, 82];
const DM = { root: 38, pad: [50, 57, 62, 65], k: 2 }, BB = { root: 34, pad: [46, 53, 58, 62], k: 1 }, GM = { root: 31, pad: [43, 50, 55, 58], k: 1 },
  AS = { root: 33, pad: [45, 52, 57, 62], k: 0 }, AM = { root: 33, pad: [45, 52, 57, 61], k: 0 };
const PROG = [DM, DM, BB, BB, GM, GM, AS, AM];
const THEME = [
  [[0, 69, 2], [2, 74, 2]], [[0, 77, 1.5], [1.5, 76, .5], [2, 74, 2]], [[0, 70, 2], [2, 74, 1], [3, 77, 1]], [[0, 76, 1], [1, 74, 3]],
  [[0, 70, 2], [2, 69, 1], [3, 67, 1]], [[0, 69, 3]], [[0, 64, 1], [1, 69, 1], [2, 70, 1], [3, 69, 1]], [[0, 69, 2], [2, 64, 2]],
  [[0, 74, 1], [1, 76, 1], [2, 77, 2]], [[0, 81, 2], [2, 77, 1], [3, 76, 1]], [[0, 74, 3], [3, 70, 1]], [[0, 77, 2], [2, 74, 2]],
  [[0, 70, 1], [1, 74, 1], [2, 79, 2]], [[0, 77, 1], [1, 74, 1], [2, 70, 2]], [[0, 69, 2], [2, 76, 2]], [[0, 73, 4]],
];
const RIFF = [0, 2, 4, 2, 5, 4, 2, 4, 0, 2, 4, 5, 7, 5, 4, 2], OST = [1, .5, .55, 1, .5, .55, 1, .62];
const BPM = { menu: 64, intro: 76, duel: 104, after: 54 };
let mode = null, step = 0, nextT = 0, inten = .3, target = .3, cycle = 0;

function schedule(s, t, spb) {
  const bar = (s >> 4) % 8, q = s & 15, ch = PROG[bar], I = inten, beat = spb, th = THEME[((cycle & 1) * 8 + bar) % 16];
  const melody = (fn, vol, shift = 0) => { for (const [b, m, len] of th) if (Math.round(b * 4) === q) fn(m + shift, t, len * beat * .92, vol); };
  if (mode === 'menu') {
    if (q === 0 && bar % 2 === 0) { for (const m of ch.pad) strings(m, t, beat * 7.4, .034, 1300, .9, 1.4); strings(ch.root, t, beat * 7.4, .05, 500, .9, 1.4); }
    if ([0, 4, 6, 8, 12, 14].includes(q) && (q || bar % 2 === 0)) koto(ch.pad[(q / 2 + bar) % 4] + 12, t, .2);
    if (cycle % 2 === 0 || bar < 4) melody(flute, .1);
    if (q === 0 && bar % 4 === 0) taiko(t, .3, .9);
  } else if (mode === 'intro') {
    if (q === 0) for (const m of [50, 57, 63]) strings(m, t, beat * 3.8, .028, 1500, .3, .4, 9);
    if (q % 4 === 0) taiko(t, .25 + (s % 32) * .012, .95);
    if (q % 4 === 2 && s > 16) shime(t, .08);
  } else if (mode === 'duel') {
    if (q === 0) { for (const m of ch.pad) strings(m, t, beat * 3.7, .022 + .02 * I, 1100 + 1500 * I, .25, .5); }
    if (q % 2 === 0) { const e = q >> 1, a = OST[e]; strings(ch.root + (e === 3 || e === 6 ? 12 : 0) + 12, t, .1, (.05 + .05 * I) * a, 600 + 1100 * I, .012, .13); if (a === 1) strings(ch.root, t, .14, .06 + .04 * I, 420, .012, .16); }
    const big = I < .35 ? [0, 8] : I < .7 ? [0, 6, 8, 14] : [0, 3, 6, 8, 11, 14];
    if (big.includes(q)) taiko(t, (q === 0 ? .62 : .42) * (.6 + .5 * I), q === 0 ? 1 : 1.12);
    if (I > .5 && [2, 4, 10, 12].includes(q)) shime(t, .1 + .08 * I);
    if (I > .8 && bar === 7 && q >= 12) { shime(t, .16); taiko(t + beat / 8, .3, 1.25); }
    if (I > .3 && (I > .6 || q % 2 === 0)) koto(HJ[Math.min(HJ.length - 1, ch.k + RIFF[q])] + (bar % 4 === 3 && q > 7 ? 12 : 0), t, .12 + .08 * I);
    if (I >= .55) { melody(horn, .05 + .035 * I, -12); melody((m, tt, d, v) => strings(m, tt, d, v, 2600, .12, .3), .03 + .02 * I, 12); }
    else if (cycle % 2 === 0) melody(flute, .075);
    if (I > .6 && bar === 7 && q === 8) swell(t, beat * 2, .05);
  } else if (mode === 'after') {
    const c2 = (s >> 5) % 2 ? BB : DM;
    if (q === 0 && (s >> 4) % 2 === 0) { for (const m of c2.pad) strings(m, t, beat * 7.5, .03, 950, 1.2, 1.8); strings(c2.root, t, beat * 7.5, .05, 380, 1.2, 1.8); }
    if (bar < 4) melody(flute, .085);
    if (q === 0) taiko(t, .22, .8); if (q === 3) taiko(t, .12, .8);
  }
}

export const sfx = {
  boot,
  /* --- fighting --- */
  whoosh() { if (!ok()) return; if (!smp('swish', .7, rnd(.9, 1.1), .1)) burst(500, 1.2, .3, .05, .16, 'bandpass', now(), 1800); },
  windup(thrust) { if (!ok()) return; smp('cloth', .3, thrust ? 1.25 : 1, .05); if (!smp('swish', .28, thrust ? 1.3 : .72, .08, .12)) burst(thrust ? 900 : 300, 1.5, .1, .1, .22, 'bandpass', now(), thrust ? 1500 : 900); },
  stance() { if (!ok()) return; if (!smp('cloth', .16, 1.5, 0)) burst(2400, 2, .035, .004, .05); },
  dash() { if (!ok()) return; smp('snow', .5, .8, .05); smp('cloth', .4, 1.1, .05); if (!smp('swish', .3, .8, .05)) burst(700, .8, .16, .02, .16, 'lowpass', now(), 250); },
  step(sp) { if (!ok()) return; if (!smp('snow', .16 + Math.min(.2, sp * .04), rnd(.9, 1.15), 0)) burst(1500 + Math.random() * 500, .9, .03, .006, .07, 'bandpass'); },
  clang(p = 1) {
    if (!ok()) return; const t = now();
    if (!smp('steel', .95, p * rnd(.94, 1.06), .3)) for (const [f, g, d] of [[1860, .16, .32], [2710, .12, .24], [4140, .08, .18]]) tone(f * p, 'triangle', g, .002, d, t);
    tone(2140 * p, 'sine', .05, .002, .5, t, null, .5); burst(5200, .8, .14, .001, .04, 'highpass', t); tone(140, 'sine', .25, .003, .1, t, 60, .1);
  },
  parry() {                                             // the deflection rings out over everything
    if (!ok()) return; const t = now();
    smp('parry', 1, rnd(1, 1.12), .5); smp('steel', .5, 1.3, .5);
    for (const [f, g, d] of [[2480, .1, 1.1], [3720, .07, .9], [5230, .05, .7], [7410, .025, .5]]) tone(f * rnd(.995, 1.005), 'sine', g, .002, d, t, null, .8);
    burst(6000, .7, .2, .001, .05, 'highpass', t); tone(170, 'sine', .35, .004, .16, t, 55, .2);
  },
  scrape() { if (ok()) smp('scrape', .6, rnd(.9, 1.1), .3); },
  cut() {
    if (!ok()) return; const t = now();
    smp('swish', .5, 1.35, .1); if (!smp('flesh', 1, rnd(.85, 1), .2)) burst(2600, .7, .5, .004, .12, 'bandpass', t, 500);
    smp('impact', .6, .8, .15, .02); tone(105, 'sine', .45, .005, .18, t, 46, .15); burst(3400, .9, .16, .002, .07, 'bandpass', t, 900);
  },
  grunt(player) { if (!ok()) return; if (!smp('voice', .7, player ? rnd(.98, 1.08) : rnd(.8, .92), .25, .06)) { const t = now() + .05, f = player ? 150 : 125; tone(f, 'sawtooth', .13, .02, .22, t, f * .62); } },
  thud() { if (!ok()) return; const t = now(); if (!smp('impact', .9, rnd(.75, .9), .2)) burst(400, .8, .4, .003, .1, 'lowpass', t); tone(115, 'sine', .55, .004, .17, t, 50, .2); smp('cloth', .5, .9, .1); },
  breakPosture() { if (!ok()) return; const t = now(); smp('impact', .8, .65, .4); smp('scrape', .45, 1.3, .4); tone(88, 'sine', .7, .005, .55, t, 38, .4); taiko(t, .5, .8); for (const m of [62, 63, 68]) strings(m + 12, t, .5, .04, 3000, .02, .6, 13); },
  flick() { if (!ok()) return; if (!smp('swish', .6, 1.6, .2)) burst(1900, 1.5, .16, .02, .12, 'bandpass', now(), 3600); },
  taiko(v = .8) { if (ok()) taiko(now(), v); },
  kill() {
    if (!ok()) return; const t = now();
    smp('flesh', .7, .8, .4); smp('flesh', .5, 1.1, .4, .05); smp('swish', .55, 1.2, .3); smp('steel', .3, .8, .7);
    tone(55, 'sine', .5, .01, 1.8, t + .04, 28, .5); taiko(t, .55, .85); swell(t, .02, .12);
    // the orchestra holds its breath, then one low chord
    musBus.gain.cancelScheduledValues(t); musBus.gain.setValueAtTime(musBus.gain.value, t); musBus.gain.linearRampToValueAtTime(.12, t + .08); musBus.gain.linearRampToValueAtTime(.62, t + 2.6);
    for (const m of [26, 38, 45, 50, 53]) strings(m, t + .25, 2.6, .05, 800, .5, 1.6); tone(1976, 'sine', .035, .3, 2.6, t + .2, null, .9);
  },
  bell() { if (!ok()) return; const t = now(); for (const [f, g, d] of [[196, .16, 4], [392.4, .12, 3.4], [589, .06, 2.6], [802, .05, 2], [1175, .025, 1.4]]) tone(f, 'sine', g, .004, d, t, null, .8); burst(900, 1, .06, .001, .03, 'bandpass', t); },
  /* --- the score --- */
  victory() {
    if (!ok()) return; const t = now() + .15;
    for (let i = 0; i < 9; i++) koto(HJ[i + 2], t + i * .075, .22);
    taiko(t + .7, .8); taiko(t + .95, .55, 1.15); taiko(t + 1.2, .9, .9); swell(t + .2, 1, .07);
    for (const m of [38, 50, 57, 62, 66, 69]) strings(m, t + 1.2, 3.2, .04, 2200, .25, 2); for (const m of [50, 57, 62]) horn(m, t + 1.2, 2.6, .055);
    for (const [b, m, l] of [[1.2, 74, .5], [1.7, 78, .5], [2.2, 81, 1.8]]) flute(m, t + b, l, .09);
  },
  death() {
    if (!ok()) return; const t = now() + .2; taiko(t, .7, .75);
    for (const m of [26, 38, 39, 45]) strings(m, t, 4.5, .05, 700, .8, 2.5);
    for (const [b, m, l] of [[.3, 74, 1.1], [1.5, 70, .9], [2.5, 69, .8], [3.4, 62, 2.4]]) flute(m, t + b, l, .1);
  },
  /** 'menu' | 'intro' | 'duel' | 'after' | null */
  music(m) { if (m === true) m = 'duel'; if (!m) m = null; if (m === mode) return; mode = m; step = 0; cycle = 0; nextT = ctx ? now() + (m === 'duel' ? .05 : .5) : 0; if (m === 'duel') inten = target = .3; },
  /** call every frame with how hard the duel is being fought, 0..1 */
  tick(pressure = 0) {
    if (!ok() || !mode) return;
    target = Math.max(.22, Math.min(1, pressure)); inten += (target - inten) * (target > inten ? .02 : .004);
    const spb = 60 / BPM[mode], t = now(); if (nextT < t - .5) nextT = t + .05;
    while (nextT < t + .22) { schedule(step, nextT, spb); step++; if (step % 128 === 0) cycle++; nextT += spb / 4; }
  },
  level: () => inten,
  /** test hooks: how many takes are decoded, and the output level right now */
  loaded: () => Object.values(bank).reduce((n, b) => n + b.length, 0),
  meter() { if (!ctx) return null; if (!sfx._an) { sfx._an = ctx.createAnalyser(); sfx._an.fftSize = 2048; master.connect(sfx._an); sfx._d = new Float32Array(2048); } sfx._an.getFloatTimeDomainData(sfx._d); let pk = 0, sq = 0; for (const v of sfx._d) { pk = Math.max(pk, Math.abs(v)); sq += v * v; } return [+pk.toFixed(3), +Math.sqrt(sq / 2048).toFixed(3)]; },
};
