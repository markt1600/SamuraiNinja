/* =========================================================================
   ZAN — a duel in the snow
   Simulation-first samurai duel. No hit points: layered anatomy, blade
   momentum, edge alignment, hemorrhage, consciousness. One cut decides.
   ========================================================================= */
'use strict';

/* ----------------------------- utilities ------------------------------ */
const V3 = (x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
const TMP1=V3(), TMP2=V3(), TMP3=V3(), TMP4=V3();
const DIRY=(y)=>V3(Math.sin(y),0,Math.cos(y));
function lerpAngle(a,b,t){ let d=b-a;
  while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2; return a+d*t; }

/* closest points between two segments (p1-q1, p2-q2). returns {d, c1, c2} */
function segSegClosest(p1,q1,p2,q2,out1,out2){
  const d1=TMP1.subVectors(q1,p1), d2=TMP2.subVectors(q2,p2), r=TMP3.subVectors(p1,p2);
  const a=d1.dot(d1), e=d2.dot(d2), f=d2.dot(r);
  let s,t;
  if(a<=1e-9&&e<=1e-9){ out1.copy(p1); out2.copy(p2); return out1.distanceTo(out2); }
  if(a<=1e-9){ s=0; t=clamp(f/e,0,1); }
  else{
    const c=d1.dot(r);
    if(e<=1e-9){ t=0; s=clamp(-c/a,0,1); }
    else{
      const b=d1.dot(d2), den=a*e-b*b;
      s=den>1e-9?clamp((b*f-c*e)/den,0,1):0;
      t=(b*s+f)/e;
      if(t<0){t=0;s=clamp(-c/a,0,1);} else if(t>1){t=1;s=clamp((b-c)/a,0,1);}
    }
  }
  out1.copy(p1).addScaledVector(d1,s);
  out2.copy(p2).addScaledVector(d2,t);
  return out1.distanceTo(out2);
}

/* ------------------------------ audio --------------------------------- */
const Sound=(()=>{
  let ctx=null;
  const ac=()=>ctx||(ctx=new (window.AudioContext||window.webkitAudioContext)());
  function noiseBuf(len){ const b=ac().createBuffer(1,ac().sampleRate*len,ac().sampleRate);
    const d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1; return b; }
  function whoosh(speed){ // blade cutting air — filtered noise sweep
    if(!ctx)return; const t=ctx.currentTime, s=ctx.createBufferSource(); s.buffer=noiseBuf(.35);
    const f=ctx.createBiquadFilter(); f.type='bandpass'; f.Q.value=1.2;
    f.frequency.setValueAtTime(300+speed*90,t); f.frequency.exponentialRampToValueAtTime(120,t+.3);
    const g=ctx.createGain(); const vol=clamp((speed-4)/10,0,1)*.5;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol,t+.05); g.gain.exponentialRampToValueAtTime(.001,t+.32);
    s.connect(f).connect(g).connect(ctx.destination); s.start(t);
  }
  function clang(hard){ // steel on steel
    if(!ctx)return; const t=ctx.currentTime, g=ctx.createGain();
    g.gain.setValueAtTime(hard?.5:.28,t); g.gain.exponentialRampToValueAtTime(.001,t+.7);
    g.connect(ctx.destination);
    [2470,3610,5120,1830].forEach((fr,i)=>{ const o=ctx.createOscillator(); o.type='sine';
      o.frequency.value=fr*rand(.98,1.02); const og=ctx.createGain(); og.gain.value=.25/(i+1);
      o.connect(og).connect(g); o.start(t); o.stop(t+.7); });
    const s=ctx.createBufferSource(); s.buffer=noiseBuf(.06); const sg=ctx.createGain();
    sg.gain.setValueAtTime(.4,t); sg.gain.exponentialRampToValueAtTime(.001,t+.05);
    s.connect(sg).connect(ctx.destination); s.start(t);
  }
  function cut(depth){ // flesh
    if(!ctx)return; const t=ctx.currentTime, s=ctx.createBufferSource(); s.buffer=noiseBuf(.2);
    const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=900;
    const g=ctx.createGain(); g.gain.setValueAtTime(clamp(depth/8,0.15,0.6),t);
    g.gain.exponentialRampToValueAtTime(.001,t+.18);
    s.connect(f).connect(g).connect(ctx.destination); s.start(t);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(140,t);
    o.frequency.exponentialRampToValueAtTime(50,t+.15);
    const og=ctx.createGain(); og.gain.setValueAtTime(clamp(depth/10,.1,.5),t);
    og.gain.exponentialRampToValueAtTime(.001,t+.16);
    o.connect(og).connect(ctx.destination); o.start(t); o.stop(t+.2);
  }
  function thump(){ // body hits snow
    if(!ctx)return; const t=ctx.currentTime, o=ctx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(90,t); o.frequency.exponentialRampToValueAtTime(35,t+.25);
    const g=ctx.createGain(); g.gain.setValueAtTime(.5,t); g.gain.exponentialRampToValueAtTime(.001,t+.3);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t+.35);
  }
  return {ac,whoosh,clang,cut,thump};
})();


/* --------------------------- renderer/scene ---------------------------- */
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth,innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.12;
document.body.appendChild(renderer.domElement);

const SRGB=(hex)=>new THREE.Color(hex).convertSRGBToLinear();
const stdMat=(hex,opts)=>new THREE.MeshStandardMaterial(Object.assign({color:SRGB(hex)},opts||{}));

const scene=new THREE.Scene();
scene.background=SRGB(0x0c0f14);
scene.fog=new THREE.FogExp2(SRGB(0x0e1218).getHex(),0.048);

const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.1,140);
camera.position.set(0,2.1,6.4);
addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });

/* canvas texture helper — degrades gracefully where 2D canvas is absent */
function canTex(w,h,draw,opt){
  opt=opt||{};
  try{
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const ctx=c.getContext('2d'); if(!ctx)return null;
    draw(ctx,w,h);
    const t=new THREE.CanvasTexture(c);
    if(opt.srgb!==false)t.encoding=THREE.sRGBEncoding;
    if(opt.repeat){ t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(opt.repeat,opt.repeat); }
    t.anisotropy=4;
    return t;
  }catch(e){ return null; }
}

/* ------------------------------ lighting ------------------------------- */
const moon=new THREE.DirectionalLight(SRGB(0xbdd0ec).getHex(),1.0);
moon.position.set(-7,12,5); moon.castShadow=true;
moon.shadow.mapSize.set(2048,2048);
moon.shadow.camera.left=-8; moon.shadow.camera.right=8;
moon.shadow.camera.top=8; moon.shadow.camera.bottom=-8;
moon.shadow.bias=-.0004;
scene.add(moon);
scene.add(new THREE.HemisphereLight(SRGB(0x2c3a4e).getHex(),SRGB(0x0a0c10).getHex(),.6));

const RING_R=5.0;

/* stone lanterns with living flames — warm against the moon's cold */
const lanterns=[];
(function buildLanterns(){
  const stone=stdMat(0x565b60,{roughness:.95});
  const flameM=new THREE.MeshBasicMaterial({color:SRGB(0xffc07a)});
  [[1,1],[-1,1],[1,-1],[-1,-1]].forEach(([sx,sz],i)=>{
    const g=new THREE.Group();
    const x=sx*(RING_R+1.5), z=sz*(RING_R+1.5);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.24,.3,.22,8),stone); base.position.y=.11;
    const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.09,.11,.85,8),stone); shaft.position.y=.63;
    const box=new THREE.Mesh(new THREE.BoxGeometry(.34,.3,.34),stone); box.position.y=1.2;
    const win=new THREE.Mesh(new THREE.BoxGeometry(.36,.16,.16),flameM); win.position.y=1.2;
    const win2=new THREE.Mesh(new THREE.BoxGeometry(.16,.16,.36),flameM); win2.position.y=1.2;
    const roof=new THREE.Mesh(new THREE.ConeGeometry(.32,.24,4),stone); roof.position.y=1.47; roof.rotation.y=Math.PI/4;
    const snowcap=new THREE.Mesh(new THREE.ConeGeometry(.3,.1,4),stdMat(0xdfe4e8,{roughness:.9}));
    snowcap.position.y=1.56; snowcap.rotation.y=Math.PI/4;
    g.add(base,shaft,box,win,win2,roof,snowcap);
    g.position.set(x,0,z);
    g.traverse(o=>{ if(o.isMesh)o.castShadow=true; });
    scene.add(g);
    const light=new THREE.PointLight(SRGB(0xffb168).getHex(),.85,9,2);
    light.position.set(x,1.25,z); scene.add(light);
    lanterns.push({light,base:.85,seed:i*2.3});
  });
})();

/* ------------------------------- ground -------------------------------- */
const groundTex=canTex(512,512,(ctx,w,h)=>{
  ctx.fillStyle='#cdd4da'; ctx.fillRect(0,0,w,h);
  for(let i=0;i<5200;i++){
    const v=200+Math.floor(Math.random()*46);
    ctx.fillStyle='rgba('+(v-8)+','+(v-3)+','+(v+4)+','+(Math.random()*.5).toFixed(2)+')';
    ctx.fillRect(Math.random()*w,Math.random()*h,rand(1,4),rand(1,4));
  }
  for(let i=0;i<160;i++){ // sparkle
    ctx.fillStyle='rgba(255,255,255,'+rand(.25,.7).toFixed(2)+')';
    ctx.fillRect(Math.random()*w,Math.random()*h,1,1);
  }
},{repeat:16});
const groundMat=groundTex?stdMat(0xffffff,{map:groundTex,roughness:.94})
                         :stdMat(0xccd2d8,{roughness:.94});
const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),groundMat);
ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);

/* trampled fighting circle inside the rope */
const ringTex=canTex(512,512,(ctx,w,h)=>{
  const g=ctx.createRadialGradient(w/2,h/2,10,w/2,h/2,w/2);
  g.addColorStop(0,'#b9c0c7'); g.addColorStop(.75,'#c2c9cf'); g.addColorStop(1,'#ccd3d9');
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='rgba(120,128,138,.35)';
  for(let i=0;i<220;i++){ // scuffed arcs of old footwork
    ctx.beginPath(); const r=rand(20,240), a=rand(0,6.28);
    ctx.arc(w/2,h/2,r,a,a+rand(.1,.7)); ctx.lineWidth=rand(1,3); ctx.stroke();
  }
});
const ringGroundMat=ringTex?stdMat(0xffffff,{map:ringTex,roughness:.97})
                           :stdMat(0xbfc6cc,{roughness:.97});
const ringGround=new THREE.Mesh(new THREE.CircleGeometry(RING_R+.45,48),ringGroundMat);
ringGround.rotation.x=-Math.PI/2; ringGround.position.y=.004; ringGround.receiveShadow=true;
scene.add(ringGround);

/* the rope: posts, sagging shimenawa, paper shide */
(function buildRope(){
  const wood=stdMat(0x2c241c,{roughness:.9});
  const ropeM=stdMat(0x8d7d5a,{roughness:1});
  const paperM=stdMat(0xece8dd,{roughness:.8,side:THREE.DoubleSide});
  const N=9, tops=[];
  for(let i=0;i<N;i++){
    const a=i/N*Math.PI*2, x=Math.cos(a)*(RING_R+.32), z=Math.sin(a)*(RING_R+.32);
    const post=new THREE.Mesh(new THREE.CylinderGeometry(.045,.06,1.02,8),wood);
    post.position.set(x,.51,z); post.castShadow=true; scene.add(post);
    const cap=new THREE.Mesh(new THREE.SphereGeometry(.05,8,6),stdMat(0xdfe4e8,{roughness:.9}));
    cap.position.set(x,1.03,z); scene.add(cap);
    tops.push(V3(x,.98,z));
  }
  for(let i=0;i<N;i++){
    const a=tops[i], b=tops[(i+1)%N];
    const mid=a.clone().add(b).multiplyScalar(.5); mid.y-=.14;
    const curve=new THREE.QuadraticBezierCurve3(a,mid,b);
    const rope=new THREE.Mesh(new THREE.TubeGeometry(curve,10,.024,6),ropeM);
    rope.castShadow=true; scene.add(rope);
    for(const t of [.3,.7]){
      const p=curve.getPoint(t);
      const sh=new THREE.Mesh(new THREE.PlaneGeometry(.055,.16),paperM);
      sh.position.set(p.x,p.y-.1,p.z); sh.rotation.y=rand(0,6.28); sh.rotation.z=rand(-.15,.15);
      scene.add(sh);
    }
  }
})();

