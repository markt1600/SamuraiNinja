/* ZAN — ink renderer: toon-lit scene, depth+normal ink outlines, paper grain,
   arena, and every particle / decal effect. */
import * as THREE from 'three';

export const FX = 1;                     // layer: drawn in colour, never outlined
export const PAPER = 0xddd5c4, INK = 0x15120f, BLOOD = 0xc8102e, SNOW = 0xf6f3ec;
export const IS_TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

let renderer, scene, camera, rtColor, rtNormal, postScene, postCam, postMat, normalMat;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/* ---------- materials ---------- */
let gradTex;
function gradient() {
  if (gradTex) return gradTex;
  const d = new Uint8Array([105, 105, 105, 255, 178, 178, 178, 255, 255, 255, 255, 255]);
  gradTex = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter; gradTex.needsUpdate = true;
  return gradTex;
}
const matCache = new Map();
export function toon(color, opt) {
  const key = color + (opt ? JSON.stringify(opt) : '');
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: gradient() }, opt));
  matCache.set(key, m); return m;
}
export const flat = (color, opt) => new THREE.MeshBasicMaterial(Object.assign({ color }, opt));

/* ---------- post: ink lines + paper ---------- */
const POST_FS = `
precision highp float;
uniform sampler2D tColor, tDepth, tNormal;
uniform vec2 uRes; uniform float uNear, uFar, uKill, uFlash, uDim, uTime;
varying vec2 vUv;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float lin(vec2 uv){ float z=texture2D(tDepth,uv).x*2.-1.; return 2.*uNear*uFar/(uFar+uNear-z*(uFar-uNear)); }
void main(){
  vec2 px=1./uRes; float sc=uRes.y/720.;
  vec2 asp=vec2(uRes.x/uRes.y,1.);
  // the hand wobbles: lines wander a little and swell like a loaded brush
  vec2 uv=vUv+(vec2(vn(vUv*asp*70.),vn(vUv*asp*70.+31.))-.5)*px*2.2*sc;
  float w=(.75+1.25*vn(vUv*asp*26.+7.))*sc;
  vec2 o=px*w;
  float d0=lin(uv), dA=lin(uv+o), dB=lin(uv-o), dC=lin(uv+vec2(o.x,-o.y)), dD=lin(uv+vec2(-o.x,o.y));
  float lap=abs(dA+dB-2.*d0)+abs(dC+dD-2.*d0);
  float eD=smoothstep(.012+d0*.003,.035+d0*.007,lap/d0);
  vec3 nA=texture2D(tNormal,uv+o).xyz, nB=texture2D(tNormal,uv-o).xyz,
       nC=texture2D(tNormal,uv+vec2(o.x,-o.y)).xyz, nD=texture2D(tNormal,uv+vec2(-o.x,o.y)).xyz;
  float eN=smoothstep(.45,.9,length(nA-nB)+length(nC-nD));
  float edge=max(eD,eN)*(1.-.75*smoothstep(30.,80.,d0));
  vec3 col=texture2D(tColor,vUv).rgb;
  col=pow(max(col,0.),vec3(1./2.2));
  // sky: a graded wash with slow cloud bands, only where nothing was drawn
  float raw=texture2D(tDepth,vUv).x;
  if(raw>=.99999){
    float cl=vn(vec2(vUv.x*3.+uTime*.012,vUv.y*9.))*.6+vn(vec2(vUv.x*7.-uTime*.02,vUv.y*22.))*.4;
    col*=mix(vec3(1.05,1.03,1.),vec3(.8,.82,.88),smoothstep(.35,1.,vUv.y)*.8+cl*.28*smoothstep(.3,.8,vUv.y));
  }
  // hatching: shade is drawn, not filled
  float lum0=dot(col,vec3(.3,.59,.11));
  float notRed=1.-step(.25,col.r-max(col.g,col.b)*1.5);
  float hw=smoothstep(.76,.6,lum0)*smoothstep(.26,.4,lum0)*(1.-smoothstep(20.,50.,d0))*notRed;
  float hp=(gl_FragCoord.x+gl_FragCoord.y)/sc;
  float h1=smoothstep(.62,.95,abs(fract(hp/9.+vn(vUv*asp*30.)*.4)-.5)*2.);
  col*=1.-hw*.2*h1;
  float grain=vn(vUv*uRes/sc*.9)*.6+vn(vUv*asp*9.)*.4;
  vec3 ink=vec3(.085,.07,.065);
  // dry-brush: the line breaks up where the paper tooth shows through
  float dry=smoothstep(.12,.5,grain+edge*.4);
  col=mix(col,ink,edge*dry*.95);
  col*=.9+.14*grain;
  // the cut: the world drops to bare ink, paper and blood
  float lum=dot(col,vec3(.3,.59,.11));
  float red=step(.3,col.r-max(col.g,col.b)*1.6);
  vec3 stark=mix(mix(ink,vec3(.93,.9,.84),smoothstep(.42,.5,lum)),vec3(.82,.05,.13),red);
  col=mix(col,stark,uKill);
  vec2 q=vUv-.5; float vig=smoothstep(.45,.95,length(q*vec2(1.15,1.)));
  col=mix(col,col*vec3(.62,.58,.55),vig*.75);
  col=mix(col,vec3(1.),uFlash);
  col*=1.-uDim;
  gl_FragColor=vec4(col,1.);
}`;

