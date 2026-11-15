/* ZAN — ink renderer: toon-lit scene, depth+normal ink outlines, paper grain,
   arena, and every particle / decal effect. */
import * as THREE from 'three';

export const FX = 1;                     // layer: drawn in colour, never outlined
export const PAPER = 0xddd5c4, INK = 0x15120f, BLOOD = 0xc8102e, SNOW = 0xf6f3ec;
export const IS_TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

let renderer, scene, camera, rtColor, rtNormal, postScene, postCam, postMat, normalMat, postQuad;
let rtBa, rtBb, rtRefl, brightMat, blurMat, rcam, ice, flashL, lanternL = [], sunPos = new THREE.Vector3(9, 17, -110);
const texMat = new THREE.Matrix4(), swayers = [], shide = [], windU = { value: new THREE.Vector2() };
/** the weather: one gusting wind that everything loose answers to */
export const wind = { gust: .5, x: 1, z: .25 };
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
/** a toon material carrying a drawn pattern */
export function toonTex(color, map, opt) { return rim(new THREE.MeshToonMaterial(Object.assign({ color, map, gradientMap: gradient() }, opt))); }
export function canvasTex(draw, w = 128, h = 128) { const t = tex(draw, w, h); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
/** a cool rim of sky light on every edge that turns away from the eye */
function rim(m) {
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', 'float rimL = 1. - clamp(dot(normalize(normal), normalize(vViewPosition)), 0., 1.);\n outgoingLight += vec3(.5, .56, .68) * smoothstep(.62, .7, rimL) * .32 * (.35 + diffuseColor.rgb);\n#include <opaque_fragment>'); };
  m.customProgramCacheKey = () => 'rim'; return m;
}
export function toon(color, opt) {
  const key = color + (opt ? JSON.stringify(opt) : '');
  if (matCache.has(key)) return matCache.get(key);
  const { norim, ...rest } = opt || {};
  const m = new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: gradient() }, rest)); if (!norim) rim(m);
  matCache.set(key, m); return m;
}
export const flat = (color, opt) => new THREE.MeshBasicMaterial(Object.assign({ color }, opt));