/* torii gate on the treeline */
(function buildTorii(){
  const vermil=stdMat(0x47201a,{roughness:.8});
  const g=new THREE.Group();
  const p1=new THREE.Mesh(new THREE.CylinderGeometry(.17,.2,3.6,10),vermil); p1.position.set(-1.8,1.8,0);
  const p2=p1.clone(); p2.position.x=1.8;
  const kasagi=new THREE.Mesh(new THREE.BoxGeometry(5.4,.3,.36),vermil); kasagi.position.y=3.75;
  const shimaki=new THREE.Mesh(new THREE.BoxGeometry(4.9,.16,.3),vermil); shimaki.position.y=3.5;
  const nuki=new THREE.Mesh(new THREE.BoxGeometry(4.4,.2,.24),vermil); nuki.position.y=2.85;
  const snowcap=new THREE.Mesh(new THREE.BoxGeometry(5.44,.07,.4),stdMat(0xdfe4e8,{roughness:.9}));
  snowcap.position.y=3.94;
  g.add(p1,p2,kasagi,shimaki,nuki,snowcap);
  g.traverse(o=>{ if(o.isMesh)o.castShadow=true; });
  g.position.set(0,0,-11.5); scene.add(g);
})();

/* treeline silhouettes */
(function trees(){
  const g=new THREE.Group();
  const mat=new THREE.MeshBasicMaterial({color:SRGB(0x0a0c10)});
  const snowM=stdMat(0xc7cdd3,{roughness:1});
  for(let i=0;i<80;i++){
    const a=rand(0,Math.PI*2), r=rand(20,44), h=rand(4,10);
    const t=new THREE.Mesh(new THREE.ConeGeometry(rand(.9,2),h,6),mat);
    t.position.set(Math.cos(a)*r,h/2,Math.sin(a)*r);
    const cap=new THREE.Mesh(new THREE.ConeGeometry(rand(.4,.8),h*.2,6),snowM);
    cap.position.set(t.position.x,h*.92,t.position.z);
    g.add(t,cap);
  }
  scene.add(g);
})();