export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(PAPER, 1);
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PAPER, 16, 78);
  camera = new THREE.PerspectiveCamera(40, 16 / 9, .35, 140);
  camera.layers.enable(FX);

  const hemi = new THREE.HemisphereLight(0xf2efe8, 0x7c86a0, 1.5); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e2, 2.1);
  key.position.set(-7, 13, 6); key.castShadow = true;
  key.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
  const sc = key.shadow.camera; sc.left = -13; sc.right = 13; sc.top = 13; sc.bottom = -13; sc.near = 1; sc.far = 40;
  key.shadow.bias = -.0006; key.shadow.normalBias = .03;
  scene.add(key);

  normalMat = new THREE.MeshNormalMaterial();
  postScene = new THREE.Scene(); postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postMat = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null },
      uRes: { value: new THREE.Vector2() }, uNear: { value: camera.near }, uFar: { value: camera.far },
      uKill: { value: 0 }, uFlash: { value: 0 }, uDim: { value: 0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: POST_FS, depthTest: false, depthWrite: false });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));
  resize();
  addEventListener('resize', resize);
  buildArena(); buildDressing(); buildParticles(); buildSnow(); buildBursts();
  return { renderer, scene, camera };
}

export function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (rtColor) { rtColor.dispose(); rtNormal.dispose(); }
  rtColor = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, depthBuffer: true });
  rtColor.depthTexture = new THREE.DepthTexture(s.x, s.y); rtColor.depthTexture.type = THREE.UnsignedIntType;
  rtNormal = new THREE.WebGLRenderTarget(s.x, s.y, { depthBuffer: true });
  postMat.uniforms.uRes.value.copy(s);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

export const look = { kill: 0, flash: 0, dim: 0, shake: 0 };
let clock = 0;
export function render(dt) {
  if (look.shake > 0) {
    look.shake = Math.max(0, look.shake - dt * 2.6);
    const a = look.shake * look.shake * .22;
    camera.position.x += (Math.random() - .5) * a; camera.position.y += (Math.random() - .5) * a;
  }
  look.flash = Math.max(0, look.flash - dt * 5);
  renderer.setRenderTarget(rtColor); renderer.render(scene, camera);
  camera.layers.disable(FX); scene.overrideMaterial = normalMat;
  const fog = scene.fog; scene.fog = null;
  renderer.setRenderTarget(rtNormal); renderer.setClearColor(0x8080ff, 1); renderer.render(scene, camera);
  renderer.setClearColor(PAPER, 1);
  scene.overrideMaterial = null; scene.fog = fog; camera.layers.enable(FX);
  const u = postMat.uniforms;
  u.tColor.value = rtColor.texture; u.tDepth.value = rtColor.depthTexture; u.tNormal.value = rtNormal.texture;
  u.uTime.value = clock; u.uKill.value = look.kill; u.uFlash.value = look.flash; u.uDim.value = look.dim;
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
}