/* ---------- post: ink lines + paper ---------- */
const POST_FS = `
precision highp float;
uniform sampler2D tColor, tDepth, tNormal, tBloom;
uniform vec2 uSun, uTan; uniform float uRays; uniform mat3 uCam; uniform vec3 uSunDir, uMoon;
uniform vec2 uRes; uniform float uNear, uFar, uKill, uFlash, uDim, uTime, uImpact, uInvert;
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
  // the outer contour is drawn with a heavier hand than the inner lines
  vec2 o2=o*2.3;
  float lap2=abs(lin(uv+o2)+lin(uv-o2)-2.*d0)+abs(lin(uv+vec2(o2.x,-o2.y))+lin(uv+vec2(-o2.x,o2.y))-2.*d0);
  eD=max(eD,smoothstep(.06+d0*.012,.14+d0*.02,lap2/d0)*step(d0,26.));
  vec3 nA=texture2D(tNormal,uv+o).xyz, nB=texture2D(tNormal,uv-o).xyz,
       nC=texture2D(tNormal,uv+vec2(o.x,-o.y)).xyz, nD=texture2D(tNormal,uv+vec2(-o.x,o.y)).xyz;
  float eN=smoothstep(.45,.9,length(nA-nB)+length(nC-nD));
  float edge=max(eD,eN)*(1.-.75*smoothstep(30.,80.,d0));
  vec3 col=texture2D(tColor,vUv).rgb;
  // a heavy blow splits the light at the edges of the frame
  vec2 ca=(vUv-.5)*.014*uImpact;
  col.r=mix(col.r,texture2D(tColor,vUv+ca).r,step(.001,uImpact)); col.b=mix(col.b,texture2D(tColor,vUv-ca).b,step(.001,uImpact));
  // bloom from everything that burns, and shafts of it streaming from the sun
  col+=texture2D(tBloom,vUv).rgb*.9;
  vec2 sd=uSun-vUv; vec3 ray=vec3(0.);
  for(int i=1;i<=12;i++) ray+=texture2D(tBloom,vUv+sd*float(i)/12.*.9).rgb*(1.-float(i)/14.);
  col+=ray*uRays*.028;
  col=pow(max(col,0.),vec3(1./2.2));
  // sky: a painted dome fixed to the world — graded dusk, two decks of drawn cloud lit from beneath, a thin moon
  float raw=texture2D(tDepth,vUv).x;
  if(raw>=.99999){
    vec3 rd=normalize(uCam*vec3((vUv*2.-1.)*uTan,-1.));
    float el=rd.y, az=atan(rd.x,-rd.z), sdn=max(dot(rd,uSunDir),0.);
    vec3 hor=mix(vec3(.97,.91,.83),vec3(1.,.78,.62),pow(sdn,3.));
    vec3 S=mix(hor,vec3(.9,.89,.86),smoothstep(0.,.2,el)); S=mix(S,vec3(.5,.55,.67),smoothstep(.14,.8,el));
    S+=vec3(.55,.22,.08)*pow(sdn,9.)*.55;
    // far curtains of falling snow
    S-=smoothstep(.72,1.,vn(vec2(az*38.+el*16.,el*3.)))*smoothstep(.45,.05,el)*.05;
    for(int L=0;L<2;L++){
      float fl=float(L);
      // a flat deck of cloud overhead, seen in perspective: long streaks that gather toward the horizon
      vec2 cu=rd.xz/(el+.2)*(1.7+fl*1.3); cu.x=cu.x*.45+uTime*(.012+fl*.008)+fl*5.; cu.y+=fl*3.;
      float dn=vn(cu)*.5+vn(cu*2.3+4.)*.27+vn(cu*5.3+1.)*.15+vn(cu*11.7+2.)*.08;
      float band=smoothstep(.03,.16,el);
      float d=dn-(1.-band)*.55-fl*.03;
      float body=smoothstep(.5,.506,d), lit=smoothstep(.565,.575,d), edge=body-smoothstep(.512,.522,d);
      vec3 cc=mix(vec3(.7,.73,.8),vec3(.99,.98,.95),lit);
      cc=mix(cc,vec3(1.,.7,.56),pow(sdn,2.)*.65*(1.-lit*.55));
      S=mix(S,cc,body*(.92-fl*.3)); S=mix(S,vec3(.22,.2,.22),edge*(.42-fl*.2));
    }
    float md=dot(rd,uMoon), disc=smoothstep(.99905,.9993,md), cut=smoothstep(.9990,.99925,dot(rd,normalize(uMoon+vec3(.02,.012,0.))));
    S=mix(S,vec3(1.,.985,.92),disc*(1.-cut)); S+=vec3(.9,.92,1.)*pow(max(md,0.),260.)*.16;
    col*=S/vec3(.867,.835,.769);
  }
  // hatching: shade is drawn, not filled
  float lum0=dot(col,vec3(.3,.59,.11));
  float notRed=1.-step(.25,col.r-max(col.g,col.b)*1.5);
  float hw=smoothstep(.76,.6,lum0)*smoothstep(.26,.4,lum0)*(1.-smoothstep(20.,50.,d0))*notRed;
  float hp=(gl_FragCoord.x+gl_FragCoord.y)/sc;
  float h1=smoothstep(.62,.95,abs(fract(hp/9.+vn(vUv*asp*30.)*.4)-.5)*2.);
  col*=1.-hw*.15*h1;
  // screentone: the blacks carry a dot screen, as on a printed page
  float tw=smoothstep(.3,.16,lum0)*smoothstep(.03,.08,lum0)*notRed*(1.-smoothstep(12.,34.,d0));
  vec2 tp=mat2(.707,-.707,.707,.707)*gl_FragCoord.xy/sc/5.5;
  col=mix(col,col*1.7+.07,tw*smoothstep(.36,.22,length(fract(tp)-.5))*.55);
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
  // focus lines: ink raked in from the edges on a heavy blow
  vec2 qd=normalize(q*asp+1e-5);
  float fl=vn(qd*19.+uTime*40.)*vn(qd*53.+3.);
  col=mix(col,ink,smoothstep(.3,.7,length(q*vec2(1.,1.25)))*smoothstep(.24,.46,fl)*uImpact*.85);
  col=mix(col,col*vec3(.62,.58,.55),vig*.75);
  col=mix(col,1.-col,uInvert);
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
      uKill: { value: 0 }, uFlash: { value: 0 }, uDim: { value: 0 }, uTime: { value: 0 }, uImpact: { value: 0 }, uInvert: { value: 0 }, tBloom: { value: null }, uSun: { value: new THREE.Vector2() }, uRays: { value: 0 }, uTan: { value: new THREE.Vector2() }, uCam: { value: new THREE.Matrix3() },
      uSunDir: { value: sunPos.clone().normalize() }, uMoon: { value: new THREE.Vector3(-.62, .5, .6).normalize() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: POST_FS, depthTest: false, depthWrite: false });
  postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat); postScene.add(postQuad);
  const VS = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';
  brightMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, px: { value: new THREE.Vector2() } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: 'uniform sampler2D t; uniform vec2 px; varying vec2 vUv; void main(){ vec3 c=(texture2D(t,vUv+px*vec2(-1.,-1.)).rgb+texture2D(t,vUv+px*vec2(1.,-1.)).rgb+texture2D(t,vUv+px*vec2(-1.,1.)).rgb+texture2D(t,vUv+px).rgb)*.25; gl_FragColor=vec4(min(max(c-1.,0.),vec3(6.)),1.); }' });
  blurMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c=texture2D(t,vUv).rgb*.227; c+=(texture2D(t,vUv+d*1.385).rgb+texture2D(t,vUv-d*1.385).rgb)*.316; c+=(texture2D(t,vUv+d*3.231).rgb+texture2D(t,vUv-d*3.231).rgb)*.07; gl_FragColor=vec4(c,1.); }' });
  renderer.shadowMap.autoUpdate = false;
  rcam = new THREE.PerspectiveCamera(); rcam.layers.enable(FX);
  // light that moves: four lantern flames, and one flash that jumps to every clash of steel
  for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2, L = new THREE.PointLight(0xff9a3c, 4, 6, 2); L.position.set(Math.sin(a) * (RING + 1.6), 1.45, Math.cos(a) * (RING + 1.6)); scene.add(L); lanternL.push(L); }
  flashL = new THREE.PointLight(0xfff1cf, 0, 9, 2); scene.add(flashL);
  resize();
  addEventListener('resize', resize);
  buildArena(); buildDressing(); buildNature(); buildTorches(); buildDust(); buildParticles(); buildSnow(); buildBursts();
  return { renderer, scene, camera };
}

export function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (rtColor) { rtColor.dispose(); rtNormal.dispose(); rtBa.dispose(); rtBb.dispose(); rtRefl.dispose(); }
  const bo = { type: THREE.HalfFloatType, depthBuffer: false }, bw = Math.max(2, s.x >> 2), bh = Math.max(2, s.y >> 2), rs = IS_TOUCH ? 3 : 2;
  rtBa = new THREE.WebGLRenderTarget(bw, bh, bo); rtBb = new THREE.WebGLRenderTarget(bw, bh, bo);
  rtRefl = new THREE.WebGLRenderTarget(Math.max(2, s.x / rs | 0), Math.max(2, s.y / rs | 0), { type: THREE.HalfFloatType });
  rtColor = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, depthBuffer: true });
  rtColor.depthTexture = new THREE.DepthTexture(s.x, s.y); rtColor.depthTexture.type = THREE.UnsignedIntType;
  rtNormal = new THREE.WebGLRenderTarget(s.x, s.y, { depthBuffer: true });
  postMat.uniforms.uRes.value.copy(s);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

export const look = { kill: 0, flash: 0, dim: 0, shake: 0, impact: 0, punch: 0, invert: 0 };
let clock = 0, slow = .016, warm = 0, quality = 2;
export function render(dt) {
  if (look.shake > 0) {
    look.shake = Math.max(0, look.shake - dt * 2.6);
    const a = look.shake * look.shake * .22;
    camera.position.x += (Math.random() - .5) * a; camera.position.y += (Math.random() - .5) * a;
  }
  look.flash = Math.max(0, look.flash - dt * 5); look.impact = Math.max(0, look.impact - dt * 3.2); look.invert = Math.max(0, look.invert - dt); look.punch = Math.max(0, look.punch - dt * 3.5);
  renderer.shadowMap.needsUpdate = true;
  // the ice: the whole scene once more, seen from under the ground
  camera.updateMatrixWorld();
  rcam.position.set(camera.position.x, -camera.position.y, camera.position.z);
  camera.getWorldDirection(_v); _v2.copy(camera.position).add(_v); _v2.y = -_v2.y;
  rcam.up.set(0, 1, 0).applyQuaternion(camera.quaternion); rcam.up.y *= -1; rcam.lookAt(_v2);
  rcam.projectionMatrix.copy(camera.projectionMatrix); rcam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  rcam.updateMatrixWorld(); rcam.matrixWorldInverse.copy(rcam.matrixWorld).invert();
  texMat.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1).multiply(rcam.projectionMatrix).multiply(rcam.matrixWorldInverse);
  // keep the frame rate: a slow device gives up the mirror first, then resolution
  if (!navigator.webdriver && dt > 0) {
    slow = slow * .97 + dt * .03; if ((warm += dt) > 4 && slow > .036 && quality > 0) { quality--; warm = 0; slow = .02; if (quality === 0) { renderer.setPixelRatio(1); resize(); } }
  }
  ice.material.uniforms.uOn.value = quality > 1 ? 1 : 0;
  if (quality > 1) { ice.visible = false; renderer.setRenderTarget(rtRefl); renderer.render(scene, rcam); ice.visible = true; }
  ice.material.uniforms.tRefl.value = rtRefl.texture; ice.material.uniforms.uTime.value = clock;
  flashL.intensity *= Math.exp(-dt * 13); if (flashL.intensity < .05) flashL.intensity = 0;
  renderer.setRenderTarget(rtColor); renderer.render(scene, camera);
  // bloom: keep only what is brighter than paper, and let it spread
  const pass = (mat, target) => { postQuad.material = mat; renderer.setRenderTarget(target); renderer.render(postScene, postCam); };
  brightMat.uniforms.t.value = rtColor.texture; brightMat.uniforms.px.value.set(1 / rtColor.width, 1 / rtColor.height); pass(brightMat, rtBa);
  for (const k of [1, 2.2]) { blurMat.uniforms.t.value = rtBa.texture; blurMat.uniforms.d.value.set(k / rtBa.width, 0); pass(blurMat, rtBb); blurMat.uniforms.t.value = rtBb.texture; blurMat.uniforms.d.value.set(0, k / rtBa.height); pass(blurMat, rtBa); }
  postQuad.material = postMat;
  _v.copy(sunPos).project(camera); const su = postMat.uniforms;
  const th = Math.tan(camera.fov * Math.PI / 360); su.uTan.value.set(th * camera.aspect, th); su.uCam.value.setFromMatrix4(camera.matrixWorld);
  su.tBloom.value = rtBa.texture; su.uSun.value.set(_v.x * .5 + .5, _v.y * .5 + .5); su.uRays.value = _v.z < 1 ? Math.max(0, 1 - Math.hypot(_v.x, _v.y) * .45) : 0;
  camera.layers.disable(FX); scene.overrideMaterial = normalMat;
  const fog = scene.fog; scene.fog = null;
  renderer.setRenderTarget(rtNormal); renderer.setClearColor(0x8080ff, 1); renderer.render(scene, camera);
  renderer.setClearColor(PAPER, 1);
  scene.overrideMaterial = null; scene.fog = fog; camera.layers.enable(FX);
  const u = postMat.uniforms;
  u.tColor.value = rtColor.texture; u.tDepth.value = rtColor.depthTexture; u.tNormal.value = rtNormal.texture;
  u.uTime.value = clock; u.uImpact.value = Math.min(1, look.impact); u.uInvert.value = look.invert > 0 ? 1 : 0; u.uKill.value = look.kill; u.uFlash.value = look.flash; u.uDim.value = look.dim;
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
  const ground = mesh(new THREE.CircleGeometry(120, 48), toon(SNOW, { norim: true }), 0, 0, 0, false);
  buildIce();
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
  sun.material.color.multiplyScalar(1.9); sun.position.copy(sunPos); sun.layers.set(FX); scene.add(sun);
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
    // each pine is one group, so the whole tree can lean in the wind
    const tree = new THREE.Group(); tree.position.set(x, 0, z); scene.add(tree);
    const part = (g, m, y, sh = true) => { const o = new THREE.Mesh(g, m); o.position.y = y; o.castShadow = sh; o.receiveShadow = true; tree.add(o); return o; };
    part(new THREE.CylinderGeometry(.13 * s, .22 * s, 2.4 * s, 6), trunk, 1.2 * s);
    for (let t = 0; t < 4; t++) {
      const y = (2 + t * 1.15) * s, rr = (1.75 - t * .36) * s;
      const c = part(new THREE.ConeGeometry(rr, 1.7 * s, 7), leaf, y + .5 * s); c.rotation.y = rnd() * 3;
      const sn = part(new THREE.ConeGeometry(rr * .62, 1.06 * s, 7), toon(SNOW), y + .86 * s, false); sn.rotation.y = c.rotation.y;
    }
    swayers.push({ g: tree, ph: rnd() * 6, amp: .8 + rnd() * .5 });
  }
  // stone lanterns at the quarters of the ring
  const glow = flat(0xffb347); glow.color.multiplyScalar(2.2);
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
const cBlood = new THREE.Color(BLOOD), cSpark = new THREE.Color(0xffe9a8).multiplyScalar(4.5), cEmber = new THREE.Color(0xff7a22).multiplyScalar(4), cPuff = new THREE.Color(0xffffff), cInk = new THREE.Color(INK);
function buildParticles() {
  pMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), NP);
  pMesh.layers.set(FX); pMesh.frustumCulled = false; pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < NP; i++) { parts.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, kind: 0 }); pMesh.setColorAt(i, cBlood); }
  scene.add(pMesh);
}
function emit(kind, p, v, r, life) {
  const o = parts[pNext]; pNext = (pNext + 1) % NP;
  o.kind = kind; o.p.copy(p); o.v.copy(v); o.r = r; o.life = o.max = life;
  pMesh.setColorAt(parts.indexOf(o), kind === 0 ? cBlood : kind === 1 ? cSpark : kind === 3 ? cInk : kind === 5 ? cEmber : cPuff);
  pMesh.instanceColor.needsUpdate = true;
}
/** a fan of blood thrown along dir */
/** replay hook: every effect call is offered to the tap so it can be fired again */
export const fxTap = { on: null };
const tap = (name, args) => { if (fxTap.on) fxTap.on(name, args.map(a => a && a.isVector3 ? a.clone() : a)); };
export function bleed(p, dir, n, speed, spread = .45) {
  tap('bleed', [p, dir, n, speed, spread]);
  for (let i = 0; i < n; i++) {
    _v.set(dir.x + (Math.random() - .5) * spread * 2, dir.y + (Math.random() - .3) * spread * 2, dir.z + (Math.random() - .5) * spread * 2)
      .normalize().multiplyScalar(speed * (.35 + Math.random() * .9));
    emit(0, p, _v, .018 + Math.random() * .03, 2.5);
  }
}
export function sparks(p, n = 16) {
  tap('sparks', [p, n]);
  for (let i = 0; i < n; i++) {
    _v.set(Math.random() - .5, Math.random() - .2, Math.random() - .5).normalize().multiplyScalar(2 + Math.random() * 5);
    emit(1, p, _v, .012 + Math.random() * .012, .18 + Math.random() * .25);
  }
}
/** flung ink: the impact, drawn */
export function inkSplash(p, dir, n = 14) {
  tap('inkSplash', [p, dir, n]);
  for (let i = 0; i < n; i++) {
    _v.set(dir.x + (Math.random() - .5) * 1.6, dir.y + Math.random() * .9, dir.z + (Math.random() - .5) * 1.6).normalize().multiplyScalar(2.5 + Math.random() * 5);
    emit(3, p, _v, .014 + Math.random() * .02, .25 + Math.random() * .3);
  }
}
/** breath in the cold */
export function vapor(p, dir) {
  for (let i = 0; i < 3; i++) { _v.set(dir.x * .5 + (Math.random() - .5) * .2, .12 + Math.random() * .1, dir.z * .5 + (Math.random() - .5) * .2); emit(4, p, _v, .028 + Math.random() * .02, .8 + Math.random() * .5); }
}
/** powder kicked off the ground: soft washes of grey that swell, drift on the wind and thin out */
export function puff(p, n = 8, power = 1) {
  tap('puff', [p, n, power]);
  for (let i = 0; i < n; i++) {
    const o = dusts[dustNext]; dustNext = (dustNext + 1) % dusts.length;
    o.m.position.set(p.x + (Math.random() - .5) * .22, .06 + Math.random() * .08, p.z + (Math.random() - .5) * .22);
    o.v.set((Math.random() - .5) * 1.7, .35 + Math.random() * .9, (Math.random() - .5) * 1.7).multiplyScalar(power);
    o.life = o.max = .55 + Math.random() * .6; o.size = (.14 + Math.random() * .16) * (.7 + power * .4); o.spin = (Math.random() - .5) * 2; o.rot = Math.random() * 6; o.m.visible = true;
  }
}
/** dust thrown one way: off a sliding foot, a lunge, a falling body */
export function spray(p, dir, n = 6, power = 1) {
  tap('spray', [p, dir, n, power]);
  for (let i = 0; i < n; i++) {
    const o = dusts[dustNext], k = .4 + Math.random() * 1.1; dustNext = (dustNext + 1) % dusts.length;
    o.m.position.set(p.x + (Math.random() - .5) * .15, .05 + Math.random() * .06, p.z + (Math.random() - .5) * .15);
    o.v.set(dir.x * 2.6 * k + (Math.random() - .5) * .8, .5 + Math.random() * 1.2, dir.z * 2.6 * k + (Math.random() - .5) * .8).multiplyScalar(power);
    o.life = o.max = .5 + Math.random() * .55; o.size = (.12 + Math.random() * .14) * (.7 + power * .4); o.spin = (Math.random() - .5) * 2; o.rot = Math.random() * 6; o.m.visible = true;
  }
}
const dusts = []; let dustNext = 0;
function buildDust() {
  const t = tex((c, w) => {                              // a bled wash: soft heart, ragged rim
    for (let i = 0; i < 26; i++) { const a = Math.random() * 6.3, r = Math.random() * w * .2, R = w * (.14 + Math.random() * .16); const g = c.createRadialGradient(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r, 0, w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r, R); g.addColorStop(0, 'rgba(255,255,255,.2)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, w); }
  }, 128, 128), geo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < (IS_TOUCH ? 40 : 72); i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, color: i % 3 ? 0xb4bccd : 0xe9edf4 }));
    m.layers.set(FX); m.visible = false; m.renderOrder = 2; scene.add(m); dusts.push({ m, v: new THREE.Vector3(), life: 0 });
  }
}
function tickDust(dt) {
  for (const o of dusts) {
    if (o.life <= 0) continue; o.life -= dt; if (o.life <= 0) { o.m.visible = false; continue; }
    const k = 1 - o.life / o.max;
    o.v.multiplyScalar(Math.max(0, 1 - 2.6 * dt)); o.v.y -= 1.1 * dt; o.v.x += wind.x * wind.gust * 1.6 * dt; o.v.z += wind.z * wind.gust * 1.6 * dt;
    o.m.position.addScaledVector(o.v, dt); if (o.m.position.y < .04) o.m.position.y = .04; o.rot += o.spin * dt;
    const s = o.size * (1 + k * 2.4); o.m.scale.set(s, s, 1); o.m.quaternion.copy(camera.quaternion).multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), o.rot));
    o.m.material.opacity = Math.min(1, k * 9) * (1 - k) ** 1.3 * .95;
  }
}
function tickParticles(dt) {
  for (let i = 0; i < NP; i++) {
    const o = parts[i];
    if (o.life <= 0) { _m.makeScale(0, 0, 0); pMesh.setMatrixAt(i, _m); continue; }
    o.life -= dt;
    o.v.y -= (o.kind === 5 ? -.5 : o.kind === 4 ? -.15 : o.kind === 2 ? 4 : 9.8) * dt;
    if (o.kind === 5) { o.v.x += (wind.x * (.6 + wind.gust * 2.5) - o.v.x) * dt * 2 + (Math.random() - .5) * dt * 4; o.v.z += (wind.z * (.6 + wind.gust * 2.5) - o.v.z) * dt * 2; }
    if (o.kind === 2) o.v.multiplyScalar(1 - 3 * dt);
    o.p.addScaledVector(o.v, dt);
    if (o.p.y < .015) {
      if (o.kind === 0) splat(o.p.x, o.p.z, o.r * (1.6 + Math.random() * 1.6), o.v.x, o.v.z);
      o.life = 0; continue;
    }
    const sp = o.v.length(), st = o.kind === 2 || o.kind === 4 ? 1 : 1 + Math.min(5, sp * (o.kind === 1 ? .5 : .16));
    const k = o.kind === 0 ? 1 : o.kind === 4 ? (2.2 - o.life / o.max) * Math.min(1, o.life / o.max * 3) : Math.max(.05, o.life / o.max);
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
    snowPos[i] += Math.sin(t * .7 + i) * .12 * dt + (.15 + wind.gust * 2.1) * dt;
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

/* ---------- nature: plum trees in bloom, reeds, drifts, crows, petals ---------- */
let petals, petalPos, crows = [];
const NPET = 70;
function buildNature() {
  const rnd = mulberry(29), D = new THREE.Object3D();
  // plum trees: black boughs, red blossom
  for (const [tx, tz, sc] of [[-11.5, -5.5, 1.15], [12, 2.5, 1], [-6, 13.5, .9]]) {
    const segs = [], buds = [];
    const grow = (p, dir, len, r, depth) => {
      const e = p.clone().addScaledVector(dir, len); segs.push([p, e, r]);
      if (depth === 0) { for (let i = 0; i < 5; i++) buds.push(p.clone().lerp(e, rnd()).add(new THREE.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).multiplyScalar(.22))); return; }
      const n = depth > 2 ? 2 : 2 + (rnd() < .5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const d = dir.clone().add(new THREE.Vector3(rnd() - .5, rnd() * .5 - .08, rnd() - .5).multiplyScalar(1.25)).normalize();
        grow(e, d, len * (.62 + rnd() * .2), r * .62, depth - 1);
      }
      if (depth < 3) for (let i = 0; i < 2; i++) buds.push(p.clone().lerp(e, rnd()).add(new THREE.Vector3(rnd() - .5, rnd() * .3, rnd() - .5).multiplyScalar(.15)));
    };
    grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(rnd() * .3 - .15, 1, rnd() * .3 - .15).normalize(), 1.5 * sc, .16 * sc, 4);
    const bm = new THREE.InstancedMesh(new THREE.CylinderGeometry(.62, 1, 1, 5).translate(0, .5, 0), toon(0x1c1816), segs.length);
    segs.forEach(([a, b, r], i) => { D.position.copy(a); _v.subVectors(b, a); const l = _v.length(); D.quaternion.setFromUnitVectors(UP, _v.multiplyScalar(1 / l)); D.scale.set(r, l * 1.04, r); D.updateMatrix(); bm.setMatrixAt(i, D.matrix); });
    bm.castShadow = true; scene.add(bm); bm.position.set(tx, 0, tz); const ph = rnd() * 6; swayers.push({ g: bm, ph, amp: 1.5 });
    const fm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), flat(0xd3243f, { fog: false }), buds.length);
    buds.forEach((b, i) => { D.position.copy(b); D.quaternion.identity(); D.scale.setScalar(.05 + rnd() * .05); D.updateMatrix(); fm.setMatrixAt(i, D.matrix); });
    fm.layers.set(FX); scene.add(fm); fm.position.set(tx, 0, tz); swayers.push({ g: fm, ph, amp: 1.5 });
  }
  // dry reeds standing through the snow
  const NR = IS_TOUCH ? 160 : 320, reedMat = flat(0x352d22), reeds = new THREE.InstancedMesh(new THREE.ConeGeometry(.016, 1, 3, 4).translate(0, .5, 0), reedMat, NR);
  // reeds bend from the root, each in its own time, harder when it gusts
  reedMat.onBeforeCompile = sh => { sh.uniforms.uW = windU; sh.vertexShader = 'uniform vec2 uW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 1.3; float bend = (sin(uW.x * 2.1 + ph) * .1 + sin(uW.x * 5.3 + ph * 2.) * .03 + .16) * (.3 + uW.y * 1.4) * position.y * position.y;\n transformed.x += bend; transformed.z += bend * .3;'); };
  reeds.layers.set(FX);
  for (let i = 0, c = 0; i < NR; i++) {
    if (i % 8 === 0) { const a = rnd() * 6.3, r = RING + 1.2 + rnd() * 11; c = [Math.sin(a) * r, Math.cos(a) * r]; }
    D.position.set(c[0] + (rnd() - .5) * .7, 0, c[1] + (rnd() - .5) * .7); D.quaternion.identity(); D.rotation.set((rnd() - .5) * .5, rnd() * 6, (rnd() - .5) * .5); D.scale.set(1, .35 + rnd() * .6, 1); D.updateMatrix(); reeds.setMatrixAt(i, D.matrix);
  }
  scene.add(reeds);
  // drifts, and the worn stones of the approach
  const drifts = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), toon(SNOW), 14);
  for (let i = 0; i < 14; i++) { const a = rnd() * 6.3, r = RING + 2 + rnd() * 12; D.position.set(Math.sin(a) * r, -.05, Math.cos(a) * r); D.rotation.set(0, rnd() * 6, 0); D.scale.set(1.2 + rnd() * 2.2, .22 + rnd() * .3, .9 + rnd() * 1.6); D.updateMatrix(); drifts.setMatrixAt(i, D.matrix); }
  drifts.receiveShadow = true; scene.add(drifts);
  for (let i = 0; i < 6; i++) { const m = mesh(new THREE.BoxGeometry(1.5 + rnd() * .5, .06, .8), toon(0x8d8d8a), (rnd() - .5) * .5, .02, -RING - .9 - i * .98, false); m.rotation.y = (rnd() - .5) * .16; }
  // crows turning over the shrine
  const wing = new THREE.BufferGeometry(); wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, .16, 0, 0, -.16, .62, 0, -.05]), 3));
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group(), m = flat(0x15120f, { side: THREE.DoubleSide, fog: false });
    const L = new THREE.Mesh(wing, m), Rw = new THREE.Mesh(wing, m); Rw.scale.x = -1; g.add(L, Rw); L.layers.set(FX); Rw.layers.set(FX);
    scene.add(g); crows.push({ g, L, Rw, a: rnd() * 6.3, r: 22 + rnd() * 20, h: 11 + rnd() * 8, sp: .09 + rnd() * .07, ph: rnd() * 6 });
  }
  // petals on the wind
  petalPos = new Float32Array(NPET * 3);
  for (let i = 0; i < NPET * 3; i += 3) { petalPos[i] = (rnd() - .5) * 24; petalPos[i + 1] = rnd() * 7; petalPos[i + 2] = (rnd() - .5) * 24; }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
  petals = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xd3243f, size: .075, depthWrite: false, fog: false, transparent: true, alphaTest: .3,
    map: tex((c, w) => { c.fillStyle = '#fff'; c.beginPath(); c.ellipse(w / 2, w / 2, w * .44, w * .26, .6, 0, 6.3); c.fill(); }, 32, 32) }));
  petals.layers.set(FX); petals.frustumCulled = false; scene.add(petals);
}
function tickNature(dt, t) {
  for (const c of crows) {
    c.a += c.sp * dt; c.g.position.set(Math.sin(c.a) * c.r, c.h + Math.sin(t * .4 + c.ph) * 1.2, Math.cos(c.a) * c.r - 12); c.g.rotation.y = c.a + Math.PI / 2;
    const f = Math.sin(t * 7 + c.ph) * .7; c.L.rotation.z = f; c.Rw.rotation.z = -f;
  }
  for (let i = 0; i < NPET * 3; i += 3) {
    petalPos[i + 1] -= (.35 + (i % 5) * .05) * dt; petalPos[i] += (.5 + wind.gust * 1.6 + Math.sin(t * 1.3 + i) * .7) * dt; petalPos[i + 2] += Math.cos(t * .9 + i) * .4 * dt;
    if (petalPos[i + 1] < 0) petalPos[i + 1] += 7; if (petalPos[i] > 12) petalPos[i] -= 24;
  }
  petals.geometry.attributes.position.needsUpdate = true;
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
  tap('burst', [kind, p, color, size, life, dir, grow]);
  const o = bursts.find(b => b.life <= 0) || bursts[0];
  o.m.material.map = TEX[kind]; o.m.material.color.set(color); o.m.material.needsUpdate = true;
  if (kind === 'star') { o.m.material.color.multiplyScalar(2.6); flashL.position.copy(p); flashL.intensity = 30 * size + 16; }
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
  for (let i = -2; i <= 2; i++) { const p = mesh(new THREE.BoxGeometry(.22, .5, .02).translate(0, -.25, 0), toon(0xf8f5ee), i * .95, 4.25, -14.86, false); shide.push(p); }
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
      a[i + 2] = Math.sin(t * 3.1 + y * 2.2 + b.ph + free * 2) * .16 * (.4 + wind.gust * 1.1) * free + Math.sin(t * 5.3 + y * 4 + b.ph) * .04 * free;
      a[i] = o[i] - Math.abs(a[i + 2]) * .25 * free;
    }
    p.needsUpdate = true;
  }
  for (const o of mist) { o.a += o.sp * dt; o.m.position.x = Math.sin(o.a) * o.r; o.m.position.z = Math.cos(o.a) * o.r; o.m.quaternion.copy(camera.quaternion); }
  glows.forEach((g, i) => { g.quaternion.copy(camera.quaternion); g.material.opacity = .45 + .12 * Math.sin(t * 9 + i * 2) * Math.sin(t * 23 + i); });
}

/* ---------- kagaribi: iron fire-baskets burning around the court ---------- */
const torches = [];
function buildTorches() {
  const iron = toon(0x1d1a18), wood = toon(0x3a2a1c);
  const flameMat = seed => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uT: windU, uS: { value: seed } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `
uniform vec2 uT; uniform float uS; varying vec2 vUv;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
void main(){
  float t=uT.x, y=vUv.y;
  // the flame leans with the gust and licks upward in tongues
  float x=vUv.x-.5-(uT.y*.22+sin(t*3.+uS)*.04)*y*y;
  float n=vn(vec2(x*5.+uS,y*3.2-t*3.1))*.6+vn(vec2(x*11.-uS,y*7.-t*5.3))*.4;
  float body=(1.-y)*smoothstep(.5,.0,abs(x)*(1.6+y*2.2));
  float f=body*(.55+n*1.25)-y*.22;
  float a=smoothstep(.2,.26,f);
  // three inked bands: ember red, orange, a white-gold heart
  vec3 col=mix(vec3(2.6,.5,.08),vec3(3.4,1.5,.18),step(.42,f)); col=mix(col,vec3(4.2,3.4,1.6),step(.66,f));
  gl_FragColor=vec4(col,a);
}` });
  const spots = [[-3.9, -12.6], [3.9, -12.6]];
  for (let i = 0; i < 4; i++) { const a = Math.PI / 8 + i * Math.PI / 2; spots.push([Math.sin(a) * (RING + 4.6), Math.cos(a) * (RING + 4.6)]); }
  spots.forEach(([x, z], i) => {
    for (let k = 0; k < 3; k++) { const a = k * 2.094 + i, leg = mesh(new THREE.CylinderGeometry(.03, .04, 1.75, 5), wood, x + Math.sin(a) * .2, .84, z + Math.cos(a) * .2); leg.rotation.set(Math.cos(a) * .24, 0, -Math.sin(a) * .24); }
    mesh(new THREE.CylinderGeometry(.27, .15, .3, 8, 1, true), toon(0x1d1a18, { side: THREE.DoubleSide }), x, 1.72, z);
    mesh(new THREE.CylinderGeometry(.24, .24, .08, 8), flat(new THREE.Color(0xff5a14).multiplyScalar(2.2)), x, 1.8, z, false);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(.95, 1.5).translate(0, .75, 0), flameMat(i * 3.7)); f.position.set(x, 1.72, z); f.layers.set(FX); f.renderOrder = 3; scene.add(f);
    let L = null; if (i < 2 || !IS_TOUCH) { L = new THREE.PointLight(0xff8a30, 0, 11, 2); L.position.set(x, 2.3, z); scene.add(L); }
    torches.push({ f, L, x, z, ph: i * 2.3 });
  });
}
function tickTorches(dt, t) {
  for (const o of torches) {
    o.f.rotation.y = Math.atan2(camera.position.x - o.x, camera.position.z - o.z);
    const fl = .8 + .2 * Math.sin(t * 13 + o.ph) * Math.sin(t * 31 + o.ph * 2) + .1 * Math.sin(t * 4.1 + o.ph);
    o.f.scale.set(1 + .08 * Math.sin(t * 9 + o.ph), .9 + fl * .22, 1); if (o.L) o.L.intensity = 6 * fl;
    if (Math.random() < dt * (5 + wind.gust * 9)) { _v2.set(o.x + (Math.random() - .5) * .3, 1.95 + Math.random() * .5, o.z + (Math.random() - .5) * .3); _v.set((Math.random() - .5) * .6, 1.1 + Math.random() * 1.3, (Math.random() - .5) * .6); emit(5, _v2, _v, .011 + Math.random() * .01, .9 + Math.random() * 1.3); }
  }
}

/* ---------- ice: clear patches in the trodden snow that hold the world upside down ---------- */
function buildIce() {
  ice = new THREE.Mesh(new THREE.CircleGeometry(42, 64), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { tRefl: { value: null }, uTex: { value: texMat }, uTime: { value: 0 }, uRing: { value: RING }, uOn: { value: 1 } },
    vertexShader: 'uniform mat4 uTex; varying vec4 vP; varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vP=uTex*w; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: `
