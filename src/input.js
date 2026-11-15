/* ZAN — input: keyboard + mouse, or two thumbs. Produces one intent per frame. */
import { IS_TOUCH } from 'zan/gfx';

const keys = new Set();
const I = { mx: 0, mz: 0, stance: null, attack: false, thrust: false, guard: false, dodge: false };
let edges = { attack: false, thrust: false, dodge: false, stance: null, finish: false, mercy: false, confirm: false, swap: false, bare: false };
let lastClick = 0, lastTap = 0, mouseGuard = false, touchGuard = false, accX = 0, accY = 0, accT = 0, joy = { x: 0, y: 0 };
export const state = { locked: false, fighting: false };

export function init(canvas) {
  addEventListener('keydown', e => {
    if (e.repeat) return; keys.add(e.code);
    if (e.code === 'ArrowUp' || e.code === 'KeyI') edges.stance = 'high';
    if (e.code === 'ArrowLeft') edges.stance = 'left';
    if (e.code === 'ArrowRight') edges.stance = 'right';
    if (e.code === 'KeyJ') edges.attack = true;
    if (e.code === 'KeyL' || e.code === 'KeyE') edges.thrust = true;
    if (e.code === 'KeyQ' || e.code === 'Tab') { edges.swap = true; e.preventDefault(); }
    if (e.code === 'Space') { edges.dodge = true; e.preventDefault(); }
    if (e.code === 'KeyF') edges.finish = true;
    if (e.code === 'KeyG') edges.bare = true;
    if (e.code === 'KeyM') edges.mercy = true;
    if (e.code === 'Enter') edges.confirm = true;
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouseGuard = false; });
  canvas.addEventListener('mousedown', e => {
    if (IS_TOUCH) return;
    if (state.fighting && !document.pointerLockElement && canvas.requestPointerLock) { try { const r = canvas.requestPointerLock(); r && r.catch && r.catch(() => {}); } catch (_) {} }
    if (e.button === 0) { const t = performance.now(); if (t - lastClick < 300) { edges.thrust = true; lastClick = 0; } else { edges.attack = true; lastClick = t; } } else if (e.button === 2) mouseGuard = true; else if (e.button === 1) { edges.thrust = true; e.preventDefault(); }
  });
  addEventListener('mouseup', e => { if (e.button === 2) mouseGuard = false; });
  addEventListener('contextmenu', e => e.preventDefault());
  if (IS_TOUCH) initTouch();
}

function initTouch() {
  const $ = id => document.getElementById(id);
  const stick = (el, knob, onMove, onEnd) => {
    let id = null, cx = 0, cy = 0, R = 1;
    const at = t => { const dx = (t.clientX - cx) / R, dy = (t.clientY - cy) / R, l = Math.hypot(dx, dy), k = l > 1 ? 1 / l : 1; knob.style.transform = `translate(${dx * k * R * .6}px,${dy * k * R * .6}px)`; onMove(dx * k, dy * k, l); };
    el.addEventListener('touchstart', e => { const t = e.changedTouches[0]; id = t.identifier; const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width / 2; at(t); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === id) at(t); e.preventDefault(); }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; knob.style.transform = ''; onEnd(); } };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  };
  stick($('joy'), $('joy-knob'), (x, y) => { joy.x = x; joy.y = y; }, () => { joy.x = joy.y = 0; });
  // blade pad: swipe = cut from that side, swipe down = thrust, tap = cut; with GUARD held a swipe only moves the guard
  let sw = null, fired = false;
  stick($('blade'), $('blade-knob'), (x, y, l) => {
    sw = { x, y, l };
    if (!fired && l > .45) {
      fired = true;
      if (y > .35 && Math.abs(x) < y) { if (!touchGuard) edges.thrust = true; return; }
      edges.stance = Math.abs(x) > -y * .9 ? (x < 0 ? 'left' : 'right') : 'high';
      if (!touchGuard) edges.attack = true;
    }
  }, () => { if (!fired && !touchGuard) { const t = performance.now(); if (t - lastTap < 320) { edges.thrust = true; lastTap = 0; } else { edges.attack = true; lastTap = t; } } fired = false; sw = null; });
  const hold = (id, down, up) => { const b = $(id); b.addEventListener('touchstart', e => { down(); b.classList.add('on'); e.preventDefault(); }, { passive: false }); const u = () => { up && up(); b.classList.remove('on'); }; b.addEventListener('touchend', u); b.addEventListener('touchcancel', u); };
  hold('btn-guard', () => { touchGuard = true; }, () => { touchGuard = false; });
  hold('btn-dodge', () => { edges.dodge = true; });
  hold('btn-finish', () => { edges.finish = true; });
  hold('btn-mercy', () => { edges.mercy = true; });
  hold('btn-bare', () => { edges.bare = true; });
  hold('btn-swap', () => { edges.swap = true; });
}

/** read the frame's intent; edges are consumed */
export function read() {
  const k = c => keys.has(c) ? 1 : 0;
  I.mz = k('KeyW') - k('KeyS') - joy.y; I.mx = k('KeyA') - k('KeyD') - joy.x;
  if (Math.abs(I.mz) < .25) I.mz = 0; if (Math.abs(I.mx) < .25) I.mx = 0;
  I.mz = Math.max(-1, Math.min(1, I.mz)); I.mx = Math.max(-1, Math.min(1, I.mx));
  I.guard = mouseGuard || touchGuard || keys.has('KeyK') || keys.has('ShiftLeft') || keys.has('ShiftRight');
  I.attack = edges.attack; I.thrust = edges.thrust; I.dodge = edges.dodge;
  // the way you are moving is the way you cut, and the side you guard: left, right, or — standing your ground — high
  const dir = I.mx > .35 ? 'left' : I.mx < -.35 ? 'right' : 'high';
  I.stance = edges.stance || (I.attack || I.thrust || I.guard ? dir : null);
  const out = { finish: edges.finish, mercy: edges.mercy, confirm: edges.confirm, swap: edges.swap, bare: edges.bare };
  edges = { attack: false, thrust: false, dodge: false, stance: null, finish: false, mercy: false, confirm: false, swap: false, bare: false };
  return { intent: I, ...out };
}