/* ---------- arena: a snowbound shrine court ---------- */
const DECAL_M = 26, DECAL_PX = IS_TOUCH ? 1024 : 2048;
let decalCtx, decalTex, decalDirty = false;
export const RING = 8.6;

function mesh(geo, mat, x, y, z, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true;
  scene.add(m); return m;
}
function buildArena() {
  const ground = mesh(new THREE.CircleGeometry(120, 48), toon(SNOW), 0, 0, 0, false);
  ground.rotation.x = -Math.PI / 2;

  const cv = document.createElement('canvas'); cv.width = cv.height = DECAL_PX;
  decalCtx = cv.getContext('2d');
  decalTex = new THREE.CanvasTexture(cv); decalTex.colorSpace = THREE.SRGBColorSpace;
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(DECAL_M, DECAL_M),
    new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, fog: false }));
  decal.rotation.x = -Math.PI / 2; decal.position.y = .012; decal.layers.set(FX); decal.renderOrder = 1;
  scene.add(decal);
  clearGround();

  // torii
  const red = toon(0xb3261e), dark = toon(0x2a2422), stone = toon(0x9a9a98);
  const tz = -15;
  for (const sx of [-2.6, 2.6]) {
    const p = mesh(new THREE.CylinderGeometry(.24, .3, 6, 10), red, sx, 3, tz); p.rotation.z = -sx * .012;
    mesh(new THREE.CylinderGeometry(.42, .46, .5, 10), dark, sx, .25, tz);
  }
  mesh(new THREE.BoxGeometry(7.2, .32, .4), red, 0, 4.7, tz);
  mesh(new THREE.BoxGeometry(8.6, .36, .56), red, 0, 5.75, tz);
  const cap = mesh(new THREE.BoxGeometry(9.3, .2, .8), dark, 0, 6.05, tz);
  mesh(new THREE.BoxGeometry(.5, .75, .12), dark, 0, 5.22, tz + .02);
  // shrine hall behind it
  mesh(new THREE.BoxGeometry(11, .7, 7), stone, 0, .35, -27);
  mesh(new THREE.BoxGeometry(8.4, 3.2, 5), toon(0x4a3a33), 0, 2.3, -27);
  const roof = mesh(new THREE.ConeGeometry(8.4, 2.9, 4), toon(0x26262b), 0, 5.3, -27); roof.rotation.y = Math.PI / 4; roof.scale.z = .78;
  const roofSnow = mesh(new THREE.ConeGeometry(6.2, 2.2, 4), toon(SNOW), 0, 5.78, -27); roofSnow.rotation.y = Math.PI / 4; roofSnow.scale.z = .78;
  // the sun: one red disc, the only saturated thing until blood is drawn
  const sun = new THREE.Mesh(new THREE.CircleGeometry(15, 48), new THREE.MeshBasicMaterial({ color: 0xc23a2b, fog: false }));
  sun.position.set(9, 17, -110); sun.layers.set(FX); scene.add(sun);
  // ink-wash mountains
  const rnd = mulberry(7);
  for (let layer = 0; layer < 3; layer++) {
    const R = 62 + layer * 16, n = 15 + layer * 3;
    const tone = new THREE.Color(0x56606f).lerp(new THREE.Color(PAPER), .18 + layer * .2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * .3, h = 9 + rnd() * 15 + layer * 5, r = 10 + rnd() * 12;
      const m = mesh(new THREE.ConeGeometry(r, h, 5 + (i % 3)), flat(tone), Math.sin(a) * R, h / 2 - 1, Math.cos(a) * R, false);
      m.rotation.y = rnd() * 6; m.receiveShadow = false;
    }
  }
  // pines
  const leaf = toon(0x27332e), trunk = toon(0x2e2622);
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2, r = 13 + rnd() * 17;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.abs(x) < 5 && z < -8) continue;
    const s = .8 + rnd() * .9;
    mesh(new THREE.CylinderGeometry(.13 * s, .22 * s, 2.4 * s, 6), trunk, x, 1.2 * s, z);
    for (let t = 0; t < 4; t++) {
      const y = (2 + t * 1.15) * s, rr = (1.75 - t * .36) * s;
      const c = mesh(new THREE.ConeGeometry(rr, 1.7 * s, 7), leaf, x, y + .5 * s, z); c.rotation.y = rnd() * 3;
      const sn = mesh(new THREE.ConeGeometry(rr * .62, 1.06 * s, 7), toon(SNOW), x, y + .86 * s, z, false); sn.rotation.y = c.rotation.y;
    }
  }
  // stone lanterns at the quarters of the ring
  const glow = flat(0xffb347);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, x = Math.sin(a) * (RING + 1.6), z = Math.cos(a) * (RING + 1.6);
    mesh(new THREE.CylinderGeometry(.3, .36, .2, 6), stone, x, .1, z);
    mesh(new THREE.CylinderGeometry(.11, .14, .9, 6), stone, x, .65, z);
    mesh(new THREE.BoxGeometry(.5, .08, .5), stone, x, 1.14, z);
    mesh(new THREE.BoxGeometry(.3, .3, .3), glow, x, 1.33, z, false);
    const r = mesh(new THREE.ConeGeometry(.46, .3, 4), stone, x, 1.63, z); r.rotation.y = Math.PI / 4;
    const s = mesh(new THREE.ConeGeometry(.34, .2, 4), toon(SNOW), x, 1.72, z, false); s.rotation.y = Math.PI / 4;
  }
  // snow-capped rocks
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.28, r = RING + 2.5 + rnd() * 5, s = .4 + rnd() * .7;
    const k = mesh(new THREE.DodecahedronGeometry(s, 0), toon(0x6d6f73), Math.sin(a) * r, s * .35, Math.cos(a) * r);
    k.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); k.scale.y = .7;
  }
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const d2p = v => (v + DECAL_M / 2) / DECAL_M * DECAL_PX;
export function clearGround() {
  const c = decalCtx, S = DECAL_PX; c.clearRect(0, 0, S, S);
  // ensō: one breath of the brush marks the duelling ground
  const rnd = mulberry(3), R = RING / DECAL_M * S;
  c.save(); c.translate(S / 2, S / 2); c.rotate(-.9);
  for (let i = 0; i < 520; i++) {
    const t = i / 520, a = t * Math.PI * 1.9, w = (6 + 22 * Math.sin(Math.PI * Math.min(1, t * 1.25)) ** .7) * S / 2048;
    c.fillStyle = `rgba(28,24,22,${.05 + .1 * (1 - t) + rnd() * .04})`;
    c.beginPath(); c.ellipse(Math.cos(a) * (R + (rnd() - .5) * 3), Math.sin(a) * (R + (rnd() - .5) * 3), w * (.7 + rnd() * .5), w * .55, a, 0, 6.3); c.fill();
  }
  c.restore(); decalDirty = true;
}
export function splat(x, z, r, vx = 0, vz = 0) {
  const c = decalCtx, k = DECAL_PX / DECAL_M, px = d2p(x), py = d2p(z);
  c.fillStyle = `rgba(${188 + Math.random() * 20 | 0},${10 + Math.random() * 12 | 0},${36 + Math.random() * 14 | 0},.92)`;
  const ang = Math.atan2(vz, vx), sp = Math.min(2.4, Math.hypot(vx, vz) * .35);
  c.beginPath(); c.ellipse(px, py, r * k * (1 + sp), r * k, ang, 0, 6.3); c.fill();
  for (let i = 0; i < 3; i++) {
    const d = r * k * (1.2 + Math.random() * 2.4 * (1 + sp)), a = ang + (Math.random() - .5) * (sp > .3 ? .7 : 6.3);
    c.beginPath(); c.arc(px + Math.cos(a) * d, py + Math.sin(a) * d, r * k * (.15 + Math.random() * .3), 0, 6.3); c.fill();
  }
  decalDirty = true;
}
export function pool(x, z, r) {
  const c = decalCtx, k = DECAL_PX / DECAL_M;
  c.fillStyle = 'rgba(176,8,34,.5)';
  for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(d2p(x) + (Math.random() - .5) * r * k, d2p(z) + (Math.random() - .5) * r * k, r * k * (.5 + Math.random() * .5), 0, 6.3); c.fill(); }
  decalDirty = true;
}
export function footprint(x, z, yaw) {
  const c = decalCtx, k = DECAL_PX / DECAL_M;
  c.fillStyle = 'rgba(96,108,134,.2)';
  c.beginPath(); c.ellipse(d2p(x), d2p(z), .07 * k, .14 * k, -yaw, 0, 6.3); c.fill();
  decalDirty = true;
}