uniform sampler2D tRefl; uniform float uTime, uRing, uOn; varying vec4 vP; varying vec3 vW;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ return vn(p)*.55+vn(p*2.1+7.)*.3+vn(p*4.3+3.)*.15; }
void main(){
  vec2 p=vW.xz; float r=length(p);
  float iceM=smoothstep(.46,.6,fbm(p*.33+2.))*smoothstep(uRing+.6,uRing-1.2,r);
  vec2 uv=vP.xy/vP.w+(vec2(vn(p*2.6),vn(p*2.6+9.))-.5)*.014;
  vec3 refl=min(texture2D(tRefl,uv).rgb,vec3(1.6));
  vec3 view=normalize(cameraPosition-vW); float fres=.3+.7*pow(1.-max(view.y,0.),2.2);
  vec3 col=mix(vec3(.5,.62,.72),refl,.78*uOn); float a=iceM*fres*.85;
  // crack lines in the ice
  float cr=smoothstep(.016,.0,abs(vn(p*1.3+11.)-.5))*iceM; col=mix(col,vec3(.9,.95,1.),cr*.6);
  // cloud shadows crossing the court
  float cl=smoothstep(.5,.78,fbm(p*.06+uTime*vec2(.045,.018)))*.16*smoothstep(42.,30.,r);
  col=mix(vec3(.36,.42,.56),col,a/(a+cl+1e-4)); a=max(a,cl);
  // frost glitter: single grains catching the sun as the eye moves
  vec2 g=floor(p*42.); float h=hash(g);
  float sp=step(.9972,h)*smoothstep(.55,1.,sin(uTime*2.+h*90.+dot(view.xz,vec2(31.,17.))))*(1.-iceM)*smoothstep(26.,8.,r);
  col+=vec3(3.2,3.1,2.8)*sp; a=max(a,sp);
  gl_FragColor=vec4(col,a);
}` }));
  ice.rotation.x = -Math.PI / 2; ice.position.y = .006; ice.layers.set(FX); ice.renderOrder = 0; scene.add(ice);
}
function tickWind(dt, t) {
  wind.gust = Math.max(0, Math.min(1, .5 + .55 * Math.sin(t * .23) * Math.sin(t * .61 + 1.3) + .12 * Math.sin(t * 1.7)));
  windU.value.set(t, wind.gust);
  for (const s of swayers) { s.g.rotation.z = -(Math.sin(t * 1.3 + s.ph) * .007 + wind.gust * .02) * s.amp; s.g.rotation.x = Math.cos(t * 1.05 + s.ph) * .006 * s.amp; }
  shide.forEach((p, i) => { p.rotation.z = Math.sin(t * 2.6 + i * 1.3) * .2 * (.4 + wind.gust) + wind.gust * .25; p.rotation.x = Math.sin(t * 3.4 + i) * .12 * wind.gust; });
  lanternL.forEach((L, i) => { L.intensity = 4 * (.82 + .14 * Math.sin(t * 11 + i * 2.1) * Math.sin(t * 27 + i) + .08 * Math.sin(t * 3.3 + i)); });
}

export function tick(dt, t) {
  clock = t; tickWind(dt, t); tickTorches(dt, t); tickDust(dt); tickParticles(dt); tickSnow(dt, t); tickBursts(dt); tickDressing(dt, t); tickNature(dt, t);
  if (decalDirty) { decalTex.needsUpdate = true; decalDirty = false; }
}
export { scene, camera, renderer };