/* moon with halo */
(function moondisc(){
  const glow=canTex(128,128,(ctx,w,h)=>{
    const g=ctx.createRadialGradient(w/2,h/2,4,w/2,h/2,w/2);
    g.addColorStop(0,'rgba(240,246,255,1)'); g.addColorStop(.25,'rgba(230,238,250,.9)');
    g.addColorStop(.5,'rgba(190,205,230,.25)'); g.addColorStop(1,'rgba(160,180,220,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  });
  const m=new THREE.Mesh(new THREE.PlaneGeometry(14,14),
    new THREE.MeshBasicMaterial({map:glow||null,color:glow?0xffffff:SRGB(0xe8edf4).getHex(),
      fog:false,transparent:true,opacity:.95,depthWrite:false}));
  m.position.set(-26,22,-48); m.lookAt(0,2,0); scene.add(m);
})();

/* drifting mist */
const mists=[];
(function buildMist(){
  const tex=canTex(256,64,(ctx,w,h)=>{
    const g=ctx.createRadialGradient(w/2,h/2,4,w/2,h/2,w/2);
    g.addColorStop(0,'rgba(205,215,228,.5)'); g.addColorStop(.6,'rgba(200,210,224,.18)');
    g.addColorStop(1,'rgba(200,210,224,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  });
  if(!tex)return;
  for(let i=0;i<6;i++){
    const m=new THREE.Mesh(new THREE.PlaneGeometry(rand(8,13),rand(2,3.4)),
      new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:rand(.25,.45),
        depthWrite:false,fog:true}));
    m.position.set(rand(-12,12),rand(.4,1.5),rand(-10,8));
    scene.add(m); mists.push({mesh:m,v:rand(.06,.2)*(Math.random()<.5?-1:1)});
  }
})();

/* falling snow — two depth layers, soft sprites */
const snowSprite=canTex(64,64,(ctx,w,h)=>{
  const g=ctx.createRadialGradient(w/2,h/2,1,w/2,h/2,w/2);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(.5,'rgba(255,255,255,.5)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
});
const SNOWS=[];
function snowLayer(n,area,size,speed){
  const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(n*3);
  for(let i=0;i<n;i++){ pos[i*3]=rand(-area,area); pos[i*3+1]=rand(0,15); pos[i*3+2]=rand(-area,area); }
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  const mat=new THREE.PointsMaterial({size,transparent:true,opacity:.85,depthWrite:false});
  if(snowSprite)mat.map=snowSprite; else mat.color=SRGB(0xe6eaee);
  const pts=new THREE.Points(geo,mat); pts.frustumCulled=false; scene.add(pts);
  const drift=new Float32Array(n); for(let i=0;i<n;i++)drift[i]=rand(0,6.28);
  SNOWS.push({geo,n,area,speed,drift});
}
snowLayer(900,16,.075,.55);
snowLayer(1100,28,.04,.42);

/* ------------------------- blood visuals pools ------------------------- */
const bloodStains=[]; const allStains=[]; let stainCount=0;
const stainTex=canTex(128,128,(ctx,w,h)=>{
  const g=ctx.createRadialGradient(w/2,h/2,2,w/2,h/2,w/2);
  g.addColorStop(0,'rgba(122,15,15,.95)'); g.addColorStop(.65,'rgba(105,12,12,.75)');
  g.addColorStop(1,'rgba(90,10,10,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
});
const stainMat=stainTex
  ?new THREE.MeshBasicMaterial({map:stainTex,transparent:true,depthWrite:false})
  :new THREE.MeshBasicMaterial({color:SRGB(0x6e1010).getHex(),transparent:true,opacity:.85,depthWrite:false});
function addStain(x,z,r){
  if(stainCount>300)return;
  stainCount++;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(r*2.4,r*2.4),stainMat);
  m.rotation.x=-Math.PI/2; m.position.set(x,0.006+stainCount*0.00002,z);
  m.rotation.z=rand(0,6.28); m.scale.x=rand(.7,1.5);
  scene.add(m); allStains.push(m);
}
function addPool(x,z){
  const mat=stainTex
    ?new THREE.MeshBasicMaterial({map:stainTex,transparent:true,depthWrite:false,color:SRGB(0xb15050).getHex()})
    :new THREE.MeshBasicMaterial({color:SRGB(0x5c0d0d).getHex(),transparent:true,opacity:.92,depthWrite:false});
  const m=new THREE.Mesh(new THREE.PlaneGeometry(2.6,2.6),mat);
  m.rotation.x=-Math.PI/2; m.position.set(x,.007,z); m.scale.set(.01,.01,.01);
  scene.add(m); const p={mesh:m,r:.01}; bloodStains.push(p); return p;
}

/* blood spray particles */
const SPRAY_N=1000;
const sprayGeo=new THREE.BufferGeometry();
const sprayPos=new Float32Array(SPRAY_N*3);
for(let i=0;i<SPRAY_N;i++)sprayPos[i*3+1]=-99;
sprayGeo.setAttribute('position',new THREE.BufferAttribute(sprayPos,3));
const sprayMat=new THREE.PointsMaterial({color:SRGB(0xa31414).getHex(),size:.045,transparent:true,opacity:.95,depthWrite:false});
if(snowSprite)sprayMat.map=snowSprite;
const sprayPts=new THREE.Points(sprayGeo,sprayMat);
sprayPts.frustumCulled=false; scene.add(sprayPts);
const sprayVel=new Float32Array(SPRAY_N*3), sprayLife=new Float32Array(SPRAY_N);
let sprayHead=0;
function emitBlood(p,dir,speed,n){
  for(let i=0;i<n;i++){
    const k=sprayHead=(sprayHead+1)%SPRAY_N;
    sprayPos[k*3]=p.x; sprayPos[k*3+1]=p.y; sprayPos[k*3+2]=p.z;
    sprayVel[k*3]  =dir.x*speed*rand(.4,1.1)+rand(-.6,.6);
    sprayVel[k*3+1]=dir.y*speed*rand(.4,1.1)+rand(.2,1.2);
    sprayVel[k*3+2]=dir.z*speed*rand(.4,1.1)+rand(-.6,.6);
    sprayLife[k]=rand(.5,1.1);
  }
}
function updateBloodFX(dt){
  for(let k=0;k<SPRAY_N;k++){
    if(sprayLife[k]<=0){ continue; }
    sprayLife[k]-=dt;
    sprayVel[k*3+1]-=9.81*dt;
    sprayPos[k*3]+=sprayVel[k*3]*dt; sprayPos[k*3+1]+=sprayVel[k*3+1]*dt; sprayPos[k*3+2]+=sprayVel[k*3+2]*dt;
    if(sprayPos[k*3+1]<=0.01){
      if(Math.random()<.18)addStain(sprayPos[k*3],sprayPos[k*3+2],rand(.04,.12));
      sprayLife[k]=0; sprayPos[k*3+1]=-99;
    }
  }
  sprayGeo.attributes.position.needsUpdate=true;
  for(const p of bloodStains){ p.mesh.scale.set(p.r,p.r,p.r); }
}

/* =========================================================================
   ANATOMY — the health bar is the body.
   Depths in cm from skin surface. Energy in joules of effective cut energy.
   A katana cut at full commitment delivers roughly 80–130 J at the edge;
   tissue thresholds are tuned around published tameshigiri / ballistic data.
   ========================================================================= */
const ANATOMY={
  head:{ label:'head', r:.105,
    layers:[
      {at:.4,  name:'scalp opened',                  effect:'bleedMinor'},
      {at:.9,  name:'skull cleaved — the brain',     effect:'mortal', bone:170, blunt:'concussion'},
    ]},
  neck:{ label:'neck', r:.062,
    layers:[
      {at:.3,  name:'neck grazed',                   effect:'bleedMinor'},
      {at:1.4, name:'carotid artery severed',        effect:'artery', rate:75},
      {at:2.2, name:'windpipe opened',               effect:'airway'},
      {at:3.8, name:'the neck — through the spine',  effect:'mortal', bone:200},
    ]},
  chest:{ label:'chest', r:.17,
    layers:[
      {at:.6,  name:'chest laid open',               effect:'bleedMinor'},
      {at:2.2, name:'ribs split',                    effect:'ribs', bone:160, blunt:'winded'},
      {at:4.2, name:'lung pierced',                  effect:'lung', rate:14},
      {at:5.5, name:'the heart',                     effect:'heart'},
    ]},
  abdomen:{ label:'belly', r:.155,
    layers:[
      {at:.5,  name:'belly cut',                     effect:'bleedMinor'},
      {at:2.5, name:'deep abdominal wound',          effect:'gut', rate:6},
      {at:4.5, name:'liver opened — deep hemorrhage',effect:'artery', rate:22},
    ]},
  upperArmR:{ label:'sword arm', r:.052, limb:'armR',
    layers:[
      {at:.4,  name:'sword arm gashed',              effect:'bleedMinor'},
      {at:1.8, name:'brachial artery severed',       effect:'artery', rate:26},
      {at:2.9, name:'sword arm broken at the bone',  effect:'disableArmR', bone:150, sever:230},
    ]},
  upperArmL:{ label:'off arm', r:.052, limb:'armL',
    layers:[
      {at:.4,  name:'left arm gashed',               effect:'bleedMinor'},
      {at:1.8, name:'brachial artery severed',       effect:'artery', rate:26},
      {at:2.9, name:'left arm broken at the bone',   effect:'disableArmL', bone:150, sever:230},
    ]},
  forearmR:{ label:'sword wrist', r:.042, limb:'armR',
    layers:[
      {at:.3,  name:'wrist cut',                     effect:'bleedMinor'},
      {at:1.0, name:'grip tendons severed — the sword falls', effect:'dropSword'},
      {at:2.0, name:'forearm taken at the bone',     effect:'severArmR', bone:120, sever:170},
    ]},
  forearmL:{ label:'off wrist', r:.042, limb:'armL',
    layers:[
      {at:.3,  name:'left wrist cut',                effect:'bleedMinor'},
      {at:1.0, name:'left hand tendons severed',     effect:'disableArmL'},
      {at:2.0, name:'left forearm taken at the bone',effect:'severArmL', bone:120, sever:170},
    ]},
  thighR:{ label:'right thigh', r:.082, limb:'legR',
    layers:[
      {at:.5,  name:'thigh cut',                     effect:'bleedMinor'},
      {at:2.8, name:'femoral artery severed',        effect:'arteryLeg', rate:42, limb:'legR'},
      {at:4.6, name:'thigh bone split — the leg gives', effect:'disableLegR', bone:240},
    ]},
  thighL:{ label:'left thigh', r:.082, limb:'legL',
    layers:[
      {at:.5,  name:'thigh cut',                     effect:'bleedMinor'},
      {at:2.8, name:'femoral artery severed',        effect:'arteryLeg', rate:42, limb:'legL'},
      {at:4.6, name:'thigh bone split — the leg gives', effect:'disableLegL', bone:240},
    ]},
  shinR:{ label:'right shin', r:.055, limb:'legR',
    layers:[
      {at:.3,  name:'shin cut',                      effect:'bleedMinor'},
      {at:1.6, name:'shin bone cracked — the leg gives', effect:'disableLegR', bone:170},
    ]},
  shinL:{ label:'left shin', r:.055, limb:'legL',
    layers:[
      {at:.3,  name:'shin cut',                      effect:'bleedMinor'},
      {at:1.6, name:'shin bone cracked — the leg gives', effect:'disableLegL', bone:170},
    ]},
};

/* energy → depth. skin+muscle resist ~14 J/cm of cut; thrusts concentrate
   force at the point (×1.8 penetration), bone gates deeper progress. */
function cutDepth(energy,alignment,isThrust,layers){
  let eff=energy*(isThrust?1.0:Math.pow(alignment,1.6));
  if(isThrust)eff*=1.8;
  let depth=eff/14; // cm
  for(const L of layers){
    if(L.bone && depth>=L.at){
      // bone gate: must pay its toll or stop at the bone.
      // a thrust concentrates force at the point and slips between ribs — half toll.
      const toll=isThrust?L.bone*.5:L.bone;
      if(eff < toll) depth=Math.min(depth,L.at-.05);
    }
  }
  return depth;
}


/* =========================================================================
   FIGHTER — articulated body, procedural pose, physiology, ragdoll
   ========================================================================= */
const BLOOD_TOTAL=5000;           // ml
const UNCONSCIOUS_AT=.62;         // fraction of blood remaining → lights out
const DEAD_AT=.48;

/* tapered limb: joint sphere at the pivot, shaft, condyle at the far end */
function limbMesh(len,rTop,rBot,mat){
  const g=new THREE.Group();
  const cyl=new THREE.Mesh(new THREE.CylinderGeometry(rTop,rBot,len,12),mat);
  cyl.position.y=-len/2; cyl.castShadow=true;
  const j=new THREE.Mesh(new THREE.SphereGeometry(rTop*1.06,10,8),mat); j.castShadow=true;
  const e=new THREE.Mesh(new THREE.SphereGeometry(rBot,10,8),mat); e.position.y=-len; e.castShadow=true;
  g.add(cyl,j,e); g.userData.len=len; g.userData.r=Math.max(rTop,rBot);
  return g;
}

function katanaMesh(){
  const g=new THREE.Group();
  const steel=stdMat(0xb9c4cf,{metalness:1,roughness:.28});
  const hamon=stdMat(0xe9eff5,{metalness:.9,roughness:.14});
  const lacquer=stdMat(0x14111a,{roughness:.32,metalness:.25});
  const wrap=stdMat(0x22252d,{roughness:.85});
  const brass=stdMat(0x8f7442,{metalness:1,roughness:.4});
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(.0135,.0155,.25,10),wrap);
  grip.castShadow=true; g.add(grip);
  for(let i=0;i<4;i++){ // ito wrap crossings
    const t=new THREE.Mesh(new THREE.TorusGeometry(.0148,.0032,6,10),lacquer);
    t.rotation.x=Math.PI/2; t.position.y=-.09+i*.06; g.add(t);
  }
  const kashira=new THREE.Mesh(new THREE.SphereGeometry(.016,8,6),lacquer);
  kashira.position.y=-.125; kashira.scale.y=.6; g.add(kashira);
  const tsuba=new THREE.Mesh(new THREE.CylinderGeometry(.042,.042,.009,14),lacquer);
  tsuba.position.y=.13; g.add(tsuba);
  const habaki=new THREE.Mesh(new THREE.CylinderGeometry(.012,.014,.03,8),brass);
  habaki.position.y=.152; g.add(habaki);
  /* curved blade: chained segments with sori, hamon edge line facing +Z */
  let parent=new THREE.Group(); parent.position.y=.165; g.add(parent);
  const segL=.185;
  for(let i=0;i<4;i++){
    const seg=new THREE.Group(); seg.rotation.x=-.03;
    const body=new THREE.Mesh(new THREE.BoxGeometry(.0068,segL,.024),steel);
    body.position.y=segL/2; body.castShadow=true;
    const edge=new THREE.Mesh(new THREE.BoxGeometry(.0045,segL,.008),hamon);
    edge.position.set(0,segL/2,.0135);
    seg.add(body,edge); parent.add(seg);
    const next=new THREE.Group(); next.position.y=segL; seg.add(next); parent=next;
  }
  const kiss=new THREE.Mesh(new THREE.ConeGeometry(.013,.05,6),steel);
  kiss.scale.x=.4; kiss.position.y=.024; parent.add(kiss);
  return g;
}

/* two-bone analytic IK: shoulder S fixed, reach target T, lengths l1,l2. */
function solveIK(S,T,l1,l2,bendDir,out){
  const d=TMP1.subVectors(T,S); let L=d.length();
  L=clamp(L,Math.abs(l1-l2)+.01,l1+l2-.005);
  d.normalize();
  const a=(l1*l1-l2*l2+L*L)/(2*L);
  const h=Math.sqrt(Math.max(0,l1*l1-a*a));
  const mid=TMP2.copy(S).addScaledVector(d,a);
  const side=TMP3.copy(bendDir).addScaledVector(d,-bendDir.dot(d)).normalize();
  out.copy(mid).addScaledVector(side,h);
  return out;
}

const UPV=V3(0,-1,0), UPY=V3(0,1,0);
function aimLimb(g,from,to){
  g.position.copy(from);
  TMP1.subVectors(to,from).normalize();
  g.quaternion.setFromUnitVectors(UPV,TMP1);
}

class Fighter{
  constructor(name,palette,x,facing,isPlayer){
    this.name=name; this.isPlayer=isPlayer;
    this.pos=V3(x,0,0); this.vel=V3();
    this.facing=facing;
    this.dead=false; this.downed=false; this.deathCause=null;

    /* physiology */
    this.blood=BLOOD_TOTAL; this.bleedRate=0;
    this.consciousness=100; this.stamina=100; this.pain=0; this.stun=0;
    this.wounds=[];
    this.disabled={armR:false,armL:false,legR:false,legL:false};
    this.severed={armR:false,armL:false};
    this.hasSword=true; this.airway=false; this.lungHit=false; this.heartHit=false;
    this.heartTimer=0; this.pulseT=0;
    this.pool=null;

    /* sword dynamics */
    this.tip=V3(x-facing*.5,1.2,.3);
    this.tipVel=V3();
    this.tipTarget=V3().copy(this.tip);
    this.prevBladeA=V3(); this.prevBladeB=V3();
    this.bladeSpeed=0; this.alignment=1; this.thrust=false; this.guarding=false;
    this.lastWhoosh=0;

    /* articulation state */
    this.bodyYaw=facing>0?Math.PI/2:-Math.PI/2;
    this.twist=0;
    this.flinch=V3(); this.flinchV=V3();
    this.atRope=false;

    /* materials */
    const kimono=stdMat(palette.kimono,{roughness:.88});
    const hakama=stdMat(palette.hakama,{roughness:.92});
    const skin=stdMat(palette.skin,{roughness:.65});
    const hairM=stdMat(0x14110d,{roughness:.9});
    const obiM=stdMat(palette.obi,{roughness:.8});
    const accentM=stdMat(palette.accent,{roughness:.75});
    this.kimonoMat=kimono;
    this.baseKimono=SRGB(palette.kimono);
    this.bloodTint=SRGB(0x35090b);

    const D=this.dims={
      torso:.5,pelvisY:.9,
      upperArm:.29,foreArm:.27,
      thigh:.44,shin:.40,
      headR:.1,neck:.085,
    };

    this.root=new THREE.Group(); scene.add(this.root);
    const parts=this.parts={};

    /* pelvis group: hips, obi knot, hakama skirt panels, saya */
    parts.pelvis=new THREE.Group();
    { const hip=new THREE.Mesh(new THREE.CylinderGeometry(.14,.15,.15,12),kimono);
      hip.castShadow=true;
      const obi=new THREE.Mesh(new THREE.TorusGeometry(.15,.032,8,18),obiM);
      obi.rotation.x=Math.PI/2; obi.position.y=.09;
      const knot=new THREE.Mesh(new THREE.BoxGeometry(.1,.05,.06),obiM);
      knot.position.set(0,.09,-.15);
      const skirtF=new THREE.Mesh(
        new THREE.CylinderGeometry(.165,.28,.36,12,1,true,-Math.PI*.42,Math.PI*.84),hakama);
      skirtF.position.y=-.2; skirtF.castShadow=true; hakama.side=THREE.DoubleSide;
      const skirtB=new THREE.Mesh(
        new THREE.CylinderGeometry(.165,.28,.36,12,1,true,Math.PI*.58,Math.PI*.84),hakama);
      skirtB.position.y=-.2; skirtB.castShadow=true;
      const saya=new THREE.Mesh(new THREE.CylinderGeometry(.02,.024,.76,8),
        stdMat(0x191420,{roughness:.3,metalness:.3}));
      saya.position.set(-.14,-.06,-.06); saya.rotation.z=1.25; saya.rotation.y=.4;
      parts.pelvis.add(hip,obi,knot,skirtF,skirtB,saya);
      this.skirtF=skirtF; this.skirtB=skirtB;
    }
    /* torso: chest broad at the shoulders, abdomen beneath */
    parts.chest=limbMesh(D.torso*.62,.155,.13,kimono);
    { const yokeR=new THREE.Mesh(new THREE.SphereGeometry(.075,10,8),kimono);
      yokeR.position.set(.155,-.02,0); yokeR.castShadow=true;
      const yokeL=yokeR.clone(); yokeL.position.x=-.155;
      const collar=new THREE.Mesh(new THREE.TorusGeometry(.075,.02,6,14),accentM);
      collar.rotation.x=Math.PI/2-.35; collar.position.set(0,-.02,.02);
      parts.chest.add(yokeR,yokeL,collar); }
    parts.abdomen=limbMesh(D.torso*.38,.125,.135,kimono);
    parts.neck=limbMesh(D.neck,.043,.05,skin);
    /* head: skull, jaw, hair, topknot; player wears a hachimaki */
    parts.head=new THREE.Group();
    { const skull=new THREE.Mesh(new THREE.SphereGeometry(D.headR,16,14),skin);
      skull.castShadow=true; skull.scale.set(.92,1.06,1);
      const jaw=new THREE.Mesh(new THREE.SphereGeometry(D.headR*.7,10,8),skin);
      jaw.position.set(0,-.06,.03); jaw.scale.set(.82,.7,.9);
      const hairC=new THREE.Mesh(
        new THREE.SphereGeometry(D.headR*1.04,14,12,0,Math.PI*2,0,1.6),hairM);
      hairC.scale.set(.94,1.06,1); hairC.rotation.x=-.5;
      const mage=new THREE.Mesh(new THREE.CylinderGeometry(.015,.02,.09,8),hairM);
      mage.position.set(0,.095,-.02); mage.rotation.x=1.1;
      parts.head.add(skull,jaw,hairC,mage);
      if(isPlayer){
        const hachi=new THREE.Mesh(new THREE.TorusGeometry(D.headR*.94,.014,6,16),accentM);
        hachi.rotation.x=Math.PI/2+.12; hachi.position.y=.028;
        parts.head.add(hachi);
      }
    }
    /* arms: kimono sleeve flares on the upper arm, bare forearm */
    parts.upperArmR=limbMesh(D.upperArm,.052,.075,kimono);
    parts.upperArmL=limbMesh(D.upperArm,.052,.075,kimono);
    parts.forearmR=limbMesh(D.foreArm,.045,.038,skin);
    parts.forearmL=limbMesh(D.foreArm,.045,.038,skin);
    parts.handR=new THREE.Mesh(new THREE.SphereGeometry(.037,8,7),skin);
    parts.handR.scale.set(.8,1.15,.9); parts.handR.castShadow=true;
    parts.handL=parts.handR.clone();
    /* legs: hakama — wide at the knee, gathered at the ankle */
    parts.thighR=limbMesh(D.thigh,.1,.14,hakama);
    parts.thighL=limbMesh(D.thigh,.1,.14,hakama);
    parts.shinR=limbMesh(D.shin,.135,.055,hakama);
    parts.shinL=limbMesh(D.shin,.135,.055,hakama);
    /* tabi feet */
    const footGeo=new THREE.BoxGeometry(.085,.05,.21);
    const tabiM=stdMat(0xd9d5cb,{roughness:.85});
    parts.footR=new THREE.Mesh(footGeo,tabiM); parts.footR.castShadow=true;
    parts.footL=new THREE.Mesh(footGeo,tabiM); parts.footL.castShadow=true;
    for(const k in parts)this.root.add(parts[k]);

    this.katana=katanaMesh(); scene.add(this.katana);

    /* sword trail ribbon */
    this.trailN=16; this.trailSamples=[];
    { const N=this.trailN;
      const tg=new THREE.BufferGeometry();
      this.trailPos=new Float32Array(N*2*3);
      this.trailCol=new Float32Array(N*2*3);
      const idx=[];
      for(let i=0;i<N-1;i++){ const a=i*2;
        idx.push(a,a+1,a+2, a+1,a+3,a+2); }
      tg.setIndex(idx);
      tg.setAttribute('position',new THREE.BufferAttribute(this.trailPos,3));
      tg.setAttribute('color',new THREE.BufferAttribute(this.trailCol,3));
      this.trailMesh=new THREE.Mesh(tg,new THREE.MeshBasicMaterial({
        vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,
        depthWrite:false,side:THREE.DoubleSide}));
      this.trailMesh.frustumCulled=false;
      scene.add(this.trailMesh);
    }

    /* stepping feet state */
    const fw=DIRY(this.bodyYaw), rt=V3(fw.z,0,-fw.x);
    const mkFoot=(side,fwdOff)=>({
      p:this.pos.clone().addScaledVector(rt,side*.17).addScaledVector(fw,fwdOff),
      from:V3(),to:V3(),swing:0,dur:.18,lift:0});
    this.feet={R:mkFoot(1,.20),L:mkFoot(-1,-.16)};

    this.capsules={};
    for(const k in ANATOMY)this.capsules[k]={a:V3(),b:V3(),r:ANATOMY[k].r};

    this.gait=0; this.breath=rand(0,6);
    this.hitCooldown={};
    this.ragdoll=null;
  }

  get alive(){ return !this.dead && !this.downed; }
  get bloodFrac(){ return this.blood/BLOOD_TOTAL; }

  trailPush(a,b,s){
    this.trailSamples.push({a:a?a.clone():null,b:b?b.clone():null,s});
    if(this.trailSamples.length>this.trailN)this.trailSamples.shift();
    const N=this.trailN, S=this.trailSamples;
    let lastA=null,lastB=null;
    for(const smp of S){ if(smp.a){ lastA=smp.a; lastB=smp.b; } }
    for(let i=0;i<N;i++){
      const smp=S[Math.max(0,S.length-N+i)]||{a:null,s:0};
      const A=smp.a||lastA, B=smp.b||lastB;
      const k=i*2*3;
      if(!A){ this.trailPos[k+1]=-99; this.trailPos[k+4]=-99; continue; }
      this.trailPos[k]=A.x; this.trailPos[k+1]=A.y; this.trailPos[k+2]=A.z;
      this.trailPos[k+3]=B.x; this.trailPos[k+4]=B.y; this.trailPos[k+5]=B.z;
      const inten=(smp.a?smp.s:0)*Math.pow(i/(N-1),1.6)*.85;
      this.trailCol[k]=inten*.72; this.trailCol[k+1]=inten*.82; this.trailCol[k+2]=inten;
      this.trailCol[k+3]=inten*.72; this.trailCol[k+4]=inten*.82; this.trailCol[k+5]=inten;
    }
    this.trailMesh.geometry.attributes.position.needsUpdate=true;
    this.trailMesh.geometry.attributes.color.needsUpdate=true;
  }


  /* ------------------------- physiology tick ------------------------- */
  updatePhysiology(dt,log){
    if(this.dead)return;
    /* blood soaks the kimono as volume is lost */
    if(this.kimonoMat&&this.baseKimono){
      const s=clamp((1-this.bloodFrac)*1.7,0,.8);
      this.kimonoMat.color.copy(this.baseKimono).lerp(this.bloodTint,s);
    }
    this.pulseT+=dt;
    /* hemorrhage scales with blood pressure (remaining volume) */
    if(this.bleedRate>0){
      const bp=clamp((this.bloodFrac-.3)/.7,0.15,1);
      this.blood-=this.bleedRate*bp*dt;
    }
    if(this.airway)this.stamina-=8*dt;
    if(this.lungHit)this.stamina-=4*dt;
    this.pain=Math.max(0,this.pain-3.5*dt);
    this.stun=Math.max(0,this.stun-dt);
    this.stamina=clamp(this.stamina+(this.lungHit?2:6)*dt,0,100);

    /* consciousness */
    let target=100;
    if(this.bloodFrac<UNCONSCIOUS_AT+.15)
      target=clamp((this.bloodFrac-DEAD_AT)/(UNCONSCIOUS_AT+.15-DEAD_AT),0,1)*100;
    if(this.heartHit){ this.heartTimer-=dt; target=Math.min(target,this.heartTimer/7*100); }
    this.consciousness=Math.min(this.consciousness, Math.max(target, 0));
    this.consciousness=lerp(this.consciousness,target,dt*.8);

    if(this.consciousness<=6 || this.bloodFrac<=DEAD_AT){
      this.collapse(log);
    }
  }

  collapse(log){
    if(this.dead)return;
    this.dead=true;
    const mortal=this.wounds.find(w=>w.severity==='mortal');
    this.deathCause=mortal?mortal.name:
      (this.bloodFrac<.65?'exsanguination — bled white into the snow':'shock');
    this.buildRagdoll();
    Sound.thump();
    if(!this.pool)this.pool=addPool(this.pos.x,this.pos.z);
    log(this.name+' falls.', true);
  }

  /* ------------------------------ wounds ----------------------------- */
  applyCut(partKey,energy,alignment,isThrust,hitPoint,hitDir,log){
    const A=ANATOMY[partKey]; if(!A)return null;
    const now=performance.now();
    if(this.hitCooldown[partKey]&&now-this.hitCooldown[partKey]<380)return null;
    this.hitCooldown[partKey]=now;

    const depth=cutDepth(energy,alignment,isThrust,A.layers);
    /* flat-of-blade / weak hit → blunt trauma only */
    if(depth<A.layers[0].at){
      if(energy>26){
        this.pain+=10; this.stun=Math.max(this.stun,.15);
        log('a flat blow glances off '+this.name+"'s "+A.label,false);
        return 'blunt';
      }
      return null;
    }

    let deepest=null;
    for(const L of A.layers){
      if(depth>=L.at){
        /* bone gate for effects that require the bone to break */
        const eff=energy*(isThrust?1.8:Math.pow(alignment,1.6));
        if(L.bone && eff<(isThrust?L.bone*.5:L.bone)){
          if(L.blunt&&energy>90){ this.applyEffect({effect:L.blunt},partKey,hitPoint,hitDir,energy,log); }
          continue;
        }
        deepest=L;
        this.applyEffect(L,partKey,hitPoint,hitDir,energy,log);
      }
    }
    if(deepest){
      Sound.cut(depth);
      emitBlood(hitPoint,hitDir,clamp(energy/40,1,4),Math.floor(clamp(depth*4,4,26)));
      this.pain+=depth*4;
      if(!this.pool && this.bleedRate>10)this.pool=addPool(this.pos.x,this.pos.z);
    }
    return deepest;
  }

  applyEffect(L,partKey,hitPoint,hitDir,energy,log){
    const sevMap={mortal:'mortal',heart:'mortal',artery:'severe',arteryLeg:'severe',
      airway:'severe',lung:'severe',gut:'moderate',ribs:'moderate',
      dropSword:'severe',severArmR:'severe',severArmL:'severe',
      disableArmR:'severe',disableArmL:'severe',disableLegR:'severe',disableLegL:'severe',
      bleedMinor:'minor',concussion:'moderate',winded:'minor'};
    const sev=sevMap[L.effect]||'minor';
    if(L.name && !this.wounds.some(w=>w.name===L.name)){
      this.wounds.push({part:partKey,name:L.name,severity:sev});
      log(this.name+' — '+L.name, sev==='mortal');
    }
    switch(L.effect){
      case 'bleedMinor': this.bleedRate+=2; break;
      case 'artery': this.bleedRate+=L.rate; this.arterialWound={part:partKey}; break;
      case 'arteryLeg': this.bleedRate+=L.rate; this.disabled[L.limb]=true; this.arterialWound={part:partKey}; break;
      case 'lung': this.lungHit=true; this.bleedRate+=L.rate; break;
      case 'gut': this.bleedRate+=L.rate; this.pain+=35; break;
      case 'ribs': this.bleedRate+=3; this.pain+=20; break;
      case 'airway': this.airway=true; this.bleedRate+=4; break;
      case 'heart': this.heartHit=true; this.heartTimer=rand(4.5,8); this.bleedRate+=60; break;
      case 'mortal': this.consciousness=0; this.bleedRate+=40;
        this.collapse(log); break;
      case 'concussion': this.stun=Math.max(this.stun,1.4); this.pain+=25; break;
      case 'winded': this.stamina=Math.max(0,this.stamina-35); break;
      case 'dropSword': this.dropSword(log); this.disabled.armR=true; break;
      case 'disableArmR': this.disabled.armR=true; this.dropSword(log); this.bleedRate+=6; break;
      case 'disableArmL': this.disabled.armL=true; this.bleedRate+=6; break;
      case 'disableLegR': this.disabled.legR=true; this.bleedRate+=6; break;
      case 'disableLegL': this.disabled.legL=true; this.bleedRate+=6; break;
      case 'severArmR': this.severLimb('armR',hitPoint,hitDir,log); break;
      case 'severArmL': this.severLimb('armL',hitPoint,hitDir,log); break;
    }
  }

  dropSword(log){
    if(!this.hasSword)return;
    this.hasSword=false;
    scene.attach(this.katana);
    this.droppedSword={vel:V3(rand(-.5,.5),1.5,rand(-.5,.5)),spin:rand(-4,4)};
    log(this.name+"'s sword falls to the snow",false);
  }

  severLimb(limb,hitPoint,hitDir,log){
    if(this.severed[limb])return;
    this.severed[limb]=true; this.disabled[limb]=true;
    this.bleedRate+=30; this.pain+=60;
    const fore=limb==='armR'?this.parts.forearmR:this.parts.forearmL;
    const hand=limb==='armR'?this.parts.handR:this.parts.handL;
    scene.attach(fore); scene.attach(hand);
    hand.position.copy(fore.position);
    this.severedPieces=this.severedPieces||[];
    this.severedPieces.push({mesh:fore,vel:V3(hitDir.x*2+rand(-1,1),2.2,hitDir.z*2+rand(-1,1)),
      ang:V3(rand(-6,6),rand(-6,6),rand(-6,6))});
    this.severedPieces.push({mesh:hand,vel:V3(hitDir.x*2+rand(-1,1),2.4,hitDir.z*2+rand(-1,1)),
      ang:V3(rand(-6,6),rand(-6,6),rand(-6,6))});
    if(limb==='armR')this.dropSword(log);
    emitBlood(hitPoint,V3(0,1,0),3.5,30);
  }

  /* mobility multiplier from legs + blood + stamina */
  get mobility(){
    let m=1;
    if(this.disabled.legR)m*=.25;
    if(this.disabled.legL)m*=.25;
    m*=clamp((this.bloodFrac-.45)/.55,.25,1);
    m*=lerp(.55,1,this.stamina/100);
    if(this.stun>0)m*=.25;
    return m;
  }
  /* sword-control multiplier */
  get swordControl(){
    if(!this.hasSword)return 0;
    let m=1;
    if(this.disabled.armL)m*=.7;     // lost the off-hand: weaker cuts
    m*=clamp((this.bloodFrac-.4)/.6,.3,1);
    m*=lerp(.5,1,this.stamina/100);
    m*=lerp(1,.35,clamp(this.pain/100,0,1)*.7);
    if(this.stun>0)m*=.15;
    return m;
  }


  /* --------------------------- ragdoll ------------------------------- */
  buildRagdoll(){
    const P=this.parts, F=this.facing;
    const mk=(v)=>({p:v.clone(),pp:v.clone(),r:.06});
    const w=(g,end)=>{
      const off=V3(0,end?-(g.userData.len||0):0,0).applyQuaternion(g.quaternion);
      return g.position.clone().add(off); };
    const J=this.J={
      head:mk(P.head.position.clone()),
      neck:mk(w(P.neck,false)), chestT:mk(w(P.chest,false)), chestB:mk(w(P.chest,true)),
      pelvis:mk(w(P.pelvis,false)),
      shR:mk(w(P.upperArmR,false)), elR:mk(w(P.upperArmR,true)), haR:mk(w(P.forearmR,true)),
      shL:mk(w(P.upperArmL,false)), elL:mk(w(P.upperArmL,true)), haL:mk(w(P.forearmL,true)),
      hipR:mk(w(P.thighR,false)), knR:mk(w(P.thighR,true)), ftR:mk(w(P.shinR,true)),
      hipL:mk(w(P.thighL,false)), knL:mk(w(P.thighL,true)), ftL:mk(w(P.shinL,true)),
    };
    const imp=this.lastHitDir||V3(-F*1,0,0);
    for(const k in J){ J[k].pp.copy(J[k].p).addScaledVector(imp,-rand(.01,.03)); }
    const C=this.C=[];
    const link=(a,b)=>C.push({a:J[a],b:J[b],l:J[a].p.distanceTo(J[b].p)});
    link('head','neck'); link('neck','chestT'); link('chestT','chestB'); link('chestB','pelvis');
    link('chestT','shR'); link('chestT','shL'); link('shR','elR'); link('elR','haR');
    link('shL','elL'); link('elL','haL');
    link('pelvis','hipR'); link('pelvis','hipL'); link('hipR','knR'); link('knR','ftR');
    link('hipL','knL'); link('knL','ftL');
    link('shR','shL'); link('hipR','hipL'); link('head','chestT'); link('neck','shR'); link('neck','shL');
    link('pelvis','chestT'); link('hipR','chestB'); link('hipL','chestB');
    for(const k in P)scene.attach(P[k]);
    if(this.hasSword){ this.hasSword=false; scene.attach(this.katana);
      this.droppedSword={vel:V3(rand(-.4,.4),.8,rand(-.4,.4)),spin:rand(-3,3)}; }
    this.trailPush(null,null,0); this.trailMesh.visible=false;
    this.ragdoll=true;
  }

  updateRagdoll(dt){
    const J=this.J, C=this.C, damp=.985;
    for(const k in J){ const j=J[k];
      TMP1.subVectors(j.p,j.pp).multiplyScalar(damp);
      j.pp.copy(j.p); j.p.add(TMP1); j.p.y-=9.81*dt*dt*38;
      if(j.p.y<j.r){ j.p.y=j.r; j.pp.x=lerp(j.pp.x,j.p.x,.4); j.pp.z=lerp(j.pp.z,j.p.z,.4); }
    }
    for(let it=0;it<5;it++)for(const c of C){
      TMP1.subVectors(c.b.p,c.a.p); const d=TMP1.length()||1e-6;
      const corr=(d-c.l)/d*.5; c.a.p.addScaledVector(TMP1,corr); c.b.p.addScaledVector(TMP1,-corr);
    }
    const P=this.parts;
    const place=(g,a,b)=>{ aimLimb(g,J[a].p,J[b].p); };
    place(P.neck,'neck','chestT'); place(P.chest,'chestT','chestB'); place(P.abdomen,'chestB','pelvis');
    P.pelvis.position.copy(J.pelvis.p);
    P.head.position.copy(J.head.p);
    place(P.upperArmR,'shR','elR');
    if(!this.severed.armR){ place(P.forearmR,'elR','haR'); P.handR.position.copy(J.haR.p); }
    place(P.upperArmL,'shL','elL');
    if(!this.severed.armL){ place(P.forearmL,'elL','haL'); P.handL.position.copy(J.haL.p); }
    place(P.thighR,'hipR','knR'); place(P.shinR,'knR','ftR');
    place(P.thighL,'hipL','knL'); place(P.shinL,'knL','ftL');
    P.footR.position.copy(J.ftR.p); P.footL.position.copy(J.ftL.p);
    if(this.bleedRate>4&&this.blood>BLOOD_TOTAL*.3){
      this.blood-=this.bleedRate*.35*dt;
      if(this.pool){ this.pool.r=Math.min(1.6,this.pool.r+this.bleedRate*dt*.0012);
        this.pool.mesh.position.set(J.chestB.p.x,.007,J.chestB.p.z); }
      if(Math.random()<dt*6)emitBlood(J.neck.p,V3(0,.5,0),.8,2);
    }
  }
}


/* =========================================================================
   LIVING POSE — weight, steps, hip drive, spine twist, head tracking.
   The blade tip is a damped spring-mass chased toward an intent point;
   its momentum twists the hips and chest the way a real cut is hip-led.
   ========================================================================= */
Fighter.prototype.stepFoot=function(f,home,dt,otherPlanted,disabled,speed2d){
  const thresh=disabled?.34:.125;
  if(f.swing>0){
    f.swing=Math.min(1,f.swing+dt/f.dur);
    const t=f.swing, ss=t*t*(3-2*t);
    f.p.lerpVectors(f.from,f.to,ss);
    f.lift=disabled?0:Math.sin(Math.PI*t)*clamp(.05+speed2d*.02,.05,.09);
    if(f.swing>=1){ f.swing=0; f.lift=0; }
  } else {
    f.lift=0;
    if(otherPlanted && f.p.distanceTo(home)>thresh){
      f.swing=1e-4; f.from=f.p.clone();
      f.to=home.clone().addScaledVector(this.vel,.13); f.to.y=0;
      f.dur=(disabled?.34:clamp(.2-speed2d*.02,.13,.2))/Math.max(this.mobility,.35);
    }
  }
};

const _headQ=new THREE.Quaternion();
Fighter.prototype.updateAlive=function(dt,opponent){
  const D=this.dims,P=this.parts;
  this.breath+=dt;

  /* facing: the body turns with inertia, the eyes are instant */
  const toOpp=TMP1.subVectors(opponent.pos,this.pos); toOpp.y=0;
  this.yaw=Math.atan2(toOpp.x,toOpp.z);
  this.bodyYaw=lerpAngle(this.bodyYaw,this.yaw,clamp(dt*6*Math.max(this.mobility,.3),0,1));

  /* locomotion + separation + THE RING */
  this.pos.addScaledVector(this.vel,dt); this.pos.y=0;
  this.vel.multiplyScalar(Math.pow(.0008,dt));
  const sep=this.pos.distanceTo(opponent.pos);
  if(sep<.62){ TMP1.subVectors(this.pos,opponent.pos).setY(0).normalize();
    this.pos.addScaledVector(TMP1,(.62-sep)*.5); }
  { const rr=Math.hypot(this.pos.x,this.pos.z);
    if(rr>RING_R-.28){ const s=(RING_R-.28)/rr; this.pos.x*=s; this.pos.z*=s;
      TMP1.set(this.pos.x,0,this.pos.z).normalize();
      const vn=this.vel.dot(TMP1); if(vn>0)this.vel.addScaledVector(TMP1,-vn);
      this.atRope=true;
    } else this.atRope=false; }
  const speed2d=Math.hypot(this.vel.x,this.vel.z);

  const fwd=DIRY(this.bodyYaw), right=V3(fwd.z,0,-fwd.x);

  /* hip drive: lateral sword momentum rotates the trunk */
  const latV=this.tipVel.dot(right);
  this.twist=lerp(this.twist,clamp(latV*.045,-.55,.55),clamp(dt*9,0,1));

  /* ---- planted stepping feet ---- */
  const ft=this.feet;
  const homeR=this.pos.clone().addScaledVector(right,.17).addScaledVector(fwd,.20);
  const homeL=this.pos.clone().addScaledVector(right,-.17).addScaledVector(fwd,-.16);
  this.stepFoot(ft.R,homeR,dt,ft.L.swing===0,this.disabled.legR,speed2d);
  this.stepFoot(ft.L,homeL,dt,ft.R.swing===0,this.disabled.legL,speed2d);
  const stepping=ft.R.swing>0||ft.L.swing>0;

  /* pelvis rides between the feet — visible weight transfer */
  const feetMid=TMP2.addVectors(ft.R.p,ft.L.p).multiplyScalar(.5);
  const hurtSag=(this.disabled.legR?.15:0)+(this.disabled.legL?.15:0)
    +lerp(.1,0,clamp(this.bloodFrac,0,1));
  const pelvisY=D.pelvisY-hurtSag-(stepping?.02:0)+Math.sin(this.breath*1.6)*.007;
  const pelvis=V3(lerp(feetMid.x,this.pos.x,.55),pelvisY,lerp(feetMid.z,this.pos.z,.55));
  const pelvisYawA=this.bodyYaw+this.twist*.3;
  const fwdP=DIRY(pelvisYawA), rightP=V3(fwdP.z,0,-fwdP.x);

  /* flinch spring: hits ripple through the trunk */
  this.flinchV.addScaledVector(this.flinch,-140*dt).addScaledVector(this.flinchV,-12*dt);
  this.flinch.addScaledVector(this.flinchV,dt);

  /* spine: pelvis → abdomen → chest, distributing lean and twist */
  const lean=clamp(.05+this.tipVel.length()*.010+speed2d*.02,0,.16);
  const chestYawA=this.bodyYaw+this.twist*.8;
  const fwdC=DIRY(chestYawA), rightC=V3(fwdC.z,0,-fwdC.x);
  const chestB=pelvis.clone().addScaledVector(fwdP,.03+lean*.3)
    .addScaledVector(this.flinch,.6); chestB.y=pelvisY+.17;
  const chestT=chestB.clone().addScaledVector(fwdC,lean).add(this.flinch);
  chestT.y=chestB.y+D.torso*.62;
  const neckT=chestT.clone().addScaledVector(fwdC,.02); neckT.y=chestT.y+D.neck+.02;

  P.pelvis.position.copy(pelvis);
  P.pelvis.quaternion.setFromAxisAngle(UPY,pelvisYawA);
  /* hakama panels trail the motion */
  { const swayF=clamp(this.vel.dot(fwdP)*.22,-.3,.3), swayS=clamp(this.vel.dot(rightP)*.22,-.3,.3);
    const k=clamp(dt*6,0,1);
    this.skirtF.rotation.x=lerp(this.skirtF.rotation.x,-swayF+Math.sin(this.breath*1.2)*.02,k);
    this.skirtF.rotation.z=lerp(this.skirtF.rotation.z,swayS,k);
    this.skirtB.rotation.x=this.skirtF.rotation.x; this.skirtB.rotation.z=this.skirtF.rotation.z; }
  aimLimb(P.abdomen,chestB,pelvis);
  aimLimb(P.chest,chestT,chestB);
  aimLimb(P.neck,neckT,chestT);

  /* head tracks the opponent, clamped toward the chest's facing */
  const headPos=neckT.clone().addScaledVector(fwdC,.028)
    .addScaledVector(this.flinch,1.25);
  headPos.y=neckT.y+.085+this.flinch.y*1.25;
  P.head.position.copy(headPos);
  TMP3.copy(opponent.parts.head?opponent.parts.head.position:opponent.pos);
  if(TMP3.distanceToSquared(headPos)>.04){
    P.head.lookAt(TMP3);
    _headQ.setFromAxisAngle(UPY,chestYawA);
    P.head.quaternion.slerp(_headQ,.35);
  }

  /* ---- sword: spring-driven tip, two-handed grip ---- */
  const shR=chestT.clone().addScaledVector(rightC,.185).addScaledVector(fwdC,.01);
  shR.y=chestT.y-.045;
  const shL=chestT.clone().addScaledVector(rightC,-.185).addScaledVector(fwdC,.01);
  shL.y=chestT.y-.045;
  const ctrl=this.swordControl;
  if(this.hasSword){
    const K=this.thrust?150:110, DAMP=this.thrust?16:10.5;
    const skill=this.isPlayer?1:.85;
    const maxSpd=((this.thrust?11:14)*ctrl+2)*skill;
    TMP1.subVectors(this.tipTarget,this.tip);
    this.tipVel.addScaledVector(TMP1,K*dt*Math.max(ctrl,.15));
    this.tipVel.multiplyScalar(Math.pow(1/(1+DAMP),dt*3));
    if(this.tipVel.length()>maxSpd)this.tipVel.setLength(maxSpd);
    this.tip.addScaledVector(this.tipVel,dt);
    if(this.tip.y<.06){ this.tip.y=.06; if(this.tipVel.y<0)this.tipVel.y*=-.2; }
    const reachMax=D.upperArm+D.foreArm+.87;
    TMP1.subVectors(this.tip,shR);
    if(TMP1.length()>reachMax){ this.tip.copy(shR).addScaledVector(TMP1.normalize(),reachMax);
      this.tipVel.multiplyScalar(.5); }
    this.bladeSpeed=this.tipVel.length();

    /* edge alignment: how steadily the swing tracks one line */
    if(this.bladeSpeed>2){
      TMP1.copy(this.tipVel).normalize();
      if(!this._lastSwingDir)this._lastSwingDir=TMP1.clone();
      const dot=clamp(TMP1.dot(this._lastSwingDir),0,1);
      this.alignment=lerp(this.alignment,dot,clamp(dt*10,0,1));
      this._lastSwingDir.lerp(TMP1,clamp(dt*8,0,1)).normalize();
    } else { this.alignment=lerp(this.alignment,1,dt*2); this._lastSwingDir=null; }

    if(this.bladeSpeed>6.5 && performance.now()-this.lastWhoosh>260){
      Sound.whoosh(this.bladeSpeed); this.lastWhoosh=performance.now(); }

    const gripDir=TMP1.subVectors(this.tip,shR).normalize();
    const handle=shR.clone().addScaledVector(gripDir,clamp(shR.distanceTo(this.tip)-.87,.25,.52));
    const bladeDir=TMP2.subVectors(this.tip,handle).normalize();
    this.katana.position.copy(handle);
    this.katana.quaternion.setFromUnitVectors(UPY,bladeDir);
    /* keep previous segment for swept collision */
    if(this.bladeA){ this.prevBladeA.copy(this.bladeA); this.prevBladeB.copy(this.bladeB); this.hadPrev=true; }
    else this.hadPrev=false;
    this.bladeA=handle.clone().addScaledVector(bladeDir,.12);
    this.bladeB=handle.clone().addScaledVector(bladeDir,.93);

    /* arms: two-bone IK with anatomical elbow hints */
    const elR=V3(),elL=V3();
    const handR=handle.clone().addScaledVector(bladeDir,-.02);
    const handL=handle.clone().addScaledVector(bladeDir,.10);
    const hintR=rightC.clone().multiplyScalar(.85).addScaledVector(fwdC,-.3); hintR.y=-.55;
    solveIK(shR,handR,D.upperArm,D.foreArm,hintR,elR);
    aimLimb(P.upperArmR,shR,elR); aimLimb(P.forearmR,elR,handR);
    P.handR.position.copy(handR);
    P.handR.quaternion.copy(this.katana.quaternion);
    if(!this.disabled.armL&&!this.severed.armL){
      const hintL=rightC.clone().multiplyScalar(-.85).addScaledVector(fwdC,-.3); hintL.y=-.55;
      solveIK(shL,handL,D.upperArm,D.foreArm,hintL,elL);
      aimLimb(P.upperArmL,shL,elL); aimLimb(P.forearmL,elL,handL);
      P.handL.position.copy(handL);
      P.handL.quaternion.copy(this.katana.quaternion);
    } else this.hangArm('L',shL,rightC,P);
  } else {
    this.bladeA=null; this.bladeB=null; this.bladeSpeed=0;
    this.hangArm('R',shR,rightC,P);
    this.hangArm('L',shL,rightC,P);
  }

  /* ---- legs: IK from pelvis to the planted feet ---- */
  const hipR=pelvis.clone().addScaledVector(rightP,.10); hipR.y=pelvisY-.02;
  const hipL=pelvis.clone().addScaledVector(rightP,-.10); hipL.y=pelvisY-.02;
  const kneeHint=fwdP.clone(); kneeHint.y=-.15;
  const knR=V3(),knL=V3();
  const ankR=ft.R.p.clone(); ankR.y=.045+ft.R.lift;
  const ankL=ft.L.p.clone(); ankL.y=.045+ft.L.lift;
  solveIK(hipR,ankR,D.thigh,D.shin,kneeHint,knR);
  solveIK(hipL,ankL,D.thigh,D.shin,kneeHint,knL);
  aimLimb(P.thighR,hipR,knR); aimLimb(P.shinR,knR,ankR);
  aimLimb(P.thighL,hipL,knL); aimLimb(P.shinL,knL,ankL);
  P.footR.position.set(ft.R.p.x,.028+ft.R.lift,ft.R.p.z);
  P.footR.quaternion.setFromAxisAngle(UPY,this.bodyYaw);
  if(ft.R.swing>0)P.footR.rotateX(-.3*Math.sin(Math.PI*ft.R.swing));
  P.footL.position.set(ft.L.p.x,.028+ft.L.lift,ft.L.p.z);
  P.footL.quaternion.setFromAxisAngle(UPY,this.bodyYaw);
  if(ft.L.swing>0)P.footL.rotateX(-.3*Math.sin(Math.PI*ft.L.swing));

  /* trail sample */
  if(this.bladeA)this.trailPush(this.bladeA,this.bladeB,clamp((this.bladeSpeed*ctrl-4.5)/8,0,1));
  else this.trailPush(null,null,0);

  /* rebuild world capsules for hit detection */
  const C=this.capsules;
  const setCap=(k,a,b)=>{ C[k].a.copy(a); C[k].b.copy(b); };
  setCap('head',P.head.position,P.head.position.clone().setY(P.head.position.y+.02));
  setCap('neck',neckT,chestT);
  setCap('chest',chestT,chestB);
  setCap('abdomen',chestB,pelvis);
  const seg=(g)=>{ const a=g.position.clone();
    const b=a.clone().add(V3(0,-g.userData.len,0).applyQuaternion(g.quaternion)); return [a,b]; };
  let s;
  s=seg(P.upperArmR); setCap('upperArmR',s[0],s[1]);
  s=seg(P.upperArmL); setCap('upperArmL',s[0],s[1]);
  s=seg(P.forearmR); setCap('forearmR',s[0],s[1]);
  s=seg(P.forearmL); setCap('forearmL',s[0],s[1]);
  s=seg(P.thighR); setCap('thighR',s[0],s[1]);
  s=seg(P.thighL); setCap('thighL',s[0],s[1]);
  s=seg(P.shinR); setCap('shinR',s[0],s[1]);
  s=seg(P.shinL); setCap('shinL',s[0],s[1]);
};

Fighter.prototype.hangArm=function(side,sh,right,P){
  const D=this.dims;
  const dir=side==='R'?1:-1;
  const el=sh.clone().addScaledVector(right,dir*.06); el.y-=D.upperArm;
  const ha=el.clone(); ha.y-=D.foreArm;
  const ua=side==='R'?P.upperArmR:P.upperArmL, fa=side==='R'?P.forearmR:P.forearmL;
  aimLimb(ua,sh,el);
  if(!(this.severed['arm'+side])){ aimLimb(fa,el,ha);
    (side==='R'?P.handR:P.handL).position.copy(ha); }
};

/* ============================== INPUT ================================== */
const input={keys:{},mx:0,my:0,rmb:false,shift:false};
addEventListener('keydown',e=>{ input.keys[e.code]=true;
  if(e.code==='ShiftLeft'||e.code==='ShiftRight')input.shift=true;
  if(e.code==='KeyR'&&game.state!=='menu')restart(); });
addEventListener('keyup',e=>{ input.keys[e.code]=false;
  if(e.code==='ShiftLeft'||e.code==='ShiftRight')input.shift=false; });
addEventListener('mousemove',e=>{ input.mx=e.clientX/innerWidth*2-1; input.my=-(e.clientY/innerHeight*2-1); });
addEventListener('mousedown',e=>{ if(e.button===2)input.rmb=true; });
addEventListener('mouseup',e=>{ if(e.button===2)input.rmb=false; });
addEventListener('contextmenu',e=>e.preventDefault());

/* map mouse to a sword-intent point in the player's combat plane */
function playerIntent(pl,en){
  const fwd=TMP1.set(Math.sin(pl.yaw||0),0,Math.cos(pl.yaw||0));
  const right=TMP2.set(fwd.z,0,-fwd.x);
  const chest=TMP3.copy(pl.pos).setY(1.25);
  const reach=input.shift?1.55:1.15;
  const t=pl.tipTarget;
  t.copy(chest)
    .addScaledVector(right,input.mx*1.5)
    .addScaledVector(fwd,reach+(input.shift?clamp(input.my,0,1)*.6:0));
  t.y=1.25+input.my*1.25;
  if(input.rmb){ /* guard: bring the blade between you and his */
    if(en.bladeA&&en.bladeB){
      TMP4.addVectors(en.bladeA,en.bladeB).multiplyScalar(.5);
      t.copy(chest).lerp(TMP4,.42); t.y=clamp(t.y,0.7,1.7);
    } else { t.copy(chest).addScaledVector(fwd,.6); t.y=1.3; }
  }
  pl.thrust=input.shift; pl.guarding=input.rmb;
  /* footwork */
  const m=pl.mobility, acc=13*m;
  const move=TMP4.set(0,0,0);
  if(input.keys.KeyW)move.add(fwd); if(input.keys.KeyS)move.sub(fwd);
  if(input.keys.KeyD)move.add(right); if(input.keys.KeyA)move.sub(right);
  if(move.lengthSq()>0){ move.normalize(); pl.vel.addScaledVector(move,acc* dt_g); 
    const vmax=2.6*m; const v2=Math.hypot(pl.vel.x,pl.vel.z);
    if(v2>vmax){ pl.vel.x*=vmax/v2; pl.vel.z*=vmax/v2; } }
}

/* ================================ AI =================================== */
class AI{
  constructor(f){ this.f=f; this.state='circle'; this.t=rand(1.6,2.6);   // sizes you up first
    this.strafe=Math.random()<.5?1:-1; this.plan=null; this.reaction=.19; this.alert=0;
    this.aimErr=V3(); this.skill=.82; }                                   // <1: human, not machine
  update(dt,foe){
    const f=this.f; if(!f.alive)return;
    const dist=f.pos.distanceTo(foe.pos);
    const fwd=TMP1.set(Math.sin(f.yaw||0),0,Math.cos(f.yaw||0)).clone();
    const right=V3(fwd.z,0,-fwd.x);
    const chest=f.pos.clone().setY(1.25);
    this.t-=dt;

    /* threat detection: foe blade fast and inbound */
    let threat=false;
    if(foe.bladeA&&foe.bladeSpeed>6){
      TMP2.subVectors(foe.bladeB,chest);
      if(TMP2.length()<1.6)threat=true;
    }
    if(threat)this.alert+=dt; else this.alert=Math.max(0,this.alert-dt*2);

    const m=f.mobility, acc=11*m;
    const move=V3();

    /* if disarmed or crippled → desperate retreat */
    const desperate=!f.hasSword||f.bloodFrac<.55;

    switch(this.state){
      case 'circle':{
        const maai=desperate?3.4:2.15;
        if(dist>maai+.25)move.add(fwd);
        else if(dist<maai-.25)move.sub(fwd);
        move.addScaledVector(right,this.strafe*.6);
        /* never let the rope pin you */
        { const rr=Math.hypot(f.pos.x,f.pos.z);
          if(rr>RING_R-1.1){ TMP3.set(-f.pos.x,0,-f.pos.z).normalize();
            move.addScaledVector(TMP3,.9); } }
        /* guard posture between engagements */
        f.tipTarget.copy(chest).addScaledVector(fwd,.9); f.tipTarget.y=1.35+Math.sin(f.breath*1.3)*.05;
        f.thrust=false; f.guarding=false;
        if(threat&&this.alert>this.reaction&&Math.random()<.85){ this.state='block'; this.t=rand(.3,.55); break; }
        if(this.t<=0){ this.strafe*=Math.random()<.4?-1:1; this.t=rand(.8,1.9);
          if(!desperate&&dist<2.9&&Math.random()<.5){ this.beginAttack(foe); } }
        break; }
      case 'block':{
        f.guarding=true;
        if(foe.bladeA){ TMP2.addVectors(foe.bladeA,foe.bladeB).multiplyScalar(.5);
          f.tipTarget.copy(chest).lerp(TMP2,.45); f.tipTarget.y=clamp(f.tipTarget.y,.7,1.75); }
        move.sub(fwd).multiplyScalar(.5);
        if(this.t<=0){ this.state='circle'; this.t=rand(.3,.8);
          if(dist<2.6&&Math.random()<.38)this.beginAttack(foe); }
        break; }
      case 'attack':{
        const pl=this.plan;
        pl.t+=dt;
        /* windup then strike THROUGH the target part */
        if(pl.phase===0){
          f.tipTarget.copy(chest).addScaledVector(pl.windup,1);
          if(dist>pl.range)move.add(fwd);
          if(pl.t>pl.windupT){ pl.phase=1; pl.t=0; }
        } else if(pl.phase===1){
          const cap=foe.capsules[pl.target];
          if(cap){ TMP2.addVectors(cap.a,cap.b).multiplyScalar(.5).add(this.aimErr);
            /* aim past the body for follow-through */
            TMP3.subVectors(TMP2,f.tip).normalize();
            f.tipTarget.copy(TMP2).addScaledVector(TMP3,.55); }
          f.thrust=pl.thrust;
          move.add(fwd).multiplyScalar(.7);
          if(pl.t>pl.strikeT){ this.state='recover'; this.t=rand(.35,.7); f.thrust=false; }
        }
        break; }
      case 'recover':{
        move.sub(fwd); move.addScaledVector(right,this.strafe*.4);
        f.tipTarget.copy(chest).addScaledVector(fwd,.8); f.tipTarget.y=1.35;
        if(threat&&Math.random()<.5){ this.state='block'; this.t=rand(.25,.5); }
        else if(this.t<=0){ this.state='circle'; this.t=rand(.4,1.2); }
        break; }
    }
    if(move.lengthSq()>0){ move.normalize(); f.vel.addScaledVector(move,acc*dt);
      const vmax=2.3*m, v2=Math.hypot(f.vel.x,f.vel.z);
      if(v2>vmax){ f.vel.x*=vmax/v2; f.vel.z*=vmax/v2; } }
  }
  beginAttack(foe){
    const f=this.f;
    /* choose technique by opportunity */
    const targets=[
      {k:'head',w:2,windup:V3(0,1.0,0),thrust:false},
      {k:'neck',w:3,windup:V3(-.8,.8,0),thrust:false},
      {k:'forearmR',w:3,windup:V3(.7,.6,0),thrust:false},
      {k:'chest',w:2,windup:V3(0,.4,0),thrust:true},
      {k:'thighL',w:2,windup:V3(.8,-.1,0),thrust:false},
      {k:'abdomen',w:2,windup:V3(-.9,.2,0),thrust:false},
    ];
    let sum=0; for(const t of targets)sum+=t.w;
    let r=Math.random()*sum, pick=targets[0];
    for(const t of targets){ r-=t.w; if(r<=0){ pick=t; break; } }
    const fwd=V3(Math.sin(f.yaw||0),0,Math.cos(f.yaw||0));
    const right=V3(fwd.z,0,-fwd.x);
    const wu=V3().addScaledVector(right,pick.windup.x).addScaledVector(fwd,-.2);
    wu.y=pick.windup.y;
    this.aimErr.set(rand(-.14,.14),rand(-.12,.12),rand(-.14,.14)).multiplyScalar(2-this.skill*1.2);
    this.plan={target:pick.k,thrust:pick.thrust,windup:wu,
      windupT:rand(.28,.46),strikeT:rand(.3,.44),range:2.9,t:0,phase:0};
    this.state='attack';
  }
}

/* ============================ COMBAT =================================== */
const BLADE_EFF_MASS=2.0;    // kg effective at the edge (katana + both arms behind it)
const hitTmpA=V3(),hitTmpB=V3();

const sweptA=V3(),sweptB=V3();
/* deeper structures first so a dying blade doesn't skip the vitals order */
const HIT_ORDER=['neck','head','chest','abdomen','forearmR','forearmL',
  'upperArmR','upperArmL','thighR','thighL','shinR','shinL'];
function bladeVsBody(att,def,log){
  if(!att.bladeA||!def.alive)return;
  if(att.bladeSpeed*att.swordControl<2.2)return; // resting contact does nothing
  const steps=att.hadPrev?3:1;             // swept test defeats tunneling at 14 m/s
  for(const key of HIT_ORDER){
    if(def.severed.armR&&(key==='forearmR'))continue;
    if(def.severed.armL&&(key==='forearmL'))continue;
    const c=def.capsules[key];
    let d=Infinity;
    for(let s=1;s<=steps;s++){
      const t=s/steps;
      sweptA.lerpVectors(att.hadPrev?att.prevBladeA:att.bladeA,att.bladeA,t);
      sweptB.lerpVectors(att.hadPrev?att.prevBladeB:att.bladeB,att.bladeB,t);
      const di=segSegClosest(sweptA,sweptB,c.a,c.b,hitTmpA,hitTmpB);
      if(di<d)d=di;
      if(d<c.r+.015)break;
    }
    if(d<c.r+.015){
      /* energy re-read every contact: flesh drags the blade, the next
         part in the same swing sees a much slower edge */
      const spd=att.tipVel.length()*att.swordControl;
      if(spd<2.2)break;
      const energy=.5*BLADE_EFF_MASS*spd*spd;
      const dir=TMP1.copy(att.tipVel).normalize();
      def.lastHitDir=dir.clone();
      const res=def.applyCut(key,energy,att.alignment,att.thrust,hitTmpB.clone(),dir.clone(),log);
      if(res){
        /* blade loses energy in the body — realistic drag */
        att.tipVel.multiplyScalar(res==='blunt'?.55:.35);
        /* knockback on heavy hits */
        def.vel.addScaledVector(dir,clamp(energy/160,0,1.2));
        shake(clamp(energy/500,0.05,.4));
        if(def.dead&&game.state==='fight')slowmo();
      }
    }
  }
}

function bladeVsBlade(a,b){
  if(!a.bladeA||!b.bladeA)return;
  const d=segSegClosest(a.bladeA,a.bladeB,b.bladeA,b.bladeB,hitTmpA,hitTmpB);
  if(d<.045){
    const rel=TMP1.copy(a.tipVel).sub(b.tipVel).length();
    if(rel<1.5)return;
    const hard=rel>7;
    Sound.clang(hard);
    sparks(hitTmpA,Math.floor(clamp(rel,3,12)));
    /* the faster blade is deflected by the steadier one; guards deflect harder */
    const deflect=(f,other,factor)=>{
      TMP2.subVectors(f.tip,hitTmpA).normalize();
      f.tipVel.multiplyScalar(factor).addScaledVector(TMP2,rel*.35);
      f.stamina=Math.max(0,f.stamina-rel*.8);
    };
    deflect(a,b,b.guarding?.15:.4);
    deflect(b,a,a.guarding?.15:.4);
    if(hard){ a.stun=Math.max(a.stun,.08); b.stun=Math.max(b.stun,.08); }
  }
}

/* sparks on steel */
const sparkPool=[];
function sparks(p,n){
  for(let i=0;i<n;i++){
    let s=sparkPool.find(x=>!x.alive);
    if(!s){ s={mesh:new THREE.Mesh(new THREE.SphereGeometry(.01,4,4),
        new THREE.MeshBasicMaterial({color:0xffe9b0})),vel:V3(),alive:false,life:0};
      scene.add(s.mesh); sparkPool.push(s); if(sparkPool.length>80)return; }
    s.alive=true; s.life=rand(.15,.4);
    s.mesh.visible=true; s.mesh.position.copy(p);
    s.vel.set(rand(-2,2),rand(0,3),rand(-2,2));
  }
}
function updateSparks(dt){
  for(const s of sparkPool){ if(!s.alive)continue;
    s.life-=dt; if(s.life<=0){ s.alive=false; s.mesh.visible=false; continue; }
    s.vel.y-=9.8*dt; s.mesh.position.addScaledVector(s.vel,dt); }
}

/* dropped swords & severed pieces settle in the snow */
function updateLoose(f,dt){
  if(f.droppedSword&&f.katana){
    const k=f.katana,d=f.droppedSword;
    d.vel.y-=9.8*dt; k.position.addScaledVector(d.vel,dt);
    k.rotation.z+=d.spin*dt;
    if(k.position.y<=.03){ k.position.y=.03; d.vel.set(0,0,0); d.spin=0;
      k.rotation.x=Math.PI/2*.96; f.droppedSword=null; }
  }
  if(f.severedPieces)for(const p of f.severedPieces){
    if(!p.vel)continue;
    p.vel.y-=9.8*dt; p.mesh.position.addScaledVector(p.vel,dt);
    p.mesh.rotation.x+=p.ang.x*dt; p.mesh.rotation.z+=p.ang.z*dt;
    if(p.mesh.position.y<=.05){ p.mesh.position.y=.05; p.vel=null;
      addStain(p.mesh.position.x,p.mesh.position.z,.14); }
  }
}

/* ============================== HUD ==================================== */
const DIAGRAM_SPOTS={head:[28,10],neck:[28,19],chest:[28,32],abdomen:[28,46],
  upperArmR:[14,32],upperArmL:[42,32],forearmR:[10,46],forearmL:[46,46],
  thighR:[21,66],thighL:[35,66],shinR:[20,88],shinL:[36,88]};
function buildDiagram(el){
  el.innerHTML=`<svg viewBox="0 0 56 104">
    <g fill="none" stroke="rgba(233,230,223,.45)" stroke-width="1.6" stroke-linecap="round">
      <circle cx="28" cy="10" r="6"/>
      <line x1="28" y1="17" x2="28" y2="52"/>
      <line x1="28" y1="24" x2="12" y2="40"/><line x1="12" y1="40" x2="9" y2="52"/>
      <line x1="28" y1="24" x2="44" y2="40"/><line x1="44" y1="40" x2="47" y2="52"/>
      <line x1="28" y1="52" x2="20" y2="76"/><line x1="20" y1="76" x2="19" y2="98"/>
      <line x1="28" y1="52" x2="36" y2="76"/><line x1="36" y1="76" x2="37" y2="98"/>
    </g>
    <g class="wound-dots"></g></svg>`;
}
const sevColor={minor:'#8a6a4f',moderate:'#a8552e',severe:'#c22323',mortal:'#ff2e2e'};
function updateDiagram(el,f){
  const g=el.querySelector('.wound-dots'); if(!g)return;
  g.innerHTML=f.wounds.map(w=>{
    const s=DIAGRAM_SPOTS[w.part]||[28,32];
    const r=w.severity==='mortal'?4:w.severity==='severe'?3:2;
    return `<circle cx="${s[0]}" cy="${s[1]}" r="${r}" fill="${sevColor[w.severity]}"/>`;
  }).join('');
}
function stateText(f){
  if(f.dead)return `<span class="crit">dead — ${f.deathCause||''}</span>`;
  const bits=[];
  if(f.heartHit)bits.push('<span class="crit">heart struck</span>');
  else if(f.bleedRate>30)bits.push('<span class="crit">hemorrhaging</span>');
  else if(f.bleedRate>8)bits.push('bleeding');
  if(!f.hasSword)bits.push('<span class="crit">disarmed</span>');
  if(f.disabled.legR||f.disabled.legL)bits.push('leg crippled');
  if(f.airway)bits.push('airway cut');
  if(f.lungHit)bits.push('lung collapsed');
  if(f.consciousness<55)bits.push('<span class="crit">fading…</span>');
  else if(f.bloodFrac<.8)bits.push('pale');
  if(bits.length===0)return f.stamina<40?'winded':'composed';
  return bits.join(' · ');
}
const logEl=document.getElementById('log');
function log(msg,mortal){
  const d=document.createElement('div');
  d.className='log-line'+(mortal?' mortal':''); d.textContent=msg;
  logEl.appendChild(d);
  while(logEl.children.length>4)logEl.removeChild(logEl.firstChild);
  setTimeout(()=>d.remove(),5200);
}

/* ============================ GAME STATE =============================== */
const game={state:'menu',timeScale:1,slowT:0,shake:0};
let player,enemy,enemyAI;
function shake(v){ game.shake=Math.max(game.shake,v); }
function slowmo(){ game.timeScale=.22; game.slowT=1.5; }

function setup(){
  if(player){ disposeFighter(player); disposeFighter(enemy); }
  for(const p of bloodStains)scene.remove(p.mesh); bloodStains.length=0;
  for(const m of allStains)scene.remove(m); allStains.length=0; stainCount=0;
  player=new Fighter('Musashi',
    {kimono:0x2e4059,hakama:0x1b2534,obi:0xcfc8b6,skin:0xc9a184,accent:0xe9e5da},-1.9,1,true);
  enemy=new Fighter('Onimaru',
    {kimono:0x352822,hakama:0x1e1712,obi:0x7c1f1f,skin:0xbf9276,accent:0x101010},1.9,-1,false);
  enemyAI=new AI(enemy);
  player.yaw=Math.atan2(enemy.pos.x-player.pos.x,enemy.pos.z-player.pos.z);
  enemy.yaw=Math.atan2(player.pos.x-enemy.pos.x,player.pos.z-enemy.pos.z);
  buildDiagram(document.getElementById('diagram-player'));
  buildDiagram(document.getElementById('diagram-enemy'));
  logEl.innerHTML='';
}
function disposeFighter(f){
  scene.remove(f.root); scene.remove(f.katana); scene.remove(f.trailMesh);
  for(const k in f.parts)scene.remove(f.parts[k]);
}
function restart(){
  document.getElementById('verdict').classList.add('hidden');
  setup(); game.state='fight'; game.timeScale=1; game.duelTime=0;
}
function endDuel(){
  game.state='over';
  const won=enemy.dead;
  const v=document.getElementById('verdict');
  document.getElementById('verdict-kanji').textContent=won?'勝':'死';
  document.getElementById('verdict-kanji').className='kanji'+(won?'':' red');
  document.getElementById('verdict-sub').textContent=won?'YOU PREVAIL':'YOU FALL';
  const dead=won?enemy:player;
  document.getElementById('cause').textContent=
    (won?'Onimaru':'Musashi')+' — cause of death: '+(dead.deathCause||'wounds')+'.'+
    ' Duel lasted '+game.duelTime.toFixed(1)+'s. Wounds dealt: '+enemy.wounds.length+' · taken: '+player.wounds.length+'.';
  setTimeout(()=>v.classList.remove('hidden'),1400);
}

document.getElementById('btn-begin').addEventListener('click',()=>{
  Sound.ac().resume&&Sound.ac().resume();
  document.getElementById('menu').classList.add('hidden');
  restart();
});
document.getElementById('btn-again').addEventListener('click',restart);

/* ============================== CAMERA ================================= */
const camTarget=V3(0,1.2,0);
function updateCamera(dt){
  if(!player)return;
  const mid=TMP1.addVectors(player.pos,enemy.pos).multiplyScalar(.5); mid.y=1.15;
  camTarget.lerp(mid,clamp(dt*3,0,1));
  const span=player.pos.distanceTo(enemy.pos);
  /* side-on duel framing that drifts with the player's flank */
  const axis=TMP2.subVectors(enemy.pos,player.pos).setY(0).normalize();
  const side=TMP3.set(axis.z,0,-axis.x);
  const dist=clamp(3.2+span*.75,4,7.5);
  const desired=TMP4.copy(mid).addScaledVector(side,dist).setY(1.75+span*.12);
  desired.x+=Math.sin(performance.now()*.00013)*.25;
  desired.y+=Math.sin(performance.now()*.00021)*.1;
  camera.position.lerp(desired,clamp(dt*2.2,0,1));
  if(game.shake>0){
    camera.position.x+=rand(-1,1)*game.shake*.05;
    camera.position.y+=rand(-1,1)*game.shake*.05;
    game.shake=Math.max(0,game.shake-dt*2.2);
  }
  camera.lookAt(camTarget);
}


/* =============================== LOOP ================================== */
let last=performance.now(), dt_g=0, uiT=0;
game.duelTime=0;
function frame(now){
  requestAnimationFrame(frame);
  let dt=Math.min((now-last)/1000,.05); last=now;
  if(game.slowT>0){ game.slowT-=dt; if(game.slowT<=0)game.timeScale=1; }
  dt*=game.timeScale; dt_g=dt;

  /* atmosphere is never paused */
  for(const S of SNOWS){
    const pos=S.geo.attributes.position.array;
    for(let i=0;i<S.n;i++){
      pos[i*3+1]-=(S.speed+(i%5)*.07)*dt/Math.max(game.timeScale,.4);
      pos[i*3]+=Math.sin(now*.0004+S.drift[i])*.15*dt;
      if(pos[i*3+1]<0){ pos[i*3+1]=15;
        pos[i*3]=camTarget.x+rand(-S.area,S.area); pos[i*3+2]=camTarget.z+rand(-S.area,S.area); }
    }
    S.geo.attributes.position.needsUpdate=true;
  }
  for(const L of lanterns)
    L.light.intensity=L.base*(0.82+0.22*Math.sin(now*.011+L.seed)+0.1*Math.sin(now*.037+L.seed*2.7));
  for(const M of mists){
    M.mesh.quaternion.copy(camera.quaternion);
    M.mesh.position.x+=M.v*dt;
    if(Math.abs(M.mesh.position.x)>15)M.mesh.position.x*=-.95;
  }

  if(game.state==='fight'||game.state==='over'){
    game.state==='fight'&&(game.duelTime+=dt);
    if(player.alive)playerIntent(player,enemy);
    enemyAI.update(dt,player);

    for(const f of [player,enemy]){
      if(f.ragdoll)f.updateRagdoll(dt);
      else{ f.updateAlive(dt,f===player?enemy:player); f.updatePhysiology(dt,log); }
      updateLoose(f,dt);
      if(!f.dead&&f.arterialWound&&f.bleedRate>15){
        if(f.pulseT>60/(100+(1-f.bloodFrac)*80)){ f.pulseT=0;
          const c=f.capsules[f.arterialWound.part];
          TMP1.addVectors(c.a,c.b).multiplyScalar(.5);
          emitBlood(TMP1,V3(rand(-.5,.5),1,rand(-.5,.5)),2.6,5); }
      }
      if(!f.dead&&f.pool){ f.pool.r=Math.min(1.2,f.pool.r+f.bleedRate*dt*.0009);
        f.pool.mesh.position.set(f.pos.x,.007,f.pos.z); }
    }

    if(game.state==='fight'){
      bladeVsBlade(player,enemy);
      bladeVsBody(player,enemy,log);
      bladeVsBody(enemy,player,log);
      if(player.dead||enemy.dead)endDuel();
    }
  }

  updateBloodFX(dt); updateSparks(dt); updateCamera(dt);

  uiT+=dt;
  if(uiT>.1&&player){ uiT=0;
    document.getElementById('bloodfill-player').style.height=(player.bloodFrac*100)+'%';
    document.getElementById('bloodfill-enemy').style.height=(enemy.bloodFrac*100)+'%';
    document.getElementById('state-player').innerHTML=stateText(player);
    document.getElementById('state-enemy').innerHTML=stateText(enemy);
    updateDiagram(document.getElementById('diagram-player'),player);
    updateDiagram(document.getElementById('diagram-enemy'),enemy);
  }
  renderer.render(scene,camera);
}
setup();
requestAnimationFrame(frame);