/* ---------- particles: blood, sparks, snow-puffs ---------- */
const NP = 700; let pMesh; const parts = []; let pNext = 0;
const cBlood = new THREE.Color(BLOOD), cSpark = new THREE.Color(0xffe9a8), cPuff = new THREE.Color(0xffffff), cInk = new THREE.Color(INK);
function buildParticles() {
  pMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), NP);
  pMesh.layers.set(FX); pMesh.frustumCulled = false; pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < NP; i++) { parts.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, kind: 0 }); pMesh.setColorAt(i, cBlood); }
  scene.add(pMesh);
}
function emit(kind, p, v, r, life) {
  const o = parts[pNext]; pNext = (pNext + 1) % NP;
  o.kind = kind; o.p.copy(p); o.v.copy(v); o.r = r; o.life = o.max = life;
  pMesh.setColorAt(parts.indexOf(o), kind === 0 ? cBlood : kind === 1 ? cSpark : kind === 2 ? cPuff : cInk);
  pMesh.instanceColor.needsUpdate = true;
}
/** a fan of blood thrown along dir */
export function bleed(p, dir, n, speed, spread = .45) {
  for (let i = 0; i < n; i++) {
    _v.set(dir.x + (Math.random() - .5) * spread * 2, dir.y + (Math.random() - .3) * spread * 2, dir.z + (Math.random() - .5) * spread * 2)
      .normalize().multiplyScalar(speed * (.35 + Math.random() * .9));
    emit(0, p, _v, .018 + Math.random() * .03, 2.5);
  }
}
export function sparks(p, n = 16) {
  for (let i = 0; i < n; i++) {
    _v.set(Math.random() - .5, Math.random() - .2, Math.random() - .5).normalize().multiplyScalar(2 + Math.random() * 5);
    emit(1, p, _v, .012 + Math.random() * .012, .18 + Math.random() * .25);
  }
}
/** flung ink: the impact, drawn */
export function inkSplash(p, dir, n = 14) {
  for (let i = 0; i < n; i++) {
    _v.set(dir.x + (Math.random() - .5) * 1.6, dir.y + Math.random() * .9, dir.z + (Math.random() - .5) * 1.6).normalize().multiplyScalar(2.5 + Math.random() * 5);
    emit(3, p, _v, .014 + Math.random() * .02, .25 + Math.random() * .3);
  }
}
export function puff(p, n = 8) {
  for (let i = 0; i < n; i++) {
    _v.set(Math.random() - .5, Math.random() * .9, Math.random() - .5).multiplyScalar(1.6);
    _v2.set(p.x, .04, p.z); emit(2, _v2, _v, .03 + Math.random() * .04, .4 + Math.random() * .3);
  }
}
function tickParticles(dt) {
  for (let i = 0; i < NP; i++) {
    const o = parts[i];
    if (o.life <= 0) { _m.makeScale(0, 0, 0); pMesh.setMatrixAt(i, _m); continue; }
    o.life -= dt;
    o.v.y -= (o.kind === 2 ? 4 : 9.8) * dt;
    if (o.kind === 2) o.v.multiplyScalar(1 - 3 * dt);
    o.p.addScaledVector(o.v, dt);
    if (o.p.y < .015) {
      if (o.kind === 0) splat(o.p.x, o.p.z, o.r * (1.6 + Math.random() * 1.6), o.v.x, o.v.z);
      o.life = 0; continue;
    }
    const sp = o.v.length(), st = o.kind === 2 ? 1 : 1 + Math.min(5, sp * (o.kind === 1 ? .5 : .16));
    const k = o.kind === 0 ? 1 : Math.max(.05, o.life / o.max);
    _q.setFromUnitVectors(UP, _v.copy(o.v).multiplyScalar(1 / (sp || 1)));
    _m.compose(o.p, _q, _v2.set(o.r * k, o.r * k * st, o.r * k)); pMesh.setMatrixAt(i, _m);
  }
  pMesh.instanceMatrix.needsUpdate = true;
}

/* ---------- falling snow ---------- */
let snow, snowPos; const NS = IS_TOUCH ? 500 : 1100, SBOX = 26;
function buildSnow() {
  snowPos = new Float32Array(NS * 3);
  for (let i = 0; i < NS * 3; i += 3) { snowPos[i] = (Math.random() - .5) * SBOX; snowPos[i + 1] = Math.random() * 12; snowPos[i + 2] = (Math.random() - .5) * SBOX; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: .09, sizeAttenuation: true, depthWrite: false, fog: false, transparent: true, alphaTest: .3,
    map: tex((c, w) => { c.fillStyle = '#fff'; c.beginPath(); c.arc(w / 2, w / 2, w * .42, 0, 6.3); c.fill(); }, 32, 32) }));
  snow.layers.set(FX); snow.frustumCulled = false; scene.add(snow);
}
function tickSnow(dt, t) {
  const cx = camera.position.x, cz = camera.position.z;
  for (let i = 0; i < NS * 3; i += 3) {
    snowPos[i + 1] -= (.7 + (i % 7) * .08) * dt;
    snowPos[i] += Math.sin(t * .7 + i) * .12 * dt + .25 * dt;
    if (snowPos[i + 1] < 0) snowPos[i + 1] += 12;
    if (snowPos[i] - cx > SBOX / 2) snowPos[i] -= SBOX; else if (snowPos[i] - cx < -SBOX / 2) snowPos[i] += SBOX;
    if (snowPos[i + 2] - cz > SBOX / 2) snowPos[i + 2] -= SBOX; else if (snowPos[i + 2] - cz < -SBOX / 2) snowPos[i + 2] += SBOX;
  }
  snow.geometry.attributes.position.needsUpdate = true;
}

/* ---------- blade trails: a brushstroke left in the air ---------- */
export class Trail {
  constructor(n = 12, rgb = [.08, .07, .065], gain = .8) {
    this.n = n; this.count = 0; this.rgb = rgb; this.gain = gain;
    this.pos = new Float32Array(n * 2 * 3); this.col = new Float32Array(n * 2 * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.mesh.layers.set(FX); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh);
    this.fade = 0;
  }
  /** push a blade sample; `on` false lets the stroke dry out */
  push(base, tip, on, dt) {
    const n = this.n, p = this.pos;
    if (on) {
      p.copyWithin(6, 0, (n - 1) * 6);
      p[0] = base.x; p[1] = base.y; p[2] = base.z; p[3] = tip.x; p[4] = tip.y; p[5] = tip.z;
      this.count = Math.min(n, this.count + 1); this.fade = 1;
    } else this.fade = Math.max(0, this.fade - dt * 5);
    if (this.fade <= 0) { this.count = 0; this.mesh.visible = false; return; }
    this.mesh.visible = this.count > 1;
    for (let i = 0; i < n; i++) {
      const a = i < this.count ? (1 - i / this.count) ** 1.5 * this.gain * this.fade : 0;
      if (i >= this.count) for (let k = 0; k < 6; k++) p[i * 6 + k] = p[Math.max(0, this.count - 1) * 6 + k];
      for (let s = 0; s < 2; s++) { const o = (i * 2 + s) * 4; this.col[o] = this.rgb[0]; this.col[o + 1] = this.rgb[1]; this.col[o + 2] = this.rgb[2]; this.col[o + 3] = a * (s ? 1 : .35); }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

/* ---------- bursts: streaks, stars and shock rings, drawn facing the eye ---------- */
function tex(draw, w = 256, h = 256) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const TEX = {};
const bursts = [];
function buildBursts() {
  TEX.streak = tex((c, w, h) => {                       // a loaded brush dragged fast: fat belly, dry tail
    for (let i = 0; i < 90; i++) {
      const y = h / 2 + (Math.random() - .5) * h * .5, t = .5 + Math.random() * .5;
      const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.25 + Math.random() * .2, `rgba(255,255,255,${.5 * t})`); g.addColorStop(.8, `rgba(255,255,255,${.25 * t})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, y, w, 1 + Math.random() * 5 * (1 - Math.abs(y - h / 2) / (h * .3)));
    }
  }, 512, 64);
  TEX.ring = tex((c, w) => { c.strokeStyle = '#fff'; for (let i = 0; i < 40; i++) { c.globalAlpha = .1 + Math.random() * .25; c.lineWidth = 2 + Math.random() * 9; c.beginPath(); const a = Math.random() * 6.3; c.arc(w / 2, w / 2, w * .4 + (Math.random() - .5) * 8, a, a + 1 + Math.random() * 3); c.stroke(); } });
  TEX.star = tex((c, w) => { c.translate(w / 2, w / 2); c.fillStyle = '#fff'; for (let k = 0; k < 8; k++) { c.rotate(Math.PI / 4); const L = k % 2 ? w * .3 : w * .49; c.beginPath(); c.moveTo(0, -5); c.lineTo(L, 0); c.lineTo(0, 5); c.closePath(); c.fill(); } const g = c.createRadialGradient(0, 0, 0, 0, 0, w * .2); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(-w / 2, -w / 2, w, w); });
  const geo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, fog: false }));
    m.layers.set(FX); m.visible = false; m.renderOrder = 5; scene.add(m); bursts.push({ m, life: 0 });
  }
}
/** kind: streak | ring | star; dir (world) aims a streak */
export function burst(kind, p, color, size, life = .2, dir, grow = 1.8) {
  const o = bursts.find(b => b.life <= 0) || bursts[0];
  o.m.material.map = TEX[kind]; o.m.material.color.set(color); o.m.material.needsUpdate = true;
  o.m.position.copy(p); o.life = o.max = life; o.size = size; o.grow = grow; o.kind = kind; o.ang = Math.random() * 6.3;
  if (dir) { const a = _v.copy(p).project(camera), ax = a.x, ay = a.y; const b = _v2.copy(p).add(dir).project(camera); o.ang = Math.atan2(b.y - ay, (b.x - ax) * camera.aspect); }
  o.m.visible = true;
}
function tickBursts(dt) {
  for (const o of bursts) {
    if (o.life <= 0) continue; o.life -= dt; if (o.life <= 0) { o.m.visible = false; continue; }
    const k = 1 - o.life / o.max, s = o.size * (1 + (o.grow - 1) * (1 - (1 - k) ** 2));
    o.m.quaternion.copy(camera.quaternion).multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), o.ang));
    o.m.scale.set(s, o.kind === 'streak' ? s * .16 * (1 - k * .6) : s, 1); o.m.material.opacity = (1 - k) ** (o.kind === 'ring' ? 1 : .6);
  }
}

/* ---------- dressing: banners, rope, mist, glow ---------- */
const banners = []; let mist = [], glows = [];
function buildDressing() {
  const rnd = mulberry(11);
  // nobori banners between the lanterns
  const marks = ['斬', '雪', '刃', '死'];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + .08, R = RING + 3.8, x = Math.sin(a) * R, z = Math.cos(a) * R;
    mesh(new THREE.CylinderGeometry(.035, .045, 4.6, 6), toon(0x2a2422), x, 2.3, z);
    const t = tex((c, w, h) => {
      const red = i % 2 === 0; c.fillStyle = red ? '#b3261e' : '#efe9dc'; c.fillRect(0, 0, w, h);
      c.fillStyle = red ? '#efe9dc' : '#15120f'; c.font = `bold ${w * .78}px "Hiragino Mincho ProN","Yu Mincho",serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(marks[i], w / 2, h * .3); c.beginPath(); c.arc(w / 2, h * .72, w * .26, 0, 6.3); c.lineWidth = w * .09; c.strokeStyle = c.fillStyle; c.stroke();
      c.fillStyle = 'rgba(21,18,15,.85)'; c.fillRect(0, 0, w, 5); c.fillRect(0, 0, 4, h); c.fillRect(w - 4, 0, 4, h); c.fillRect(0, h - 5, w, 5);
    }, 128, 512);
    const g = new THREE.PlaneGeometry(.72, 3, 3, 12);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    m.position.set(x, 2.95, z); m.rotation.y = a + Math.PI / 2; m.layers.set(FX); scene.add(m);
    banners.push({ m, base: g.attributes.position.array.slice(), ph: rnd() * 6 });
  }
  // shimenawa rope and paper streamers on the torii
  const rope = mesh(new THREE.CylinderGeometry(.09, .09, 5, 8), toon(0xc9ae74), 0, 4.32, -14.9); rope.rotation.z = Math.PI / 2;
  for (let i = -2; i <= 2; i++) { const p = mesh(new THREE.BoxGeometry(.22, .5, .02), toon(0xf8f5ee), i * .95, 4, -14.86, false); p.rotation.z = (i % 2 ? .2 : -.2); }
  // low mist banks
  const mt = tex((c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }, 256, 256);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(26 + rnd() * 20, 3.5 + rnd() * 3), new THREE.MeshBasicMaterial({ map: mt, transparent: true, opacity: .5, depthWrite: false, fog: false, color: 0xf3efe6 }));
    const a = rnd() * 6.3, r = 24 + rnd() * 22; m.position.set(Math.sin(a) * r, 1.2 + rnd() * 2.2, Math.cos(a) * r); m.layers.set(FX); scene.add(m); mist.push({ m, a, r, sp: (.004 + rnd() * .008) * (i % 2 ? 1 : -1) });
  }
  // lantern light and the sun's halo
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, x = Math.sin(a) * (RING + 1.6), z = Math.cos(a) * (RING + 1.6);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: mt, transparent: true, opacity: .55, depthWrite: false, fog: false, color: 0xffa530 }));
    m.position.set(x, 1.33, z); m.layers.set(FX); scene.add(m); glows.push(m);
  }
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), new THREE.MeshBasicMaterial({ map: mt, transparent: true, opacity: .5, depthWrite: false, fog: false, color: 0xd9644f }));
  halo.position.set(9, 17, -109); halo.layers.set(FX); scene.add(halo);
}
function tickDressing(dt, t) {
  for (const b of banners) {
    const p = b.m.geometry.attributes.position, a = p.array, o = b.base;
    for (let i = 0; i < a.length; i += 3) {
      const free = (o[i] + .36) / .72, y = o[i + 1];            // the pole edge is pinned
      a[i + 2] = Math.sin(t * 3.1 + y * 2.2 + b.ph + free * 2) * .16 * free + Math.sin(t * 5.3 + y * 4 + b.ph) * .04 * free;
      a[i] = o[i] - Math.abs(a[i + 2]) * .25 * free;
    }
    p.needsUpdate = true;
  }
  for (const o of mist) { o.a += o.sp * dt; o.m.position.x = Math.sin(o.a) * o.r; o.m.position.z = Math.cos(o.a) * o.r; o.m.quaternion.copy(camera.quaternion); }
  glows.forEach((g, i) => { g.quaternion.copy(camera.quaternion); g.material.opacity = .45 + .12 * Math.sin(t * 9 + i * 2) * Math.sin(t * 23 + i); });
}

export function tick(dt, t) {
  clock = t; tickParticles(dt); tickSnow(dt, t); tickBursts(dt); tickDressing(dt, t);
  if (decalDirty) { decalTex.needsUpdate = true; decalDirty = false; }
}
export { scene, camera, renderer };
