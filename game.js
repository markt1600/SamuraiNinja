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
/* minimum-jerk profiles — human point-to-point movement (Flash & Hogan) */
const angDiff=(a,b)=>{ let d=a-b; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI; return d; };
const minJerk=t=>{ t=clamp(t,0,1); return t*t*t*(10+t*(-15+6*t)); };
const minJerkBell=t=>{ t=clamp(t,0,1); return 16*t*t*(1-t)*(1-t); }; // 0→1→0, peak .5
const rand=(a,b)=>a+Math.random()*(b-a);
const TMP1=V3(), TMP2=V3(), TMP3=V3(), TMP4=V3();
const IS_TOUCH=(typeof process==='undefined')&&(typeof window!=='undefined')&&
  (('ontouchstart' in window)||((typeof navigator!=='undefined'&&navigator.maxTouchPoints)|0)>0);
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
  let ctx=null,busG=null,busF=null;
  const ac=()=>ctx||(ctx=new (window.AudioContext||window.webkitAudioContext)());
  const bus=()=>{ const c=ac();
    if(!busG){ try{
      busF=c.createBiquadFilter(); busF.type='lowpass'; busF.frequency.value=18000;
      busG=c.createGain(); busG.gain.value=1;
      busG.connect(busF); busF.connect(bus());
    }catch(e){ busG=null; return c.destination; } }
    return busG||c.destination; };
  function setMuffle(m){ try{ if(busF)
    busF.frequency.setTargetAtTime(lerp(16000,760,clamp(m,0,1)),ac().currentTime,.25);
  }catch(e){} }
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
  function scrape(){ // steel grinding on steel, low and mean
    try{
      const c=ac(), t=c.currentTime;
      const s=c.createBufferSource(); s.buffer=noiseBuf(.22);
      const f=c.createBiquadFilter(); f.type='bandpass'; f.Q.value=9;
      f.frequency.setValueAtTime(1900+Math.random()*900,t);
      f.frequency.exponentialRampToValueAtTime(900+Math.random()*400,t+.2);
      const g=c.createGain(); g.gain.setValueAtTime(.05,t);
      g.gain.exponentialRampToValueAtTime(.0001,t+.22);
      s.connect(f); f.connect(g); g.connect(bus()); s.start(t);
    }catch(e){}
  }
  function step(speed){ // snow crunch, weight-scaled
    try{
      const c=ac(), t=c.currentTime;
      const s=c.createBufferSource(); s.buffer=noiseBuf(.07);
      const f=c.createBiquadFilter(); f.type='lowpass';
      f.frequency.value=420+Math.random()*180;
      const g=c.createGain();
      g.gain.setValueAtTime(.028+clamp(speed,0,3)*.012,t);
      g.gain.exponentialRampToValueAtTime(.0001,t+.09);
      s.connect(f); f.connect(g); g.connect(bus()); s.start(t);
    }catch(e){}
  }
  /* ---- ambience: wind that breathes, ducked at the kill ---- */
  let windGain=null, windLFO={t:0,target:.05,cur:0};
  function startWind(){
    try{
      if(windGain)return; const c=ac(), t=c.currentTime;
      const s=c.createBufferSource(); s.buffer=noiseBuf(3); s.loop=true;
      const f=c.createBiquadFilter(); f.type='bandpass'; f.frequency.value=280; f.Q.value=.7;
      const f2=c.createBiquadFilter(); f2.type='lowpass'; f2.frequency.value=900;
      windGain=c.createGain(); windGain.gain.setValueAtTime(0,t);
      s.connect(f); f.connect(f2); f2.connect(windGain); windGain.connect(bus());
      s.start();
    }catch(e){}
  }
  function tickWind(dt){
    if(!windGain)return;
    try{
      windLFO.t-=dt;
      if(windLFO.t<=0){ windLFO.t=2+Math.random()*4; windLFO.target=.02+Math.random()*.075; }
      windLFO.cur+=(windLFO.target-windLFO.cur)*dt*.6;
      windGain.gain.setTargetAtTime(windLFO.cur,ac().currentTime,.3);
    }catch(e){}
  }
  function duckWind(){ try{ if(windGain){ windLFO.cur=0; windLFO.target=.015; windLFO.t=3;
    windGain.gain.setTargetAtTime(.004,ac().currentTime,.12); } }catch(e){} }
  /* ---- heartbeat: rises as blood falls ---- */
  let heartT=0;
  function tickHeart(dt,urgency){ // urgency 0..1
    if(urgency<=0){ heartT=0; return; }
    try{
      heartT-=dt;
      if(heartT<=0){
        const bpm=62+urgency*72; heartT=60/bpm;
        const c=ac();
        const thump=(delay,vol)=>{
          const t=c.currentTime+delay;
          const o=c.createOscillator(), g=c.createGain(), f=c.createBiquadFilter();
          o.type='sine'; o.frequency.setValueAtTime(64,t);
          o.frequency.exponentialRampToValueAtTime(38,t+.09);
          f.type='lowpass'; f.frequency.value=140;
          g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(.0001,t+.16);
          o.connect(f); f.connect(g); g.connect(bus());
          o.start(t); o.stop(t+.2);
        };
        const v=.05+urgency*.14;
        thump(0,v); thump(.14,v*.62);
      }
    }catch(e){}
  }
  /* ---- taiko: one hit on first blood ---- */
  function taiko(){
    try{
      const c=ac(), t=c.currentTime;
      const o=c.createOscillator(), g=c.createGain();
      o.type='sine'; o.frequency.setValueAtTime(96,t);
      o.frequency.exponentialRampToValueAtTime(44,t+.4);
      g.gain.setValueAtTime(.5,t); g.gain.exponentialRampToValueAtTime(.0001,t+.9);
      o.connect(g); g.connect(bus()); o.start(t); o.stop(t+1);
      const s=c.createBufferSource(); s.buffer=noiseBuf(.12);
      const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=500;
      const g2=c.createGain(); g2.gain.setValueAtTime(.22,t);
      g2.gain.exponentialRampToValueAtTime(.0001,t+.14);
      s.connect(f); f.connect(g2); g2.connect(bus()); s.start(t);
    }catch(e){}
  }
  /* ---- the kill: sub boom, wind holds its breath ---- */
  function killMoment(){
    try{
      const c=ac(), t=c.currentTime;
      const o=c.createOscillator(), g=c.createGain();
      o.type='sine'; o.frequency.setValueAtTime(52,t);
      o.frequency.exponentialRampToValueAtTime(26,t+1.1);
      g.gain.setValueAtTime(.4,t); g.gain.exponentialRampToValueAtTime(.0001,t+1.6);
      o.connect(g); g.connect(bus()); o.start(t); o.stop(t+1.8);
      duckWind();
    }catch(e){}
  }
  function parry(){ // bright double-ring — steel turned aside
    try{
      const c=ac(); const t=c.currentTime;
      [1560,2340,1170].forEach((f0,i)=>{
        const o=c.createOscillator(), g=c.createGain();
        o.type='triangle'; o.frequency.value=f0*(1+Math.random()*.02);
        g.gain.setValueAtTime(.14/(i+1),t);
        g.gain.exponentialRampToValueAtTime(.0001,t+.5+i*.1);
        o.connect(g); g.connect(bus());
        o.start(t+i*.028); o.stop(t+.8);
      });
    }catch(e){}
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
  return {ac,whoosh,clang,cut,thump,parry,startWind,tickWind,tickHeart,taiko,killMoment,step,setMuffle,scrape};
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
/* no fog: the night is clear and deep */

/* IBL: prefilter a lighting-only scene (sky, snowfield, moon) into an
   environment map — every standard material then receives soft light
   from the world itself instead of floating in black. */
(function buildIBL(){
  try{
    const env=new THREE.Scene();
    const skyG=canTex(64,256,(x,w,h)=>{
      const g=x.createLinearGradient(0,0,0,h);
      g.addColorStop(0,'#0a1020'); g.addColorStop(.55,'#141f33');
      g.addColorStop(.8,'#3a4a5e'); g.addColorStop(1,'#93a2b4');
      x.fillStyle=g; x.fillRect(0,0,w,h); });
    if(!skyG)return;
    env.add(new THREE.Mesh(new THREE.SphereGeometry(50,16,12),
      new THREE.MeshBasicMaterial({map:skyG,side:THREE.BackSide})));
    const ground=new THREE.Mesh(new THREE.CircleGeometry(50,24),
      new THREE.MeshBasicMaterial({color:0x8b96a4}));
    ground.rotation.x=-Math.PI/2; ground.position.y=-2; env.add(ground);
    const moonB=new THREE.Mesh(new THREE.SphereGeometry(3,12,10),
      new THREE.MeshBasicMaterial({color:0xeaf1ff}));
    moonB.position.set(-18,26,14); env.add(moonB);
    const pm=new THREE.PMREMGenerator(renderer);
    const rt=pm.fromScene(env,.04);
    scene.environment=rt.texture;
    pm.dispose();
  }catch(e){}
})();

const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.1,140);
camera.position.set(0,2.1,6.4);

/* ----------------------- bloom post pipeline ---------------------------
   Hand-rolled (no EffectComposer): scene → bright-pass → separable
   gaussian at half res → additive composite with manual sRGB out.      */
const POST=(()=>{
  try{
    const mkRT=(w,h)=>new THREE.WebGLRenderTarget(w,h,{
      minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
      format:THREE.RGBAFormat,depthBuffer:true,stencilBuffer:false});
    const SS=IS_TOUCH?1.0:1.4;          // phones skip the supersample
    let W=innerWidth,H=innerHeight;
    const rtScene=mkRT(Math.round(W*SS),Math.round(H*SS)),
          rtA=mkRT(W>>1,H>>1), rtB=mkRT(W>>1,H>>1);
    rtA.depthBuffer=rtB.depthBuffer=false;
    const quadGeo=new THREE.PlaneGeometry(2,2);
    const VS='varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';
    const mat=(fs,uniforms)=>{ const m=new THREE.ShaderMaterial({
      vertexShader:VS,fragmentShader:fs,uniforms,depthWrite:false,depthTest:false});
      m.toneMapped=false; return m; };
    const bright=mat(
      'uniform sampler2D tex; varying vec2 vUv;'+
      'void main(){ vec3 c=texture2D(tex,vUv).rgb;'+
      ' float l=dot(c,vec3(.2126,.7152,.0722));'+
      ' gl_FragColor=vec4(c*smoothstep(.62,.95,l),1.);}',
      {tex:{value:rtScene.texture}});
    const blurFS=
      'uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;'+
      'void main(){ vec3 s=texture2D(tex,vUv).rgb*.227;'+
      ' s+=texture2D(tex,vUv+dir*1.384).rgb*.316;'+
      ' s+=texture2D(tex,vUv-dir*1.384).rgb*.316;'+
      ' s+=texture2D(tex,vUv+dir*3.230).rgb*.070;'+
      ' s+=texture2D(tex,vUv-dir*3.230).rgb*.070;'+
      ' gl_FragColor=vec4(s,1.);}';
    const blurH=mat(blurFS,{tex:{value:rtA.texture},dir:{value:new THREE.Vector2(1/(W>>1),0)}});
    const blurV=mat(blurFS,{tex:{value:rtB.texture},dir:{value:new THREE.Vector2(0,1/(H>>1))}});
    const comp=mat(
      'uniform sampler2D scene; uniform sampler2D bloom; varying vec2 vUv;'+
      'uniform float uDesat; uniform float uVig; uniform float uAdren; uniform float uTime;'+
      'void main(){'+
      ' vec2 cc=vUv-.5; float rr=dot(cc,cc);'+
      ' vec2 ca=cc*rr*.028;'+                                 // chromatic fringe
      ' vec3 c; c.r=texture2D(scene,vUv+ca).r;'+
      ' c.g=texture2D(scene,vUv).g;'+
      ' c.b=texture2D(scene,vUv-ca).b;'+
      ' c+=texture2D(bloom,vUv).rgb*1.15;'+
      ' float l=dot(c,vec3(.2126,.7152,.0722));'+
      ' c=mix(c,vec3(l),uDesat);'+                              // life drains the colour
      ' c=mix(c,c*vec3(1.06,1.0,.94)*1.05,uAdren);'+            // adrenaline warmth
      ' float d=distance(vUv,vec2(.5));'+
      ' c*=1.-smoothstep(.62-uVig*.42,.98-uVig*.3,d)*(.55+uVig*.45);'+ // the world closes in
      ' c=(c-.5)*1.07+.5+.006;'+                             // grade: contrast lift
      ' float l2=dot(c,vec3(.2126,.7152,.0722));'+
      ' c=mix(vec3(l2),c,1.12);'+                              // saturation
      ' float gr=fract(sin(dot(vUv*vec2(917.,761.)+uTime,vec2(12.9898,78.233)))*43758.5);'+
      ' c+=(gr-.5)*.028;'+                                     // film grain
      ' c=pow(clamp(c,0.,1.),vec3(1./2.2));'+
      ' gl_FragColor=vec4(c,1.);}',
      {scene:{value:rtScene.texture},bloom:{value:rtA.texture},
       uDesat:{value:0},uVig:{value:0},uAdren:{value:0},uTime:{value:0}});
    const quadScene=new THREE.Scene();
    const quad=new THREE.Mesh(quadGeo,bright); quad.frustumCulled=false;
    quadScene.add(quad);
    const oCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const pass=(m,target)=>{ quad.material=m;
      renderer.setRenderTarget(target); renderer.render(quadScene,oCam); };
    return {
      comp,
      render(){
        renderer.setRenderTarget(rtScene); renderer.render(scene,camera);
        pass(bright,rtA);
        blurH.uniforms.tex.value=rtA.texture; pass(blurH,rtB);
        blurV.uniforms.tex.value=rtB.texture; pass(blurV,rtA);
        blurH.uniforms.tex.value=rtA.texture; pass(blurH,rtB);
        blurV.uniforms.tex.value=rtB.texture; pass(blurV,rtA);
        comp.uniforms.bloom.value=rtA.texture;
        renderer.setRenderTarget(null); pass(comp,null);
      },
      resize(w,h){ W=w;H=h; rtScene.setSize(Math.round(w*SS),Math.round(h*SS));
        rtA.setSize(w>>1,h>>1); rtB.setSize(w>>1,h>>1);
        blurH.uniforms.dir.value.set(1/(w>>1),0); blurV.uniforms.dir.value.set(0,1/(h>>1)); },
    };
  }catch(e){ return null; }
})();
/* scene renders linear into the RT; composite does the sRGB conversion */
if(POST)renderer.outputEncoding=THREE.LinearEncoding;

addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight);
  POST&&POST.resize(innerWidth,innerHeight); });

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
moon.intensity=1.15;
moon.shadow.mapSize.set(2048,2048);
moon.shadow.camera.left=-8; moon.shadow.camera.right=8;
moon.shadow.camera.top=8; moon.shadow.camera.bottom=-8;
moon.shadow.camera.near=2; moon.shadow.camera.far=30;
moon.shadow.bias=-.0004;
{ const rim=new THREE.DirectionalLight(SRGB(0x39496a).getHex(),.4);
  rim.position.set(8,4,-9); scene.add(rim); }
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

/* trampled fighting circle — a living canvas: the snow remembers
   every step, every drag, every drop of blood */
const groundMark=(()=>{
  const S=1024, R=RING_R+.45;
  let canvas=null,ctx=null,tex=null;
  try{
    canvas=document.createElement('canvas'); canvas.width=S; canvas.height=S;
    ctx=canvas.getContext('2d');
  }catch(e){ ctx=null; }
  if(!ctx)return null;
  function base(){
    const g=ctx.createRadialGradient(S/2,S/2,20,S/2,S/2,S/2);
    g.addColorStop(0,'#bcc3ca'); g.addColorStop(.75,'#c4cbd1'); g.addColorStop(1,'#ccd3d9');
    ctx.fillStyle=g; ctx.fillRect(0,0,S,S);
    ctx.strokeStyle='rgba(126,134,144,.25)';
    for(let i=0;i<160;i++){
      ctx.beginPath(); const r=rand(30,480), a=rand(0,6.28);
      ctx.arc(S/2,S/2,r,a,a+rand(.1,.5)); ctx.lineWidth=rand(1,3); ctx.stroke();
    }
  }
  base();
  tex=new THREE.CanvasTexture(canvas); tex.encoding=THREE.sRGBEncoding; tex.anisotropy=4;
  const px=(wx)=>(wx/(2*R)+.5)*S, py=(wz)=>(wz/(2*R)+.5)*S;
  const inRing=(x,z)=>Math.hypot(x,z)<R-.05;
  let dirty=false;
  return {
    tex,
    foot(x,z,yaw){
      if(!inRing(x,z))return;
      ctx.save(); ctx.translate(px(x),py(z)); ctx.rotate(yaw);
      ctx.fillStyle='rgba(98,107,120,.22)';
      ctx.beginPath(); ctx.ellipse(0,0,4.2,9.5,0,0,6.29); ctx.fill();
      ctx.restore(); dirty=true;
    },
    drag(x0,z0,x1,z1){
      if(!inRing(x1,z1))return;
      ctx.strokeStyle='rgba(98,107,120,.16)'; ctx.lineWidth=7; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(px(x0),py(z0)); ctx.lineTo(px(x1),py(z1)); ctx.stroke();
      dirty=true;
    },
    blood(x,z,r,a){
      if(!inRing(x,z))return;
      const rp=Math.max(2,r*94);
      const g=ctx.createRadialGradient(px(x),py(z),1,px(x),py(z),rp);
      g.addColorStop(0,'rgba(112,13,13,'+(a*.9)+')');
      g.addColorStop(.7,'rgba(96,11,11,'+(a*.55)+')');
      g.addColorStop(1,'rgba(88,10,10,0)');
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(px(x),py(z),rp,0,6.29); ctx.fill();
      dirty=true;
    },
    flush(){ if(dirty){ tex.needsUpdate=true; dirty=false; } },
    reset(){ base(); tex.needsUpdate=true; },
  };
})();
const groundNrm=mkNormalTex(512,(x,w,h)=>{
  x.fillStyle='#808080'; x.fillRect(0,0,w,h);
  for(let i=0;i<9000;i++){
    x.fillStyle=Math.random()<.5?'rgba(50,50,50,.4)':'rgba(210,210,210,.35)';
    const s=Math.random()<.9?1:2;
    x.fillRect(Math.random()*w,Math.random()*h,s,s);
  }
},1.4);
const groundRough=canTex(512,512,(x,w,h)=>{
  x.fillStyle='#ececec'; x.fillRect(0,0,w,h);   // snow: mostly diffuse...
  x.fillStyle='#404040';                        // ...with crystalline sparks
  for(let i=0;i<900;i++)x.fillRect(Math.random()*w,Math.random()*h,1,1);
});
const ringGroundMat=groundMark?stdMat(0xffffff,{map:groundMark.tex,roughness:1,
    normalMap:groundNrm||null,roughnessMap:groundRough||null})
                           :stdMat(0xbfc6cc,{roughness:.97});
if(ringGroundMat.normalMap)ringGroundMat.normalScale=new THREE.Vector2(.45,.45);
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

/* ---------------- a clear winter night: sky, stars, mountains ---------- */
const mists=[];   // gone — the air is clear
(function buildNight(){
  /* sky: vertical gradient dome with a faint glow near the moon's quarter */
  const skyTex=canTex(64,512,(ctx,w,h)=>{
    const g=ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,'#04060c'); g.addColorStop(.45,'#080d18');
    g.addColorStop(.75,'#0e1626'); g.addColorStop(1,'#18222f');
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  });
  if(skyTex){
    const sky=new THREE.Mesh(new THREE.SphereGeometry(90,24,16),
      new THREE.MeshBasicMaterial({map:skyTex,side:THREE.BackSide,
        depthWrite:false,fog:false}));
    sky.renderOrder=-20; scene.add(sky);
  }
  /* stars: a few hundred points, denser near the zenith */
  { const N=420, ps=new Float32Array(N*3), sz=new Float32Array(N);
    for(let i=0;i<N;i++){
      const az=rand(0,Math.PI*2), el=Math.acos(rand(0,.96));
      const r=84;
      ps[i*3]=Math.cos(az)*Math.sin(el)*r;
      ps[i*3+1]=Math.cos(el)*r+4;
      ps[i*3+2]=Math.sin(az)*Math.sin(el)*r;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(ps,3));
    const stars=new THREE.Points(g,new THREE.PointsMaterial({
      color:0xcdd8ee,size:.42,sizeAttenuation:true,transparent:true,
      opacity:.85,depthWrite:false,fog:false}));
    stars.renderOrder=-19; scene.add(stars);
  }
  /* mountains: two silhouette ridgelines, far and farther */
  const ridge=(dist,height,tone,seed)=>{
    const tex=canTex(1024,256,(ctx,w,h)=>{
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle=tone; ctx.beginPath(); ctx.moveTo(0,h);
      let y=h*.55;
      for(let x=0;x<=w;x+=8){
        y+=Math.sin(x*.013+seed)*4+Math.sin(x*.037+seed*2)*2.4+rand(-2,2);
        y=clamp(y,h*.18,h*.8);
        ctx.lineTo(x,y);
      }
      ctx.lineTo(w,h); ctx.closePath(); ctx.fill();
      /* faint snow on the upper slopes */
      ctx.globalCompositeOperation='source-atop';
      const g=ctx.createLinearGradient(0,0,0,h);
      g.addColorStop(0,'rgba(120,135,155,.5)'); g.addColorStop(.4,'rgba(120,135,155,0)');
      ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
    },{transparent:true});
    if(!tex)return;
    for(let k=0;k<4;k++){
      const m=new THREE.Mesh(new THREE.PlaneGeometry(dist*1.6,height),
        new THREE.MeshBasicMaterial({map:tex,transparent:true,
          depthWrite:false,fog:false}));
      const a=k*Math.PI/2+seed;
      m.position.set(Math.sin(a)*dist,height*.32,Math.cos(a)*dist);
      m.lookAt(0,height*.32,0);
      m.renderOrder=-18+ (dist<60?1:0);
      scene.add(m);
    }
  };
  ridge(70,26,'#070b13',1.7);
  ridge(52,17,'#0b111c',4.2);
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
  if(groundMark){ groundMark.blood(x,z,r,rand(.5,.9)); return; }
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
      {at:2.0, name:'forearm taken at the bone',     effect:'severArmR', bone:95, sever:135},
    ]},
  forearmL:{ label:'off wrist', r:.042, limb:'armL',
    layers:[
      {at:.3,  name:'left wrist cut',                effect:'bleedMinor'},
      {at:1.0, name:'left hand tendons severed',     effect:'disableArmL'},
      {at:2.0, name:'left forearm taken at the bone',effect:'severArmL', bone:95, sever:135},
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
  cyl.position.y=-len/2; cyl.castShadow=true; cyl.userData.shaft=true;
  const j=new THREE.Mesh(new THREE.SphereGeometry(rTop*1.06,10,8),mat); j.castShadow=true;
  j.userData.joint=true;
  const e=new THREE.Mesh(new THREE.SphereGeometry(rBot,10,8),mat); e.position.y=-len; e.castShadow=true;
  e.userData.end=true;
  g.add(cyl,j,e); g.userData.len=len; g.userData.r=Math.max(rTop,rBot);
  return g;
}

/* =========================================================================
   PROCEDURAL SKINNED BODY — one continuous mesh over torso, upper arms
   and legs, weighted across world-space bones driven by the same IK
   joints as the capsule skeleton. Joints deform instead of hinging.
   ========================================================================= */
function buildSkinnedBody(kimonoMat,hakamaMat,B){
  B=B||BUILDS.musashi;
  const BONES={pelvis:0,spine:1,chest:2,uaR:3,uaL:4,thR:5,shR:6,thL:7,shL:8};
  const bindPos={
    pelvis:[0,.9,0], spine:[0,1.07,0], chest:[0,1.38,0],
    uaR:[.185,1.335,0], uaL:[-.185,1.335,0],
    thR:[.10,.88,0], shR:[.10,.44,0], thL:[-.10,.88,0], shL:[-.10,.44,0],
  };
  const bones=[], root=new THREE.Bone();
  const order=['pelvis','spine','chest','uaR','uaL','thR','shR','thL','shL'];
  for(const k of order){ const b=new THREE.Bone();
    b.position.fromArray(bindPos[k]); root.add(b); bones.push(b); }

  const pos=[],nrm=[],sIdx=[],sWgt=[],uvs=[],idx=[],groups=[];
  const SEG=18;
  let ringStart=0, vBase=0;
  /* a vertical tube in bind pose; rings: {c:[x,y,z],r,sz,skin:[b0,w0,b1,w1]} */
  function tube(rings,matIndex){
    const triStart=idx.length;
    const first=vBase;
    const y0=rings[0].c[1], y1=rings[rings.length-1].c[1];
    for(let ri=0;ri<rings.length;ri++){
      const R=rings[ri];
      for(let s=0;s<=SEG;s++){
        const a=s/SEG*Math.PI*2, cx=Math.cos(a), sz=Math.sin(a);
        pos.push(R.c[0]+cx*R.r, R.c[1], R.c[2]+sz*R.r*(R.sz||1));
        nrm.push(cx,0,sz*(R.sz||1));
        uvs.push(s/SEG,(R.c[1]-y0)/((y1-y0)||1));
        sIdx.push(R.skin[0],R.skin[2],0,0);
        sWgt.push(R.skin[1],R.skin[3],0,0);
      }
    }
    const W=SEG+1;
    for(let ri=0;ri<rings.length-1;ri++)for(let s=0;s<SEG;s++){
      const a=first+ri*W+s;
      idx.push(a,a+1,a+W, a+1,a+W+1,a+W);
    }
    vBase+=rings.length*W;
    groups.push({start:triStart,count:idx.length-triStart,materialIndex:matIndex});
  }
  /* skin weight helper: blend bone A→B across a band of heights */
  const blend=(y,yA,yB,a,b)=>{
    const t=clamp((y-yA)/(yB-yA),0,1), tt=t*t*(3-2*t);
    return [a,1-tt,b,tt];
  };
  /* ---- torso (kimono) ---- */
  { const P=BONES.pelvis,S=BONES.spine,Ch=BONES.chest;
    const prof=[ // y, radius, depth-scale — a torso, not a pipe
      [.78,.150,.82],[ .84,.154,.85],[ .90,.155,.86],[ .96,.146,.84],
      [1.02,.134,.81],[1.07,.127,.79],[1.12,.128,.79],[1.18,.134,.79],
      [1.24,.146,.80],[1.30,.158,.82],[1.36,.170,.85],[1.41,.172,.87],
      [1.45,.148,.88],[1.475,.120,.88]];
    const sm=(a,b,t)=>{ t=clamp((t-a)/(b-a),0,1); return t*t*(3-2*t); };
    const shape=y=>{
      const wS=sm(.92,1.0,y)*(1-sm(1.14,1.24,y));     // waist influence, feathered
      const sS=sm(1.2,1.34,y);                          // shoulder influence
      const hS=1-sm(.86,.96,y);                         // hip influence
      return 1+(B.waist-1)*wS+(B.sh-1)*sS+(B.hip-1)*hS;
    };
    const rings=prof.map(([y,r0,szz])=>{
      const r=r0*shape(y);
      let skin;
      if(y<.97)skin=[P,1,S,0];
      else if(y<1.13)skin=blend(y,.97,1.13,P,S);
      else if(y<1.20)skin=[S,1,Ch,0];
      else skin=blend(y,1.20,1.32,S,Ch);
      if(y>=1.32)skin=[Ch,1,S,0];
      return {c:[0,y,0],r,sz:szz,skin};
    });
    tube(rings,0); }
  /* ---- upper arms with sleeve flare (kimono) ---- */
  for(const side of [1,-1]){
    const UA=side>0?BONES.uaR:BONES.uaL, Ch=BONES.chest;
    const x=.185*side, top=1.335, bot=1.045;
    const rings=[];
    for(let i=0;i<=8;i++){
      const t=i/8, y=lerp(top,bot,t);
      const deltoid=.021*minJerkBell(clamp(t/.5,0,1));  // shoulder muscle
      const r=lerp(.058,.084,Math.pow(t,1.35))+deltoid;
      const skin=t<.18?blend(t,0,.3,Ch,UA):(t<.3?blend(t,0,.3,Ch,UA):[UA,1,Ch,0]);
      rings.push({c:[x,y,0],r,sz:1,skin});
    }
    tube(rings,0);
  }
  /* ---- legs: one continuous hakama tube across the knee ---- */
  for(const side of [1,-1]){
    const TH=side>0?BONES.thR:BONES.thL, SH=side>0?BONES.shR:BONES.shL;
    const x=.10*side;
    const prof=[ // y, r
      [.88,.115],[.77,.126],[.66,.135],[.55,.140],[.44,.142],
      [.33,.128],[.22,.104],[.13,.078],[.05,.058]];
    const rings=prof.map(([y,r])=>{
      let skin;
      if(y>.52)skin=[TH,1,SH,0];
      else if(y>.36)skin=blend(y,.52,.36,TH,SH);
      else skin=[SH,1,TH,0];
      return {c:[x,y,0],r,sz:1,skin};
    });
    tube(rings,1);
  }

  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(nrm,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(sIdx,4));
  geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sWgt,4));
  geo.setIndex(idx);
  for(const g of groups)geo.addGroup(g.start,g.count,g.materialIndex);

  const km=kimonoMat.clone(); km.skinning=true;
  if(kimonoTex)km.map=kimonoTex;
  const hm=hakamaMat.clone(); hm.skinning=true;
  if(hakamaTex)hm.map=hakamaTex;
  km.roughness=.94; hm.roughness=.96;
  const mesh=new THREE.SkinnedMesh(geo,[km,hm]);
  mesh.castShadow=true; mesh.frustumCulled=false;
  mesh.add(root);
  const skel=new THREE.Skeleton(bones);
  mesh.bind(skel);
  return {mesh,bones,BONES,kimono:km,hakama:hm};
}


function weaponMesh(w){
  if(!w||w===WEAPONS.katana||(!w.blunt&&w.len>.9&&w.effMass<1.2))return katanaMesh();
  const g=new THREE.Group();
  try{
    const steel=stdMat(0xb9c4cf,{metalness:1,roughness:.24,
      envMap:envCube||null,envMapIntensity:1.3});
    const wood=stdMat(0x4a3420,{roughness:.85});
    if(w.blunt){ /* bare hands: nothing to carry */
      g.visible=false; return g; }
    if(w===WEAPONS.axe){
      const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.016,.019,w.len,8),wood);
      shaft.position.y=w.len*.5-.1; g.add(shaft);
      const head=new THREE.Mesh(new THREE.BoxGeometry(.05,.2,.02),steel);
      head.position.set(.09,w.len-.2,0); g.add(head);
      const edge=new THREE.Mesh(new THREE.BoxGeometry(.10,.2,.008),steel);
      edge.position.set(.14,w.len-.2,0); edge.scale.z=.6; g.add(edge);
      const spike=new THREE.Mesh(new THREE.ConeGeometry(.014,.09,6),steel);
      spike.rotation.z=Math.PI/2; spike.position.set(-.07,w.len-.2,0); g.add(spike);
    } else { /* broadsword */
      const blade=new THREE.Mesh(new THREE.BoxGeometry(.052,w.len-.16,.012),steel);
      blade.position.y=(w.len-.16)*.5+.14; g.add(blade);
      const tipm=new THREE.Mesh(new THREE.ConeGeometry(.028,.1,4),steel);
      tipm.position.y=w.len+.02; tipm.scale.z=.4; g.add(tipm);
      const guard=new THREE.Mesh(new THREE.BoxGeometry(.2,.02,.03),steel);
      guard.position.y=.12; g.add(guard);
      const grip=new THREE.Mesh(new THREE.CylinderGeometry(.016,.016,.2,8),wood);
      grip.position.y=0; g.add(grip);
      const pommel=new THREE.Mesh(new THREE.SphereGeometry(.026,8,8),steel);
      pommel.position.y=-.11; g.add(pommel);
    }
    g.traverse(o=>{ if(o.isMesh)o.castShadow=true; });
  }catch(e){}
  return g;
}
function katanaMesh(){
  const g=new THREE.Group();
  const steel=stdMat(0xb9c4cf,{metalness:1,roughness:.22,
    envMap:envCube||null,envMapIntensity:1.4});
  const hamon=stdMat(0xe9eff5,{metalness:.9,roughness:.1,
    envMap:envCube||null,envMapIntensity:1.7});
  const lacquer=stdMat(0x14111a,{roughness:.28,metalness:.3,
    envMap:envCube||null,envMapIntensity:.8});
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
  const d=TMP1.subVectors(to,from).length();
  if(d>1e-6)TMP1.divideScalar(d);
  g.quaternion.setFromUnitVectors(UPV,TMP1);
  /* a limb mesh always SPANS its joints — no gaps, ever */
  if(g.userData.len)g.scale.y=clamp(d/g.userData.len,.55,1.6);
}

class Fighter{
  constructor(name,palette,x,facing,isPlayer,buildKey){
    this.build=BUILDS[buildKey||'musashi']||BUILDS.musashi;
    /* the build owns the costume; the duelist keeps his soul */
    palette=Object.assign({},this.build.palette,
      {face:Object.assign({},this.build.palette.face,(palette&&palette.face)||{})});
    this.name=name; this.isPlayer=isPlayer; this.palette=palette;
    this.weapon=WEAPONS[(isPlayer?SELECT.WP:SELECT.WE)]||WEAPONS.katana;
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
    const kimono=rimify(stdMat(palette.kimono,{roughness:.9,map:kimonoTex||null,
      normalMap:kimonoNrm||null}),.32,.42,.62,3,.5);
    const hakama=rimify(stdMat(palette.hakama,{roughness:.94,map:hakamaTex||null,
      normalMap:hakamaNrm||null}),.3,.38,.58,3,.42);
    const skin=rimify(stdMat(palette.skin,{roughness:.55,map:skinTex||null,
      normalMap:skinNrm||null}),.42,.4,.42,3,.32);
    if(skin.normalMap)skin.normalScale=new THREE.Vector2(.6,.6);
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
      hip.castShadow=true; hip.userData.cover=true;
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
      collar.userData.keep=true;
      parts.chest.add(yokeR,yokeL,collar); }
    parts.abdomen=limbMesh(D.torso*.38,.125,.135,kimono);
    parts.neck=limbMesh(D.neck,.043,.05,skin);
    if(!this.build.bare){ /* the eri: crossed kimono collar */
      const eriM=stdMat(this.palette.accent,{roughness:.85});
      for(const s of [1,-1]){
        const band=new THREE.Mesh(new THREE.BoxGeometry(.02,.15,.012),eriM);
        band.position.set(s*.045,-.05,.062); band.rotation.z=s*.5;
        band.rotation.x=-.15;
        parts.neck.add(band);
      }
    }
    /* elbow joints: the arm bends AROUND something */
    const elbM=this.build.bare?skin:kimono;
    parts.elbowR=new THREE.Mesh(new THREE.SphereGeometry(.036,8,7),elbM);
    parts.elbowL=new THREE.Mesh(new THREE.SphereGeometry(.036,8,7),elbM);
    parts.elbowR.castShadow=parts.elbowL.castShadow=true;
    /* head: skull, jaw, hair, topknot; player wears a hachimaki */
    parts.head=new THREE.Group();
    { const fTex=faceTex(palette.skin,palette.face);
      const faceMat=rimify(stdMat(0xffffff,{map:fTex||null,
        normalMap:skinNrm||null,roughness:.52}),.42,.4,.42,3,.3);
      if(faceMat.normalMap)faceMat.normalScale=new THREE.Vector2(.35,.35);
      const headGeo=new THREE.SphereGeometry(D.headR,26,20);
      headGeo.rotateY(-Math.PI/2);            // painted face looks down +Z
      const skull=new THREE.Mesh(headGeo,fTex?faceMat:skin);
      skull.castShadow=true; skull.scale.set(.92,1.08,.98);
      skull.userData.skull=true;
      const hairC=new THREE.Mesh(
        new THREE.SphereGeometry(D.headR*1.04,14,12,0,Math.PI*2,0,1.6),hairM);
      hairC.scale.set(.94,1.06,1); hairC.rotation.x=-.5;
      const mage=new THREE.Mesh(new THREE.CylinderGeometry(.015,.02,.09,8),hairM);
      mage.position.set(0,.095,-.02); mage.rotation.x=1.1;
      /* the painted face carries the features; geometry keeps only
         what shapes the silhouette: nose, ears, facial hair */
      const F=[];
      const bridge=new THREE.Mesh(new THREE.BoxGeometry(.012,.042,.013),skin);
      bridge.position.set(0,.006,D.headR*.9); bridge.rotation.x=.16;
      const noseTip=new THREE.Mesh(new THREE.SphereGeometry(.0125,8,6),skin);
      noseTip.position.set(0,-.017,D.headR*.95); noseTip.scale.set(1.1,.82,.78);
      const mkEar=(sx)=>{ const e=new THREE.Mesh(new THREE.SphereGeometry(.019,8,6),skin);
        e.position.set(sx*D.headR*.9,-.005,0); e.scale.set(.4,1,.7); F.push(e); };
      mkEar(1); mkEar(-1);
      F.push(bridge,noseTip);
      const fh=(palette.face)||{};
      if(fh.mustache){ const mu=new THREE.Mesh(new THREE.BoxGeometry(.04,.008,.011),hairM);
        mu.position.set(0,-.046,D.headR*.88); F.push(mu); }
      if(fh.beard){ const bd=new THREE.Mesh(new THREE.SphereGeometry(D.headR*.6,10,8),hairM);
        bd.position.set(0,-.078,.024); bd.scale.set(.85,.72,.86); F.push(bd); }
      const HB=this.build.hair;
      if(HB==='pony'){
        mage.visible=false;
        const tie=new THREE.Mesh(new THREE.CylinderGeometry(.02,.023,.035,8),hairM);
        tie.position.set(0,.06,-.075); tie.rotation.x=1.2;
        const tail=new THREE.Mesh(new THREE.CylinderGeometry(.017,.006,.34,8),hairM);
        tail.position.set(0,-.09,-.115); tail.rotation.x=.28;
        F.push(tie,tail);
      } else if(HB==='helmet'){
        hairC.visible=false; mage.visible=false;
        const helm=new THREE.Mesh(
          new THREE.SphereGeometry(D.headR*1.12,16,12,0,Math.PI*2,0,1.9),
          stdMat(0x8a7a58,{roughness:.35,metalness:.6}));
        helm.scale.set(.95,1.05,1.02); helm.position.y=.012;
        const crest=new THREE.Mesh(new THREE.BoxGeometry(.014,.075,.14),
          stdMat(0x8a2020,{roughness:.8}));
        crest.position.y=D.headR*1.1;
        const guard=new THREE.Mesh(new THREE.BoxGeometry(.012,.05,.014),
          stdMat(0x8a7a58,{roughness:.35,metalness:.6}));
        guard.position.set(0,-.01,D.headR*.98);
        F.push(helm,crest,guard);
      }
      if(this.build.bare){ /* the harness across the bare chest */
        const strap=new THREE.Mesh(new THREE.BoxGeometry(.05,.42,.02),
          stdMat(0x3a2a18,{roughness:.85}));
        strap.position.set(.04,-0,-0);
        strap.rotation.z=.6;
        /* mounted on the chest, not the head */
        setTimeout(()=>{ try{ this.parts.chest.add(strap);
          strap.position.set(.01,-.14,.0); }catch(e){} },0);
        const pauld=new THREE.Mesh(new THREE.SphereGeometry(.075,10,8,0,Math.PI*2,0,1.7),
          stdMat(0x8a7a58,{roughness:.4,metalness:.55}));
        setTimeout(()=>{ try{ this.parts.upperArmL.add(pauld);
          pauld.position.set(0,-.03,0); }catch(e){} },0);
      }
      parts.head.add(skull,hairC,mage,...F);
      if(isPlayer){
        const hachi=new THREE.Mesh(new THREE.TorusGeometry(D.headR*.94,.014,6,16),accentM);
        hachi.rotation.x=Math.PI/2+.12; hachi.position.y=.028;
        parts.head.add(hachi);
      }
    }
    /* arms: kimono sleeve flares on the upper arm, bare forearm */
    parts.upperArmR=limbMesh(D.upperArm,.052,.075,kimono);
    parts.upperArmL=limbMesh(D.upperArm,.052,.075,kimono);
    const LB=this.build.limb;
    parts.forearmR=limbMesh(D.foreArm,.052*LB,.042*LB,skin);
    parts.forearmL=limbMesh(D.foreArm,.052*LB,.042*LB,skin);
    /* a HAND: palm, four curled fingers, an opposed thumb.
       pose 'grip' wraps a handle along local +Y; 'fist' closes fully. */
    const mkHand=(pose,mirror)=>{
      const g=new THREE.Group();
      const inner=new THREE.Group();
      g.add(inner);
      /* grip pose: rotate so the finger-curl axis runs ALONG the handle
         (the weapon's +Y), so fingers wrap around it instead of across */
      if(pose==='grip')inner.rotation.z=(mirror?-1:1)*Math.PI/2;
      const gAdd=o=>inner.add(o);
      const s=mirror?-1:1;
      const palm=new THREE.Mesh(new THREE.BoxGeometry(.052,.075,.03),skin);
      palm.position.z=-.024; gAdd(palm);
      const curl=pose==='fist'?1.9:1.25;      // radians of finger wrap
      g.userData.joints=[];
      for(let i=0;i<4;i++){
        const fx=(i-1.5)*.014*s;
        const seg1=new THREE.Mesh(new THREE.BoxGeometry(.0115,.036,.013),skin);
        const j1=new THREE.Group();
        j1.position.set(fx,.038,.006); j1.rotation.x=curl*.55;
        seg1.position.y=.018; j1.add(seg1);
        const j2=new THREE.Group();
        j2.position.y=.036; j2.rotation.x=curl*.7;
        const seg2=new THREE.Mesh(new THREE.BoxGeometry(.0105,.03,.012),skin);
        seg2.position.y=.015; j2.add(seg2); j1.add(j2);
        g.add(j1);
        g.userData.joints.push({j1,j2,ph:i*.7});
      }
      const tj=new THREE.Group();
      tj.position.set(.028*s,-.006,.012);
      tj.rotation.set(pose==='fist'?1.1:.7,0,-.9*s);
      const th1=new THREE.Mesh(new THREE.BoxGeometry(.013,.034,.014),skin);
      th1.position.y=.017; tj.add(th1);
      const th2=new THREE.Mesh(new THREE.BoxGeometry(.012,.026,.013),skin);
      th2.position.y=.045; th2.rotation.x=pose==='fist'?.9:.6; tj.add(th2);
      gAdd(tj);
      g.traverse(o=>{ if(o.isMesh)o.castShadow=true; });
      return g;
    };
    const handPose=this.weapon&&this.weapon.blunt?'fist':'grip';
    parts.handR=mkHand(handPose,false);
    parts.handL=mkHand(handPose,true);
    /* legs: hakama — wide at the knee, gathered at the ankle */
    parts.thighR=limbMesh(D.thigh,.1,.14,hakama);
    parts.thighL=limbMesh(D.thigh,.1,.14,hakama);
    parts.shinR=limbMesh(D.shin,.135,.055,hakama);
    parts.shinL=limbMesh(D.shin,.135,.055,hakama);
    /* tabi feet */
    const tabiM=stdMat(0xd9d5cb,{roughness:.85});
    const strawM=stdMat(0x8a7448,{roughness:.95});
    const buildFootMesh=()=>{
      const g=new THREE.Group();
      /* the foot: instep + rounded heel + toe block, on a sandal sole */
      const instep=new THREE.Mesh(new THREE.BoxGeometry(.088,.055,.16),tabiM);
      instep.position.set(0,.012,.035);
      const heel=new THREE.Mesh(new THREE.SphereGeometry(.045,8,7),tabiM);
      heel.scale.set(.95,.8,1); heel.position.set(0,.012,-.05);
      const toe=new THREE.Mesh(new THREE.BoxGeometry(.082,.042,.06),tabiM);
      toe.position.set(0,.002,.125);
      const sole=new THREE.Mesh(new THREE.BoxGeometry(.095,.016,.24),strawM);
      sole.position.set(0,-.022,.04);
      /* the cuff: rises to tuck under the hakama — no gap, ever */
      const cuff=new THREE.Mesh(new THREE.CylinderGeometry(.052,.058,.13,10),tabiM);
      cuff.position.set(0,.09,-.02);
      g.add(instep,heel,toe,sole,cuff);
      g.traverse(o=>{ if(o.isMesh)o.castShadow=true; });
      return g;
    };
    parts.footR=buildFootMesh(); parts.footL=buildFootMesh();
    for(const k in parts)this.root.add(parts[k]);

    this.katana=weaponMesh(this.weapon); scene.add(this.katana);

    /* continuous skinned body over torso, upper arms, legs */
    this.skin=buildSkinnedBody(this.build.bare?skin:kimono,hakama,this.build);
    scene.add(this.skin.mesh);
    this.buildCloth(rimify(stdMat(this.palette.hakama,{roughness:.94,
      side:THREE.DoubleSide,map:hakamaTex||null}),.3,.38,.58,3,.4));
    this.skinKimono=this.skin.kimono;
    const hideIn=(g,keep)=>g.traverse(o=>{
      if(o.isMesh&&!(keep&&keep(o)))o.visible=false; });
    hideIn(parts.chest,o=>o.userData.keep);
    hideIn(parts.abdomen);
    hideIn(parts.upperArmR,o=>o.userData.end);   // keep the elbow ball
    hideIn(parts.upperArmL,o=>o.userData.end);
    hideIn(parts.thighR); hideIn(parts.thighL);
    hideIn(parts.shinR); hideIn(parts.shinL);
    parts.pelvis.traverse(o=>{ if(o.isMesh&&o.userData.cover)o.visible=false; });
    /* the silhouette: outline everything the eye reads as the fighter */
    addOutline(this.skin.mesh,.009);
    for(const g of [parts.head,parts.forearmR,parts.forearmL,
        parts.handR,parts.handL,parts.footR,parts.footL,parts.pelvis])
      g.traverse(o=>{ if(o.isMesh&&o.visible&&!o.userData.outline)addOutline(o,.006); });

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
      from:V3(),to:V3(),swing:0,dur:.18,lift:0,
      yaw:this.bodyYaw||0,yawFrom:0,settle:0,roll:0});
    this.feet={R:mkFoot(1,.20),L:mkFoot(-1,-.16)};
    this.legDamage={R:0,L:0};
    this.prevVel=V3(); this.leanV=V3();
    this._K={pelvis:V3(),chestB:V3(),chestT:V3(),neckT:V3(),
      shR:V3(),shL:V3(),elR:V3(),elL:V3(),haR:V3(),haL:V3(),
      hipR:V3(),hipL:V3(),knR:V3(),knL:V3(),ankR:V3(),ankL:V3()};

    this.capsules={};
    for(const k in ANATOMY)this.capsules[k]={a:V3(),b:V3(),r:ANATOMY[k].r};

    this.parryEnabled=isPlayer; this.parries=0;
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
      if(this.skinKimono)this.skinKimono.color.copy(this.kimonoMat.color);
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
    if(PHYS.enabled&&this.phys){ this.physDead=true;
      for(const k in this.phys.B)this.phys.B[k].damping=3.5;  // dead weight
      /* the killing blow chooses the performance — modeled OR procedural */
      if(MODELPIPE.enabled&&MODELPIPE.clips){
        const back=this.lastHitDir?
          this.lastHitDir.dot(DIRY(this.bodyYaw))<0:Math.random()<.5;
        const pool=back?['death_back','death_kneel','death_kneel2']
                       :['death_fwd','death_kneel','death_kneel2'];
        for(const c of pool){
          if(!MODELPIPE.clips[c])continue;
          if(this.model&&MODELPIPE.playClip(this,c,.12)){
            this._deathClip=true; this._deathBlend=0; break; }
          if(!this.model&&MODELPIPE.playPuppet(this,c)){
            this._deathClip=true; this._deathBlend=0; break; }
        }
      }
    }
    else this.buildRagdoll();
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
        if(L.bone)this.boneBreak(partKey,hitPoint,hitDir);
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
    this.hasSword=false; this.disposeSwordPhys&&this.disposeSwordPhys();
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
    /* the torn ends: jagged flesh, protruding bone */
    const ua=limb==='armR'?this.parts.upperArmR:this.parts.upperArmL;
    this.stumpAt=attachStump(ua,-this.dims.upperArm,.052);   // on the body
    attachStump(fore,0,.048);                                 // on the piece
    this.severedPieces=this.severedPieces||[];
    this.severedPieces.push({mesh:fore,bleed:1.6,
      vel:V3(hitDir.x*2+rand(-1,1),2.2,hitDir.z*2+rand(-1,1)),
      ang:V3(rand(-6,6),rand(-6,6),rand(-6,6))});
    this.severedPieces.push({mesh:hand,bleed:.5,
      vel:V3(hitDir.x*2+rand(-1,1),2.4,hitDir.z*2+rand(-1,1)),
      ang:V3(rand(-6,6),rand(-6,6),rand(-6,6))});
    if(limb==='armR')this.dropSword(log);
    /* the burst, and the stump keeps pumping */
    emitBlood(hitPoint,V3(0,1,0),5.5,66);
    emitBlood(hitPoint,hitDir,4,30);
    addSquirt(this,limb==='armR'?'upperArmR':'upperArmL',hitPoint,4,2.4);
    this.stumpBleed=3.2;                                      // seconds of pump
  }

  /* mobility multiplier from legs + blood + stamina */
  get mobility(){
    if(this.downT>0)return .12;
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
    if(this.hasSword){ this.hasSword=false;
      this.disposeSwordPhys&&this.disposeSwordPhys(); scene.attach(this.katana);
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
    if(!this.severed.head)P.head.position.copy(J.head.p);
    place(P.upperArmR,'shR','elR');
    if(!this.severed.armR){ place(P.forearmR,'elR','haR'); P.handR.position.copy(J.haR.p); }
    place(P.upperArmL,'shL','elL');
    if(!this.severed.armL){ place(P.forearmL,'elL','haL'); P.handL.position.copy(J.haL.p); }
    place(P.thighR,'hipR','knR'); place(P.shinR,'knR','ftR');
    place(P.thighL,'hipL','knL'); place(P.shinL,'knL','ftL');
    P.footR.position.copy(J.ftR.p); P.footL.position.copy(J.ftL.p);
    _bT.copy(J.pelvis.p).multiplyScalar(2).sub(J.chestB.p);
    this.setBone('pelvis',J.pelvis.p,_bT);
    this.setBone('spine',J.chestB.p,J.pelvis.p);
    this.setBone('chest',J.chestT.p,J.chestB.p);
    this.setBone('uaR',J.shR.p,J.elR.p); this.setBone('uaL',J.shL.p,J.elL.p);
    this.setBone('thR',J.hipR.p,J.knR.p); this.setBone('shR',J.knR.p,J.ftR.p);
    this.setBone('thL',J.hipL.p,J.knL.p); this.setBone('shL',J.knL.p,J.ftL.p);
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
/* Powered-ragdoll overlay: every major joint is a particle spring-tracked
   to its kinematic target. Children are computed FROM softened parents, so
   the chain stays connected; impacts inject velocity and the whole body
   physically absorbs them. */
/* ============ TORQUE-DRIVEN BODY (ZPhys XPBD engine) ============
   A full articulated rigid body per fighter — real masses, real inertia —
   driven by joint motors toward the kinematic pose. Its solution blends
   into the render through the soft layer. PHYS.blend: 0 = pure animation,
   1 = pure physics. PHYS.assist: how hard the balance hand-of-god holds
   the pelvis. Death-by-motor-cutoff is staged for v2; Verlet death stays. */
const PHYS=(typeof ZPhys!=='undefined')?{
  engine:new ZPhys.Engine(), blend:.5, assist:.005, swordBlend:.16, enabled:true,
}:{enabled:false};
if(PHYS.enabled){ PHYS.engine.g.set(0,-9.81,0); PHYS.engine.substeps=6; PHYS.engine.iters=3; }


const ZAN_VERSION='v39';
console.log('%c斬 ZAN '+ZAN_VERSION,'font-size:16px');

/* =========================================================================
   GLB CHARACTER PIPELINE — load any Mixamo-rigged model (models/samurai.glb
   if you provide one, bundled Xbot/Soldier otherwise) and retarget it live:
   our IK + physics joints drive its skeleton in world space every frame.
   Press M to cycle: procedural samurai → loaded models. Browser only.
   ========================================================================= */
/* ================== BUILDS: three fighters, all procedural ============== */
const BUILDS={
  musashi:{label:'武 MUSASHI — ronin',
    sh:1, waist:1, hip:1, limb:1, hair:'topknot', bare:false,
    palette:{kimono:0x2a4a78,hakama:0x18263e,obi:0xe8ddc0,skin:0xd0a684,
      accent:0xf2eee2,face:{}}},
  onna:{label:'鈴 SUZUME — onna-musha',
    sh:.87, waist:.90, hip:1.05, limb:.9, hair:'pony', bare:false,
    palette:{kimono:0x5e2440,hakama:0x241020,obi:0xd8c890,skin:0xdbb394,
      accent:0xf0e6da,face:{feminine:true}}},
  gladiator:{label:'Ω BRUTUS — gladiator',
    sh:1.16, waist:1.06, hip:1.02, limb:1.18, hair:'helmet', bare:true,
    palette:{kimono:0x8a6a48,hakama:0x5a4028,obi:0x3a2a18,skin:0xc09068,
      accent:0xb89858,face:{stubble:true}}},
  sumo:{label:'雷 RAIDEN — sumo',
    sh:1.3, waist:2.05, hip:1.85, limb:1.52, hair:'topknot', bare:true, mass:1.9, cloth:false,
    palette:{kimono:0xd8a880,hakama:0xd8a880,obi:0x1a2a4a,skin:0xd8a880,
      accent:0x1a2a4a,face:{stubble:true}}}};
const WEAPONS={
  katana:    {label:'刀 KATANA',    len:.93, cutFrom:.12, speed:1.0,  maxSpd:1.0,
              effMass:1.0, dmg:1.0, parryWin:1.0, blunt:false, curl:1.28},
  broadsword:{label:'劍 BROADSWORD',len:.99, cutFrom:.14, speed:.76,  maxSpd:.88,
              effMass:1.55,dmg:1.3, parryWin:.85, blunt:false, curl:1.24},
  axe:       {label:'斧 AXE',       len:.74, cutFrom:.42, speed:.58,  maxSpd:.8,
              effMass:2.3, dmg:1.8, parryWin:.6,  blunt:false, curl:1.12},
  bare:      {label:'拳 BARE HANDS',len:.16, cutFrom:0,   speed:1.4, maxSpd:1.25,
              effMass:1.7, dmg:1.25, parryWin:1.2, blunt:true, curl:1.9}};
const SELECT={P:'musashi',E:'musashi',WP:'katana',WE:'katana'};
function pickdbg(t){
  try{ const el=document.getElementById('pickdbg'); if(el)el.textContent=t; }catch(e){}
}
const WLIST=['katana','broadsword','axe','bare'];
const PICKER={
  idx:{P:0,E:0},
  wIdx:{P:0,E:0},
  cycleW(slot,dir){
    this.wIdx[slot]=(this.wIdx[slot]+dir+WLIST.length)%WLIST.length;
    const key=WLIST[this.wIdx[slot]];
    SELECT[slot==='P'?'WP':'WE']=key;
    try{ document.querySelectorAll('[id="selW'+slot+'-name"]')
      .forEach(n=>n.textContent=WEAPONS[key].label); }catch(e){}
    try{ if(game.state==='menu')this.rebuild(slot); }catch(e){}
    pickdbg(slot+' weapon \u2192 '+WEAPONS[key].label);
  },
  rebuild(slot){
    try{
      const isP=slot==='P';
      const old=isP?player:enemy;
      if(!old)return;
      const x=old.pos.x;
      disposeFighter(old);
      const D=DUELISTS[game.stage]||DUELISTS[0];
      const nf=new Fighter(
        isP?BUILDS[SELECT.P].label.split(' \u2014 ')[0]:D.name,
        (!isP&&SELECT.E==='musashi')?D.palette:null,
        x,isP?1:-1,isP,SELECT[slot]);
      if(isP)player=nf; else enemy=nf;
      pickdbg(slot+' \u2192 '+BUILDS[SELECT[slot]].label);
    }catch(e){ pickdbg('rebuild: '+e.message); }
  },
  roster:[
    {label:BUILDS.musashi.label,build:'musashi'},
    {label:BUILDS.onna.label,build:'onna'},
    {label:BUILDS.gladiator.label,build:'gladiator'},
    {label:BUILDS.sumo.label,build:'sumo'}],
  cycle(slot,dir){
    this.idx[slot]=(this.idx[slot]+dir+this.roster.length)%this.roster.length;
    this.apply(slot);
  },
  apply(slot){
    const e=this.roster[this.idx[slot]];
    let el=null;
    try{ document.querySelectorAll('[id="sel'+slot+'-name"]')
      .forEach(n=>{ n.textContent=e.label; el=n; }); }catch(err){}
    if(e.build){
      SELECT[slot]=e.build;
      try{
        if(typeof MODELPIPE!=='undefined'&&MODELPIPE.current)
          MODELPIPE.current[slot]=null;
        if(game.state==='menu')this.rebuild(slot);
        else{ const f=slot==='P'?player:enemy; if(f&&f.setModel)f.setModel(null); }
      }catch(err){ pickdbg('apply: '+err.message); }
    } else if(e.src&&typeof MODELPIPE!=='undefined'&&MODELPIPE.enabled){
      MODELPIPE.load(e.src,g=>{
        if(!g){ if(el)el.textContent=e.label+' (missing)'; return; }
        MODELPIPE.current[slot]=g;
        const f=slot==='P'?player:enemy;
        if(f)f.setModel(g);
      });
    }
  }
};

const MODELPIPE=(()=>{
  const _m=new THREE.Matrix4(), _x=V3(), _y=V3(), _z=V3();
  function boneQuat(from,to,hint,out){
    _y.subVectors(to,from).normalize();
    _z.copy(hint).addScaledVector(_y,-hint.dot(_y));
    if(_z.lengthSq()<1e-6)_z.set(0,0,1).addScaledVector(_y,-_y.z);
    _z.normalize();
    _x.crossVectors(_y,_z);
    _m.makeBasis(_x,_y,_z);
    return out.setFromRotationMatrix(_m);
  }
  if(typeof process!=='undefined'||typeof THREE.GLTFLoader==='undefined')
    return {enabled:false,drive(){},sources:[],boneQuat,
      playClip:()=>false,tickClips:()=>false,playPuppet:()=>false,
      tickPuppet:()=>false,clips:{},current:{P:null,E:null},load(u,cb){cb(null);}};
  const sources=['models/samurai.fbx','models/samurai.glb',
    'models/Old Man.fbx','models/Zombiegirl W Kurniawan.fbx',
    'models/samurai2.glb','models/fighter.glb',
    'models/Xbot.glb','models/Soldier.glb'];

  /* models/index.json (["file.glb",...]) prepends to the cycle */
  const cache={};
  function load(url,cb){
    if(cache[url])return cb(cache[url]);
    if(cache[url]===false)return cb(null);
    const done=g=>{ cache[url]=g; cb(g); };
    const fail=()=>{ cache[url]=false; cb(null); };
    if(/^drop:/.test(url))return cb(cache[url]||null);
    if(/\.fbx$/i.test(url)){
      if(typeof THREE.FBXLoader==='undefined')return fail();
      new THREE.FBXLoader().load(encodeURI(url),obj=>done({scene:obj}),undefined,fail);
    } else {
      new THREE.GLTFLoader().load(encodeURI(url),done,undefined,fail);
    }
  }
  /* bone-name resolution: mixamorig:X, mixamorigX, or bare X */
  /* robust bone resolution: strip punctuation, lowercase, suffix-match.
     handles mixamorig:Hips, mixamorigHips (FBXLoader strips colons),
     mixamorig1_Hips, bare Hips — and rigs whose joints load as plain
     Object3D rather than THREE.Bone. */
  function findBone(root,name){
    const want=name.toLowerCase();
    const clean=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
    let bone=null,node=null;
    root.traverse(o=>{
      if(!o.name)return;
      if(clean(o.name).endsWith(want.replace(/[^a-z0-9]/g,''))){
        if(o.isBone){ if(!bone)bone=o; }
        else if(!o.isMesh&&!node)node=o;
      }
    });
    return bone||node;
  }
  const CORE=['Hips','Spine','Spine1','Spine2','Neck','Head',
    'RightShoulder','RightArm','RightForeArm','RightHand',
    'LeftShoulder','LeftArm','LeftForeArm','LeftHand',
    'RightUpLeg','RightLeg','RightFoot','LeftUpLeg','LeftLeg','LeftFoot'];
  const _qw=new THREE.Quaternion(), _qp=new THREE.Quaternion();
  function attach(f,gltf){
    if(f.model){ scene.remove(f.model.root); }
    const root=THREE.SkeletonUtils?THREE.SkeletonUtils.clone(gltf.scene)
                                  :gltf.scene.clone(true);
    /* scale to fighter height */
    const box=new THREE.Box3().setFromObject(root);
    const h=Math.max(box.max.y-box.min.y,.1);
    const s=1.72/h;
    root.scale.setScalar(s);
    root.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.frustumCulled=false;
      if(o.material){
        const own=m=>{ const c=m.clone();
          c._base=c.color?c.color.clone():null; return c; };
        o.material=Array.isArray(o.material)?o.material.map(own):own(o.material);
      } } });
    const bones={};
    let found=0;
    for(const n of CORE){ bones[n]=findBone(root,n); if(bones[n])found++; }
    if(!bones.Hips){
      /* show what the file actually contains, so the fix is obvious */
      const names=[];
      root.traverse(o=>{ if(names.length<10&&o.name&&!o.isMesh&&
        /hip|spine|arm|leg|head|neck|bone|joint/i.test(o.name))names.push(o.name); });
      if(!names.length)root.traverse(o=>{ if(names.length<8&&o.name)names.push(o.name); });
      log('no rig resolved ('+found+'/'+CORE.length+'). nodes seen: '+
        (names.join(', ')||'none'),false);
      return null;
    }
    if(found<CORE.length)
      log('model rig partial: '+found+'/'+CORE.length+' bones resolved',false);
    let skinned=0; root.traverse(o=>{ if(o.isSkinnedMesh)skinned++; });
    if(!skinned)
      log('rig found but NO skinned mesh — on Mixamo download choose Skin: WITH SKIN',false);
    scene.add(root);
    return {root,bones,scale:s,worldQ:{}};
  }
  /* drive the rig from joint positions (alive: f._K + head; dead: _dj) */
  function drive(f,J){
    const M=f.model; if(!M)return;
    const fwd=DIRY(f.bodyYaw||0);
    const w=MODELPIPE.driveBlend===undefined?1:MODELPIPE.driveBlend;
    const setW=(name,q)=>{ const b=M.bones[name]; if(!b)return;
      const p=b.parent;
      p.getWorldQuaternion(_qp);
      _qp.invert().multiply(q);
      if(w>=1)b.quaternion.copy(_qp);
      else b.quaternion.slerp(_qp,w);
      b.updateMatrixWorld(true);
    };
    /* hips: world position + orientation */
    { const b=M.bones.Hips;
      boneQuat(J.pelvis,J.chestB,fwd,_qw);
      b.parent.updateMatrixWorld(true);
      _x.copy(J.pelvis);
      b.parent.worldToLocal(_x);
      b.position.copy(_x);
      b.parent.getWorldQuaternion(_qp);
      b.quaternion.copy(_qp.invert().multiply(_qw));
      b.updateMatrixWorld(true);
    }
    /* spine chain: distribute pelvis→chestB→chestT→neck */
    _x.lerpVectors(J.pelvis,J.chestB,.55);
    setW('Spine',boneQuat(_x,J.chestB,fwd,_qw));
    setW('Spine1',boneQuat(J.chestB,_y.lerpVectors(J.chestB,J.chestT,.6).clone(),fwd,_qw));
    setW('Spine2',boneQuat(_y,J.chestT,fwd,_qw));
    setW('Neck',boneQuat(J.chestT,J.neckT,fwd,_qw));
    { const top=J.neckT.clone(); top.y+=.16;
      setW('Head',boneQuat(J.neckT,top,fwd,_qw)); }
    /* arms: hint = out+down for natural roll */
    const right=V3(fwd.z,0,-fwd.x);
    const hintR=V3().addScaledVector(right,.6).setY(-.6),
          hintL=V3().addScaledVector(right,-.6).setY(-.6);
    setW('RightShoulder',boneQuat(J.chestT,J.shR,fwd,_qw));
    setW('RightArm',boneQuat(J.shR,J.elR,hintR,_qw));
    setW('RightForeArm',boneQuat(J.elR,J.haR,hintR,_qw));
    if(f.katana&&f.hasSword){ setW('RightHand',
      _qw.copy(f.katana.quaternion).multiply(MODELPIPE._handFix)); }
    setW('LeftShoulder',boneQuat(J.chestT,J.shL,fwd,_qw));
    setW('LeftArm',boneQuat(J.shL,J.elL,hintL,_qw));
    setW('LeftForeArm',boneQuat(J.elL,J.haL,hintL,_qw));
    /* legs: hint = body forward keeps knees forward */
    setW('RightUpLeg',boneQuat(J.hipR,J.knR,fwd,_qw));
    setW('RightLeg',boneQuat(J.knR,J.ankR,fwd,_qw));
    setW('LeftUpLeg',boneQuat(J.hipL,J.knL,fwd,_qw));
    setW('LeftLeg',boneQuat(J.knL,J.ankL,fwd,_qw));
    /* feet: flat, using our locked plant yaw */
    for(const side of ['R','L']){
      const ft=f.feet[side==='R'?'R':'L'];
      const a=side==='R'?J.ankR:J.ankL;
      _x.copy(a).addScaledVector(DIRY(ft.yaw||f.bodyYaw),.16); _x.y=a.y-.05;
      setW(side==='R'?'RightFoot':'LeftFoot',boneQuat(a,_x,V3(0,1,0),_qw));
    }
    /* the cloth remembers the blood */
    if(f.kimonoMat&&M.root){
      const soak=clamp((1-(f.bloodFrac||1))*2.1,0,.85);
      M.root.traverse(o=>{ if(!o.isMesh||!o.material)return;
        const mats=Array.isArray(o.material)?o.material:[o.material];
        for(const m of mats)if(m._base&&m.color)
          m.color.copy(m._base).lerp(f.bloodTint||m._base,soak);
      });
    }
  }
  /* drop a .glb anywhere on the page — it loads and fights immediately */
  addEventListener('dragover',e=>e.preventDefault());
  addEventListener('drop',e=>{
    e.preventDefault();
    const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
    if(!f||!/\.(glb|fbx)$/i.test(f.name))return;
    const isFbx=/\.fbx$/i.test(f.name);
    const rd=new FileReader();
    const use=g=>{ cache['drop:'+f.name]=g;
      PICKER.roster.push({label:f.name.replace(/\.(glb|fbx)$/i,'').toUpperCase(),
        src:'drop:'+f.name});
      PICKER.idx.P=PICKER.roster.length-1; current.P=g;
      if(typeof player!=='undefined'&&player){
        player.setModel(g);
        if(player.model)log('dropped: '+f.name+' — you fight as this now',false);
      }
      const nameEl=document.getElementById('selP-name');
      if(nameEl)nameEl.textContent=PICKER.roster[PICKER.idx.P].label;
    };
    rd.onload=()=>{
      try{
        if(isFbx){
          if(typeof THREE.FBXLoader==='undefined')
            return log('FBXLoader missing',false);
          use({scene:new THREE.FBXLoader().parse(rd.result,'')});
        } else {
          new THREE.GLTFLoader().parse(rd.result,'',use,
            ()=>log('could not parse '+f.name,false));
        }
      }catch(err){ log('could not load '+f.name+': '+err.message,false); }
    };
    rd.readAsArrayBuffer(f);
  });
  /* ---- mocap clips: sheath (after the kill), draw (at the bow) ----
     Skeleton-only Mixamo FBX in models/anims/. Retargeted by bone name
     onto whatever model is active. Combat is never clip-driven — only
     the ritual moments where the simulation has nothing to say. */
  const clips={}, clipRigs={};
  function loadClip(name,url){
    if(typeof THREE.FBXLoader==='undefined')return;
    new THREE.FBXLoader().load(url,obj=>{
      if(obj.animations&&obj.animations.length){
        clips[name]=obj.animations[0];
        clipRigs[name]=obj;                     // its own skeleton = the puppet
        log('animation ready: '+name+' ('+obj.animations[0].duration.toFixed(1)+'s)',false);
      } else log('anim file has no animation: '+url,false);
    },undefined,()=>log('anim missing: '+url,false));
  }
  loadClip('sheath','models/anims/sheath.fbx');
  loadClip('draw','models/anims/draw.fbx');
  loadClip('death_back','models/anims/death_back.fbx');
  loadClip('death_fwd','models/anims/death_fwd.fbx');
  loadClip('death_kneel','models/anims/death_kneel.fbx');
  loadClip('death_kneel2','models/anims/death_kneel2.fbx');
  function playClip(f,name,fade){
    const M=f.model; if(!M||!clips[name])return false;
    try{
      if(!M.mixer)M.mixer=new THREE.AnimationMixer(M.root);
      /* retarget: rebind tracks whose bone names resolve on this rig */
      if(!M._clips)M._clips={};
      if(!M._clips[name]){
        const tracks=[];
        const isDeath=/^death/.test(name);
        for(const t of clips[name].tracks){
          const isHipsPos=/Hips\.position$/.test(t.name);
          if(!/\.quaternion$/.test(t.name)&&!(isDeath&&isHipsPos))continue;
          const bn=t.name.split('.')[0];
          const target=findBone(M.root,bn.replace(/^.*?(Hips|Spine\d?|Neck|Head|Left\w+|Right\w+)$/,'$1')||bn);
          if(target){ const nt=t.clone(); nt.name=target.name+'.'+t.name.split('.').pop();
            if(isHipsPos){
              /* unit detection: match the clip's rest hips height to the rig's */
              const rig=Math.abs(target.position.y)||1;
              const clip0=Math.abs(nt.values[1])||1;
              const k=rig/clip0;
              if(Math.abs(k-1)>.15)for(let i=0;i<nt.values.length;i++)nt.values[i]*=k;
            }
            tracks.push(nt); }
        }
        if(!tracks.length)return false;
        M._clips[name]=new THREE.AnimationClip(name,clips[name].duration,tracks);
      }
      M.mixer.stopAllAction();
      const a=M.mixer.clipAction(M._clips[name]);
      a.setLoop(THREE.LoopOnce); a.clampWhenFinished=true;
      a.reset().fadeIn(fade||.15).play();
      M.clipUntil=performance.now()+clips[name].duration*1000;
      return true;
    }catch(e){ return false; }
  }
  function tickClips(f,dt){
    const M=f.model;
    if(M&&M.mixer&&M.clipUntil){
      if(performance.now()<M.clipUntil){ M.mixer.update(dt); return true; }
      M.clipUntil=0; M.mixer.stopAllAction();
    }
    return false;
  }
  /* ---- puppet: clips drive the procedural samurai too ---- */
  const PUP_MAP={pelvis:'Hips',chestB:'Spine1',chestT:'Spine2',neckT:'Neck',
    shR:'RightArm',elR:'RightForeArm',haR:'RightHand',
    shL:'LeftArm',elL:'LeftForeArm',haL:'LeftHand',
    hipR:'RightUpLeg',knR:'RightLeg',ankR:'RightFoot',
    hipL:'LeftUpLeg',knL:'LeftLeg',ankL:'LeftFoot'};
  const _pw=new THREE.Vector3();
  function playPuppet(f,name){
    if(!clips[name]||!clipRigs[name])return false;
    try{
      if(!f._pup)f._pup={};
      let P=f._pup[name];
      if(!P){
        const rig=THREE.SkeletonUtils?THREE.SkeletonUtils.clone(clipRigs[name])
                                     :clipRigs[name].clone(true);
        rig.visible=false; scene.add(rig);
        const bones={};
        for(const k in PUP_MAP)bones[k]=findBone(rig,PUP_MAP[k]);
        if(!bones.pelvis)return false;
        const mixer=new THREE.AnimationMixer(rig);
        /* measure the puppet's own scale from its rest hips height */
        rig.updateMatrixWorld(true);
        bones.pelvis.getWorldPosition(_pw);
        const k=.9/Math.max(Math.abs(_pw.y),.01);
        P=f._pup[name]={rig,bones,mixer,k};
      }
      P.mixer.stopAllAction();
      const a=P.mixer.clipAction(clips[name]);
      a.setLoop(THREE.LoopOnce); a.clampWhenFinished=true;
      a.reset().play();
      f._pupPlay={P,until:performance.now()+clips[name].duration*1000,
        origin:f.pos.clone(),yaw:f.bodyYaw||0};
      return true;
    }catch(e){ return false; }
  }
  /* advance the puppet and write its joints into a target set */
  function tickPuppet(f,dt,out){
    const pp=f._pupPlay; if(!pp)return false;
    if(performance.now()>=pp.until){ f._pupPlay=null; return false; }
    pp.P.mixer.update(dt);
    pp.P.rig.updateMatrixWorld(true);
    const cy=Math.cos(pp.yaw), sy=Math.sin(pp.yaw), k=pp.P.k;
    for(const key in PUP_MAP){
      const b=pp.P.bones[key]; if(!b||!out[key])continue;
      b.getWorldPosition(_pw); _pw.multiplyScalar(k);
      /* clip faces +Z: rotate into the fighter's facing, plant at his feet */
      out[key].set(pp.origin.x+_pw.x*cy+_pw.z*sy, _pw.y,
                   pp.origin.z-_pw.x*sy+_pw.z*cy);
    }
    return true;
  }
  const current={P:null,E:null};
  return {enabled:true,sources,load,attach,drive,boneQuat,playClip,tickClips,clips,
    playPuppet,tickPuppet,current,
    _handFix:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2),
    mode:0};
})();

const _pq=new THREE.Quaternion(), _pv=V3(), _pv2=V3();
function mkTargetQ(from,to,q){ _pv.subVectors(to,from).normalize();
  return q.setFromUnitVectors(UPV,_pv); }

Fighter.prototype.buildPhys=function(kin){
  if(!PHYS.enabled)return;
  const E=PHYS.engine, mkB=(name,top,bot,mass,r)=>{
    const len=Math.max(top.distanceTo(bot),.08);
    const b=new ZPhys.Body({pos:_pv.addVectors(top,bot).multiplyScalar(.5).clone(),
      mass,r,len,damping:.9});
    mkTargetQ(top,bot,b.q); b.name=this.name+'.'+name;
    E.add(b); return b; };
  const K=kin;
  const B={
    pelvis:mkB('pelvis',_pv2.copy(K.pelvis).setY(K.pelvis.y+.1),
      _pv2.clone().setY(K.pelvis.y-.1),11,.13),
    chest:mkB('chest',K.neckT,K.chestB,19,.14),
    uaR:mkB('uaR',K.shR,K.elR,2.2,.05), uaL:mkB('uaL',K.shL,K.elL,2.2,.05),
    faR:mkB('faR',K.elR,K.haR,1.9,.045), faL:mkB('faL',K.elL,K.haL,1.9,.045),
    thR:mkB('thR',K.hipR,K.knR,8,.09), thL:mkB('thL',K.hipL,K.knL,8,.09),
    shR:mkB('shR',K.knR,K.ankR,5,.06), shL:mkB('shL',K.knL,K.ankL,5,.06),
  };
  E.joint(B.pelvis,B.chest,K.chestB);
  E.joint(B.chest,B.uaR,K.shR); E.joint(B.chest,B.uaL,K.shL);
  E.joint(B.uaR,B.faR,K.elR); E.joint(B.uaL,B.faL,K.elL);
  E.joint(B.pelvis,B.thR,K.hipR); E.joint(B.pelvis,B.thL,K.hipL);
  E.joint(B.thR,B.shR,K.knR); E.joint(B.thL,B.shL,K.knL);
  /* anatomy as safety rails: wider than any pose, tighter than absurdity.
     the trunk's tautness comes from the motors; limits stop the folding */
  E.limit(B.pelvis,B.chest,.5);                  // ~29° waist swing max
  E.limit(B.chest,B.uaR,2.6); E.limit(B.chest,B.uaL,2.6);
  E.limit(B.uaR,B.faR,2.5); E.limit(B.uaL,B.faL,2.5);
  E.limit(B.pelvis,B.thR,1.9); E.limit(B.pelvis,B.thL,1.9);
  E.limit(B.thR,B.shR,2.4); E.limit(B.thL,B.shL,2.4);
  const M={}, comp={pelvis:.00015,chest:.0002,uaR:.0014,uaL:.0014,
    faR:.0018,faL:.0018,thR:.0006,thL:.0006,shR:.0009,shL:.0009};
  for(const k in B){ M[k]=E.motor(B[k]); M[k].compliance=comp[k];
    M[k].maxCorr=(k==='chest'||k==='pelvis')?.45:.3;
    M[k]._c0=M[k].compliance; M[k]._m0=M[k].maxCorr; }
  /* fighters collide with each other, never with themselves */
  PHYS._grp=(PHYS._grp||0)+1;
  for(const k in B)B[k].group=PHYS._grp;
  /* the sword is steel with real mass in a real hand */
  if(this.hasSword&&this.tip){
    const grip=K.haR, tipd=_pv2.subVectors(this.tip,grip);
    if(tipd.lengthSq()>.04){
      const sw=new ZPhys.Body({pos:_pv.addVectors(this.tip,grip).multiplyScalar(.5).clone(),
        mass:1.1,r:.015,len:Math.max(tipd.length(),.6),damping:.5});
      mkTargetQ(this.tip,grip,sw.q);
      sw.noCollide=true; sw.group=PHYS._grp; sw.name=this.name+'.sword';
      E.add(sw); B.sword=sw;
      E.joint(B.faR,sw,grip);
      M.sword=E.motor(sw); M.sword.compliance=.0011; M.sword.maxCorr=.6;
      M.sword._c0=.0011; M.sword._m0=.6;
    }
  }
  const A=E.anchor(B.pelvis,V3(0,0,0)); A.compliance=PHYS.assist;
  /* remember where the joints live on each body */
  const L={}; const cap=(n,body,w)=>{ L[n]={body,l:body.toLocal(w,V3())}; };
  cap('chestB',B.chest,K.chestB); cap('chestT',B.chest,K.chestT);
  cap('neckT',B.chest,K.neckT);
  cap('shR',B.chest,K.shR); cap('shL',B.chest,K.shL);
  cap('elR',B.faR,K.elR); cap('elL',B.faL,K.elL);
  cap('knR',B.shR,K.knR); cap('knL',B.shL,K.knL);
  { const bm=(this.build&&this.build.mass)||1;
    if(bm!==1)for(const k in B)if(k!=='sword'&&B[k].invMass>0)B[k].invMass/=bm; }
  this.phys={B,M,A,L};
};
const _com=V3(), _cv=V3(), _be=V3(), _bq=new THREE.Quaternion();
Fighter.prototype.physTargets=function(K,dt){
  if(!this.phys)return;
  const {M,A,B}=this.phys;
  /* motor strength: consciousness browns the motors out; death cuts them.
     a dying man's sword arm droops before he knows he's done */
  let s;
  if(this.alive)s=clamp(this.consciousness/100,.3,1);
  else{ this._deadFade=this._deadFade===undefined?1:Math.max(0,this._deadFade-(dt||.016)*.9);
    s=this._deadFade; A.enabled=false; }
  for(const k in M){ const m=M[k];
    if(s<=0){ m.enabled=false; continue; }
    m.enabled=true;
    m.compliance=m._c0/(s*s); m.maxCorr=m._m0*s; }
  /* SIMBICON-lite: com error against the support line feeds corrective
     velocity (capped virtual force) and an ankle-strategy target tilt */
  if(this.alive&&dt){
    _com.set(0,0,0); _cv.set(0,0,0); let mt=0;
    for(const k in B){ const b=B[k]; if(b.invMass===0)continue;
      const m=1/b.invMass; mt+=m;
      _com.addScaledVector(b.pos,m); _cv.addScaledVector(b.vel,m); }
    _com.divideScalar(mt); _cv.divideScalar(mt);
    _be.addVectors(this.feet.R.p,this.feet.L.p).multiplyScalar(.5);
    _be.subVectors(_com,_be); _be.y=0;
    _be.addScaledVector(_cv.setY(0),.22);
    _be.clampLength(0,.5);
    const g=8;
    B.pelvis.vel.addScaledVector(_be,-dt*g);
    B.chest.vel.addScaledVector(_be,-dt*g*.7);
    /* ankle strategy: shins lean the body back over its feet */
    const mag=Math.min(_be.length()*1.2,.2);
    if(mag>.01){
      _cv.set(_be.z,0,-_be.x).normalize();       // axis ⊥ error
      _bq.setFromAxisAngle(_cv,mag);
      M.shR.target.premultiply(_bq); M.shL.target.premultiply(_bq);
    }
  }
  mkTargetQ(_pv2.copy(K.pelvis).setY(K.pelvis.y+.1),
    _pv2.clone().setY(K.pelvis.y-.1),M.pelvis.target);
  mkTargetQ(K.neckT,K.chestB,M.chest.target);
  mkTargetQ(K.shR,K.elR,M.uaR.target); mkTargetQ(K.shL,K.elL,M.uaL.target);
  mkTargetQ(K.elR,K.haR,M.faR.target); mkTargetQ(K.elL,K.haL,M.faL.target);
  mkTargetQ(K.hipR,K.knR,M.thR.target); mkTargetQ(K.hipL,K.knL,M.thL.target);
  mkTargetQ(K.knR,K.ankR,M.shR.target); mkTargetQ(K.knL,K.ankL,M.shL.target);
  if(M.sword&&this.hasSword&&this.tip)mkTargetQ(this.tip,K.haR,M.sword.target);
  A.target.copy(K.pelvis);
};
Fighter.prototype.disposeSwordPhys=function(){
  if(!this.phys||!this.phys.B.sword)return;
  const E=PHYS.engine, sw=this.phys.B.sword;
  E.bodies=E.bodies.filter(b=>b!==sw);
  E.joints=E.joints.filter(j=>j.a!==sw&&j.b!==sw);
  E.motors=E.motors.filter(m=>m.body!==sw);
  delete this.phys.B.sword; delete this.phys.M.sword;
};
const _dj={};
'pelvis chestB chestT neckT shR shL elR elL haR haL hipR hipL knR knL ankR ankL'
  .split(' ').forEach(k=>_dj[k]=V3());
const _pj2={};
'pelvis chestB chestT neckT shR shL elR elL haR haL hipR hipL knR knL ankR ankL'
  .split(' ').forEach(k=>_pj2[k]=V3());
Fighter.prototype.renderJoints=function(_dj){
  const P=this.parts, B=this.phys?this.phys.B:null;
  P.pelvis.position.copy(_dj.pelvis); P.pelvis.quaternion.copy(B.pelvis.q);
  aimLimb(P.abdomen,_dj.chestB,_dj.pelvis);
  aimLimb(P.chest,_dj.chestT,_dj.chestB);
  aimLimb(P.neck,_dj.neckT,_dj.chestT);
  if(!this.severed.head){
    P.head.position.copy(_dj.neckT); P.head.position.y+=this.dims.headR*.7; }
  aimLimb(P.upperArmR,_dj.shR,_dj.elR); aimLimb(P.forearmR,_dj.elR,_dj.haR);
  aimLimb(P.upperArmL,_dj.shL,_dj.elL); aimLimb(P.forearmL,_dj.elL,_dj.haL);
  P.handR.position.copy(_dj.haR); P.handL.position.copy(_dj.haL);
  aimLimb(P.thighR,_dj.hipR,_dj.knR); aimLimb(P.shinR,_dj.knR,_dj.ankR);
  aimLimb(P.thighL,_dj.hipL,_dj.knL); aimLimb(P.shinL,_dj.knL,_dj.ankL);
  P.footR.position.copy(_dj.ankR); P.footR.position.y=Math.max(P.footR.position.y,.03);
  P.footL.position.copy(_dj.ankL); P.footL.position.y=Math.max(P.footL.position.y,.03);
  /* skinned bones follow the corpse */
  TMP2.copy(_dj.pelvis).multiplyScalar(2).sub(_dj.chestB);
  this.setBone('pelvis',_dj.pelvis,TMP2);
  this.setBone('spine',_dj.chestB,_dj.pelvis);
  this.setBone('chest',_dj.chestT,_dj.chestB);
  this.setBone('uaR',_dj.shR,_dj.elR); this.setBone('uaL',_dj.shL,_dj.elL);
  this.setBone('thR',_dj.hipR,_dj.knR); this.setBone('shR',_dj.knR,_dj.ankR);
  this.setBone('thL',_dj.hipL,_dj.knL); this.setBone('shL',_dj.knL,_dj.ankL);
  /* the sword falls with the hand that held it */
  if(B.sword&&this.hasSword){
    this.katana.position.copy(_dj.haR);
    TMP1.set(0,1,0).applyQuaternion(B.sword.q);
    this.katana.quaternion.setFromUnitVectors(UPY,TMP1);
  }
};
Fighter.prototype.sleepCorpse=function(){
  if(this._asleep)return; this._asleep=true;
  for(const k in this.phys.B){ const b=this.phys.B[k];
    b._wakeInv=b.invMass; b.invMass=0;
    b.vel.set(0,0,0); b.angVel&&b.angVel.set(0,0,0);
  }
};
Fighter.prototype.wakeCorpse=function(){
  if(!this._asleep)return; this._asleep=false; this._calm=0;
  for(const k in this.phys.B){ const b=this.phys.B[k];
    if(b._wakeInv!==undefined)b.invMass=b._wakeInv;
  }
};
Fighter.prototype.updateDeadPhys=function(dt){
  const {B}=this.phys, P=this.parts;
  if(!this._asleep){
    this.physTargets(this._K,dt);        // continues the brown-out fade
    /* a corpse that has settled goes truly still — no solver jitter,
       no twitching under the victor's feet */
    let v2=0;
    for(const k in B){ const b=B[k];
      v2=Math.max(v2,b.vel.lengthSq()); }
    this._calm=(v2<.09)?(this._calm||0)+dt:0;
    /* only a FALLEN body sleeps — never freeze a corpse on its feet */
    if(this._calm>.8&&!this._deathClip&&B.pelvis.pos.y<.5)this.sleepCorpse();
  }
  /* procedural performance: puppet drives the joints over the sim */
  if(!this.model&&this._deathClip){
    if(MODELPIPE.tickPuppet(this,dt,_pj2)){
      if(!this._lastPup){ this._lastPup={};
        for(const k in _pj2)this._lastPup[k]=_pj2[k].clone(); }
      for(const k in _pj2)this._lastPup[k].copy(_pj2[k]);
      this.renderJoints(_pj2);
      this.pos.set(_pj2.pelvis.x,0,_pj2.pelvis.z);
      return;
    }
    this._deathClip=false; this._deathBlend=0;
  }
  if(!this.model&&this._deathBlend!==undefined&&this._deathBlend<1)
    this._deathBlend=Math.min(1,this._deathBlend+dt*1.6);
  /* joints from the rigid bodies */
  this.physJoint('chestB',_dj.chestB); this.physJoint('chestT',_dj.chestT);
  /* (fall through to render below) */
  this.physJoint('neckT',_dj.neckT);
  this.physJoint('shR',_dj.shR); this.physJoint('shL',_dj.shL);
  this.physJoint('elR',_dj.elR); this.physJoint('elL',_dj.elL);
  this.physJoint('knR',_dj.knR); this.physJoint('knL',_dj.knL);
  _dj.pelvis.copy(B.pelvis.pos);
  TMP1.set(0,-B.faR.len/2,0); B.faR.toWorld(TMP1,_dj.haR);
  TMP1.set(0,-B.faL.len/2,0); B.faL.toWorld(TMP1,_dj.haL);
  TMP1.set(0,B.thR.len/2,0); B.thR.toWorld(TMP1,_dj.hipR);
  TMP1.set(0,B.thL.len/2,0); B.thL.toWorld(TMP1,_dj.hipL);
  TMP1.set(0,-B.shR.len/2,0); B.shR.toWorld(TMP1,_dj.ankR);
  TMP1.set(0,-B.shL.len/2,0); B.shL.toWorld(TMP1,_dj.ankL);
  /* the acted pose melts into the physical one */
  if(!this.model&&this._lastPup&&this._deathBlend!==undefined&&this._deathBlend<1){
    for(const k in _dj)if(this._lastPup[k])
      _dj[k].lerpVectors(this._lastPup[k],_dj[k],this._deathBlend);
  }
  this.renderJoints(_dj);
  this.tickCloth(dt,_dj);
  /* pools follow the corpse */
  this.pos.set(_dj.pelvis.x,0,_dj.pelvis.z);
  if(this.model){
    if(this._deathClip&&MODELPIPE.tickClips(this,dt))return; // the performance
    if(this._deathClip){ this._deathClip=false; this._deathBlend=0; }
    if(this._deathBlend!==undefined&&this._deathBlend<1){
      this._deathBlend=Math.min(1,this._deathBlend+dt*1.6);
      MODELPIPE.driveBlend=this._deathBlend;   // melt from acted pose to physics
    }
    MODELPIPE.drive(this,_dj);
    MODELPIPE.driveBlend=1;
  }
};
Fighter.prototype.setModel=function(gltf){
  if(!MODELPIPE.enabled)return;
  if(!gltf){ // back to the procedural samurai
    if(this.model){ scene.remove(this.model.root); this.model=null; }
    this.root.visible=true;
    if(this.skin)this.skin.mesh.visible=true;
    return;
  }
  const m=MODELPIPE.attach(this,gltf);
  if(!m)return;
  this.model=m;
  this.root.visible=false;             // hide procedural body...
  if(this.skin)this.skin.mesh.visible=false;
  this.katana.visible=true;            // ...but the steel is always ours
};
Fighter.prototype._bob=function(y){ return y+(this.previewBob||0); };
Fighter.prototype.tickFingers=function(dt){
  const W=this.weapon||WEAPONS.katana;
  const effort=clamp(this.bladeSpeed/9,0,1)*.28;         // hard swings squeeze
  const clutch=(this._ritualGrabL||this._ritualGrabR)?.5:0;   // taking the head
  const dying=1-clamp(this.consciousness/100,.2,1);
  let target=(W.curl||1.28)+effort+clutch-dying*.45;     // dying hands loosen
  target=clamp(target,.55,2.0);
  const k=clamp(dt*9,0,1);
  for(const hand of [this.parts.handR,this.parts.handL]){
    const J=hand&&hand.userData&&hand.userData.joints;
    if(!J)continue;
    for(const f of J){
      const t=target+Math.sin(this.breath*2.1+f.ph)*.03; // fingers are never still
      f.j1.rotation.x+=(t*.55-f.j1.rotation.x)*k;
      f.j2.rotation.x+=(t*.7-f.j2.rotation.x)*k;
    }
  }
};
Fighter.prototype.physJoint=function(k,out){
  const j=this.phys&&this.phys.L[k];
  if(!j)return null;
  return j.body.toWorld(j.l,out);
};
Fighter.prototype._preImpulseWake=function(){ if(this._asleep)this.wakeCorpse(); };
Fighter.prototype.physImpulse=function(partKey,dir,J){
  if(!this.phys)return;
  this._preImpulseWake&&this._preImpulseWake();
  const map={head:'chest',neck:'chest',chest:'chest',abdomen:'pelvis',pelvis:'pelvis',
    upperArmR:'uaR',forearmR:'faR',upperArmL:'uaL',forearmL:'faL',
    thighR:'thR',shinR:'shR',thighL:'thL',shinL:'shL'};
  const b=this.phys.B[map[partKey]||'chest'];
  b.vel.addScaledVector(dir,J*b.invMass);
  b.w.x+=rand(-1,1)*J*.15; b.w.z+=rand(-1,1)*J*.15;
};
Fighter.prototype.disposePhys=function(){
  if(!this.phys)return;
  const E=PHYS.engine, {B}=this.phys;
  E.bodies=E.bodies.filter(b=>!Object.values(B).includes(b));
  E.joints=E.joints.filter(j=>!Object.values(B).includes(j.a)&&!Object.values(B).includes(j.b));
  E.motors=E.motors.filter(m=>!Object.values(B).includes(m.body));
  E.anchors=E.anchors.filter(a=>!Object.values(B).includes(a.body));
  E.limits=E.limits.filter(l=>!Object.values(B).includes(l.a)&&!Object.values(B).includes(l.b));
  this.phys=null;
};

const _sT=V3();
const _pj=V3();
Fighter.prototype.soften=function(k,v,rate,dt){
  /* the torque-driven body's opinion blends into the target;
     the trunk stays taut, the limbs carry the physics */
  if(PHYS.enabled&&this.phys&&this.alive&&this.physJoint(k,_pj)){
    let wgt=(k==='chestB'||k==='chestT'||k==='neckT')?.35:1;
    /* a committed cut is pure intent: physics lag yields to the swing,
       then reclaims the follow-through and the quiet moments */
    if(k==='elR'||k==='elL'||k==='shR'||k==='shL')
      wgt*=1-clamp(this.bladeSpeed/9,0,.8);
    if(_pj.distanceToSquared(v)<.36)v.lerp(_pj,PHYS.blend*wgt);
  }
  const S=this.soft||(this.soft={});
  let s=S[k]; if(!s){ s=S[k]={p:v.clone(),vel:V3()}; }
  s.vel.multiplyScalar(Math.exp(-6.5*dt));
  s.p.addScaledVector(s.vel,dt);
  s.p.lerp(v,1-Math.exp(-rate*dt));
  _sT.subVectors(s.p,v);
  if(_sT.lengthSq()>.09){ _sT.clampLength(0,.3); s.p.copy(v).add(_sT); } // never detach
  v.copy(s.p);
};
const SOFTMAP={head:'neckT',neck:'neckT',chest:'chestT',abdomen:'chestB',
  pelvis:'chestB',upperArmR:'shR',forearmR:'elR',upperArmL:'shL',forearmL:'elL',
  thighR:'knR',shinR:'knR',thighL:'knL',shinL:'knL'};
Fighter.prototype.softHit=function(k,dir,mag){
  if(this.soft&&this.soft[k])
    this.soft[k].vel.addScaledVector(dir,mag).clampLength(0,5);
};

const _bT=V3();
Fighter.prototype.setBone=function(name,from,to){
  const b=this.skin.bones[this.skin.BONES[name]];
  b.position.copy(from);
  _bT.subVectors(to,from).normalize();
  b.quaternion.setFromUnitVectors(UPV,_bT);
};
Fighter.prototype.setPelvisBone=function(p,yaw){
  const b=this.skin.bones[this.skin.BONES.pelvis];
  b.position.copy(p); b.quaternion.setFromAxisAngle(UPY,yaw);
};

/* CoM-led stepping: the body falls where it's going; a foot reaches out
   to catch it. Planted feet are locked — position AND yaw — until they
   step again. Heel strikes first, sole settles, toe pushes off. */
Fighter.prototype.stepFoot=function(f,target,dt,otherPlanted,disabled,speed2d,urgent){
  const dmg=f===this.feet.R?this.legDamage.R:this.legDamage.L;
  const thresh=(disabled?.34:clamp(.125-speed2d*.012,.085,.125))+dmg*.06;
  if(f.swing>0){
    f.swing=Math.min(1,f.swing+dt/f.dur);
    const t=f.swing, ss=minJerk(t);
    f.p.lerpVectors(f.from,f.to,ss);
    f.lift=disabled?0:minJerkBell(t)*(clamp(.05+speed2d*.02,.05,.09)+(this.snowDepth||0)*.6)*(1-dmg*.55);
    f.yaw=lerpAngle(f.yawFrom,this.bodyYaw,ss);   // foot re-aims only in flight
    /* toe-off then heel-first: rotation profile over the swing */
    f.roll= t<.25 ? .38*minJerk(t/.25)
          : t<.75 ? lerp(.38,-.22,minJerk((t-.25)/.5))
          : lerp(-.22,-.14,minJerk((t-.75)/.25));
    if(disabled&&groundMark&&f.p.distanceToSquared(f.from)>.002)
      groundMark.drag(f.from.x,f.from.z,f.p.x,f.p.z);
    if(f.swing>=1){ f.swing=0; f.lift=0; f.settle=.09;
      Sound.step&&Sound.step(speed2d);
      if(!disabled&&groundMark&&!onIce(f.p))groundMark.foot(f.p.x,f.p.z,f.yaw); }
  } else {
    f.lift=0;
    if(f.settle>0){ f.settle-=dt; f.roll=lerp(0,-.14,clamp(f.settle/.09,0,1)); }
    else f.roll=0;
    const yawErr=Math.abs(angDiff(this.bodyYaw,f.yaw));
    const need=f.p.distanceTo(target)>thresh || yawErr>.72 || urgent;
    if(otherPlanted && need){
      f.swing=1e-4; f.from=f.p.clone(); f.yawFrom=f.yaw;
      f.to=target.clone(); f.to.y=0;
      const hurt=1+dmg*.8+(disabled?1.2:0)+(this.snowDepth||0)*1.6;
      f.dur=clamp((urgent?.12:.2)-speed2d*.02,.1,.2)*hurt/Math.max(this.mobility,.35);
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
  const depth=snowDepth(this.pos.x,this.pos.z);
  const iced=onIce(this.pos);
  this.vel.multiplyScalar(Math.pow(iced?.28:.0008,dt));   // ice barely grips
  if(!iced)this.vel.multiplyScalar(Math.exp(-depth*2.6*dt)); // deep snow drags
  const sp2=Math.hypot(this.vel.x,this.vel.z);
  if(sp2>.4)this.stamina=Math.max(0,this.stamina-sp2*depth*2.0*dt);
  if(iced&&sp2>1.5&&Math.random()<dt*.55){
    this.stagger=(this.stagger||0)+.55;
    if(!this._slipped){ this._slipped=true; log(this.name+' slips on the ice!',false); }
  }
  this.snowDepth=depth; this.iced=iced;
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

  /* ritual moments: a mocap puppet may own this body */
  if(this._pupPlay&&(game.state==='over'||game.introT>0)){
    if(MODELPIPE.tickPuppet(this,dt,_pj2)){ this.renderJoints(_pj2); return; }
    this._pupPlay=null;
  }

  const fwd=DIRY(this.bodyYaw), right=V3(fwd.z,0,-fwd.x);

  /* guard freshness: a block raised in the last instant is a PARRY */
  if(this.guarding&&!this._wasGuard)this.guardStart=performance.now();
  this._wasGuard=this.guarding;
  this.guardFresh=this.guarding&&(performance.now()-this.guardStart)
    <185*((this.weapon&&this.weapon.parryWin)||1);

  /* hip drive: lateral sword momentum rotates the trunk */
  const latV=this.tipVel.dot(right);
  const prevTwist=this.twist;
  this.twist=lerp(this.twist,clamp(latV*.045,-.55,.55),clamp(dt*9,0,1));
  const twistRate=Math.abs(this.twist-prevTwist)/Math.max(dt,1e-4);
  /* kinetic chain: cut power comes from the whole body, not the wrists.
     off-balance = weak; mid-step = weak; hips driving = strong */
  const planted=this.feet.R.swing===0&&this.feet.L.swing===0;
  this.chainMul=(1-clamp((this.balanceErr||0)*1.9,0,.35))
    *(planted?1.06:.88)
    *(1+clamp(twistRate*.09,0,.16));
  /* stagger: enough shock drives a man to his knee */
  this.stagger=Math.max(0,(this.stagger||0)-dt*.9);
  if(this.stagger>1&&!(this.downT>0)){
    this.stagger=0; this.downT=1.5+rand(0,.5);
    log(this.name+' is driven to a knee!',false);
    Sound.thump&&Sound.thump(.8);
  }
  if(this.downT>0)this.downT-=dt;
  const kneel=this.downT>0?clamp(this.downT>.45?1:this.downT/.45,0,1):0;
  this.kneel=kneel;

  /* ---- CoM-led stepping: predict where the mass is falling, catch it ---- */
  const ft=this.feet;
  /* acceleration → anticipation lean (the body leans before it moves) */
  TMP3.subVectors(this.vel,this.prevVel).divideScalar(Math.max(dt,1e-4));
  this.prevVel.copy(this.vel);
  TMP3.clampLength(0,14).multiplyScalar(.004).addScaledVector(this.vel,.009);
  this.leanV.lerp(TMP3,clamp(dt*5,0,1)); this.leanV.y=0;
  /* inverted-pendulum catch point ~0.26s ahead */
  const catchPt=TMP4.copy(this.pos).addScaledVector(this.vel,.26);
  const stride=clamp(speed2d*.15,0,.26);
  const vdir=speed2d>.3?TMP3.copy(this.vel).setY(0).normalize():fwd;
  const tgtR=catchPt.clone().addScaledVector(right,.17).addScaledVector(fwd,.16)
    .addScaledVector(vdir,stride*(1-this.legDamage.R*.5));
  const tgtL=catchPt.clone().addScaledVector(right,-.17).addScaledVector(fwd,-.12)
    .addScaledVector(vdir,stride*(1-this.legDamage.L*.5));
  /* balance: if the CoM escapes the support line, an urgent catch-step */
  let urgR=false,urgL=false;
  if(ft.R.swing===0&&ft.L.swing===0){
    const ax=ft.L.p, bx=ft.R.p;
    TMP2.subVectors(bx,ax); const L2=Math.max(TMP2.lengthSq(),1e-6);
    TMP3.subVectors(this.pos,ax);
    const tt=clamp(TMP3.dot(TMP2)/L2,0,1);
    TMP3.addScaledVector(TMP2,-tt); TMP3.y=0;
    this.balanceErr=Math.max(0,TMP3.length()-.06);
    if(TMP3.length()>.19){                       // outside the support strip
      if(TMP3.dot(right)>0)urgR=true; else urgL=true;
    }
  } else this.balanceErr=(this.balanceErr||0)*.9;
  this.stepFoot(ft.R,tgtR,dt,ft.L.swing===0,this.disabled.legR,speed2d,urgR);
  this.stepFoot(ft.L,tgtL,dt,ft.R.swing===0,this.disabled.legL,speed2d,urgL);
  const stepping=ft.R.swing>0||ft.L.swing>0;

  /* pelvis rides between the feet — visible weight transfer */
  const feetMid=TMP2.addVectors(ft.R.p,ft.L.p).multiplyScalar(.5);
  let hurtSag=(this.disabled.legR?.15:0)+(this.disabled.legL?.15:0)
    +lerp(.1,0,clamp(this.bloodFrac,0,1));
  /* limp: sag when weight is on the damaged leg (other foot in flight) */
  if(ft.L.swing>0)hurtSag+=this.legDamage.R*.055;
  if(ft.R.swing>0)hurtSag+=this.legDamage.L*.055;
  hurtSag+=(this.kneel||0)*.34;   // driven to a knee
  /* nobody stands perfectly still: weight drifts foot to foot */
  const spd2=Math.hypot(this.vel.x,this.vel.z);
  const idle=spd2<.2&&this.tipVel.lengthSq()<4&&!this.stun;
  this.idleT=idle?(this.idleT||0)+dt:0;
  const swayT=idle?Math.sin(this.breath*.55)*.02+Math.sin(this.breath*.19)*.013:0;
  this._sway=lerp(this._sway||0,swayT,clamp(dt*1.5,0,1));
  if(this.idleT>(this._nextShift||5)){       // an honest little repositioning step
    this._nextShift=this.idleT+4+Math.random()*3.5;
    this.vel.x+=rand(-.3,.3); this.vel.z+=rand(-.22,.22);
  }
  const pelvisY=D.pelvisY-hurtSag-(stepping?.02:0)+Math.sin(this.breath*1.6)*.007+(this.previewBob||0);
  const pelvis=V3(lerp(feetMid.x,this.pos.x,.55),pelvisY,lerp(feetMid.z,this.pos.z,.55));
  const pelvisYawA=this.bodyYaw+this.twist*.3;
  const fwdP=DIRY(pelvisYawA), rightP=V3(fwdP.z,0,-fwdP.x);
  pelvis.addScaledVector(rightP,this._sway||0);

  /* flinch spring: hits ripple through the trunk */
  this.flinchV.addScaledVector(this.flinch,-140*dt).addScaledVector(this.flinchV,-12*dt);
  this.flinch.addScaledVector(this.flinchV,dt);

  /* spine: pelvis → abdomen → chest, distributing lean and twist */
  const lean=clamp(.04+this.tipVel.length()*.007+speed2d*.016,0,.12);
  const chestYawA=this.bodyYaw+this.twist*.8;
  const fwdC=DIRY(chestYawA), rightC=V3(fwdC.z,0,-fwdC.x);
  const chestB=pelvis.clone().addScaledVector(fwdP,.03+lean*.3)
    .addScaledVector(this.flinch,.6).addScaledVector(this.leanV,.45);
  chestB.y=pelvisY+.17;
  this.soften('chestB',chestB,52,dt);
  const chestT=chestB.clone().addScaledVector(fwdC,lean).add(this.flinch)
    .add(this.leanV);
  chestT.y=chestB.y+D.torso*.62;
  this.soften('chestT',chestT,42,dt);
  const neckT=chestT.clone().addScaledVector(fwdC,.02); neckT.y=chestT.y+D.neck+.02;
  this.soften('neckT',neckT,34,dt);

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
  this.setPelvisBone(pelvis,pelvisYawA);
  this.setBone('spine',chestB,pelvis);
  this.setBone('chest',chestT,chestB);
  this._K.pelvis.copy(pelvis); this._K.chestB.copy(chestB);
  this._K.chestT.copy(chestT); this._K.neckT.copy(neckT);

  /* head tracks the opponent, clamped toward the chest's facing */
  const headPos=neckT.clone().addScaledVector(fwdC,.028)
    .addScaledVector(this.flinch,1.25);
  headPos.y=neckT.y+.085+this.flinch.y*1.25;
  if(!this.severed.head)P.head.position.copy(headPos);
  TMP3.copy(opponent.parts.head?opponent.parts.head.position:opponent.pos);
  if(TMP3.distanceToSquared(headPos)>.04){
    P.head.lookAt(TMP3);
    _headQ.setFromAxisAngle(UPY,chestYawA);
    P.head.quaternion.slerp(_headQ,.35);
    const droop=clamp((this.pain-22)/140,0,.42)
               +clamp((78-this.consciousness)/170,0,.38);
    if(droop>0){ _pq.setFromAxisAngle(rightC,droop*.6);
      P.head.quaternion.premultiply(_pq); }
  }

  /* ---- sword: spring-driven tip, two-handed grip ---- */
  const brRise=Math.sin(this.breath*1.6)*.0045;   // the shoulders breathe
  const shR=chestT.clone().addScaledVector(rightC,.185).addScaledVector(fwdC,.01);
  shR.y+=brRise;
  this.soften('shR',shR,30,dt); this._K.shR.copy(shR);
  shR.y=chestT.y-.045;
  const shL=chestT.clone().addScaledVector(rightC,-.185).addScaledVector(fwdC,.01);
  this.soften('shL',shL,30,dt); this._K.shL.copy(shL);
  shL.y=chestT.y-.045+brRise;
  const ctrl=this.swordControl;
  if(this.hasSword){
    const W=this.weapon||WEAPONS.katana;
    let K=(this.thrust?150:110)*W.speed;
    const DAMP=(this.thrust?16:10.5)*(1+(W.effMass-1)*.35);
    if(this.isPlayer){
      K*=lerp(.45,1,clamp(this.consciousness/100,0,1));  // dying hands are slow
      if(game.adrenaline>0&&this.bloodFrac>.6)K*=1.08;
    }
    if(this.kneel)K*=1-this.kneel*.62;
    const skill=this.isPlayer?1:(this.speedMul||.85);
    const maxSpd=((this.thrust?11:14)*ctrl+2)*skill*W.maxSpd;
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

    /* TWO-HANDED GRIP: the hands sweep a compressed arc anchored at the
       solar plexus; the WRISTS articulate the blade through the full arc.
       Raise the tip overhead and the blade cocks back (furikaburi);
       cut through and the tip snaps far ahead of the hands. The blade
       is no longer collinear with the arm — it is HELD, not pointed. */
    const BL=this.weapon&&this.weapon.blunt;
    const gripAnchor=chestB.clone().addScaledVector(fwdC,BL?.2:.14);
    gripAnchor.y=chestB.y+(BL?.3:.12);      // fists ride high
    const toTip=TMP1.subVectors(this.tip,gripAnchor);
    const reach=Math.max(toTip.length(),.001); toTip.divideScalar(reach);
    TMP3.copy(fwdC).setY(-.18).normalize();          // neutral guard direction
    const handDir=TMP2.copy(toTip).lerp(TMP3,.5).normalize();
    const gripR=clamp(.28+reach*.10,.30,.48);
    const handle=gripAnchor.clone().addScaledVector(handDir,gripR);
    const headY=chestT.y+.28;                        // hands rise less than steel
    if(this.tip.y>headY)handle.y+=Math.min((this.tip.y-headY)*.30,.14);
    /* the grip never leaves the sword arm's honest reach */
    { TMP4.subVectors(handle,shR); const hd=TMP4.length();
      const maxR=(D.upperArm+D.foreArm)*.94;
      if(hd>maxR)handle.copy(shR).addScaledVector(TMP4.divideScalar(hd),maxR); }
    const bladeDir=TMP2.subVectors(this.tip,handle);
    if(bladeDir.lengthSq()<.04)bladeDir.copy(toTip); // degenerate guard
    bladeDir.normalize();
    clampBladeDir(bladeDir,fwdC,rightC);
    /* the physical sword's momentum bends the rendered blade's line */
    if(PHYS.enabled&&this.phys&&this.phys.B.sword){
      const sw=this.phys.B.sword;
      TMP3.set(0,sw.len/2,0); sw.toWorld(TMP3,TMP3);
      TMP3.sub(handle).normalize();
      if(TMP3.dot(bladeDir)>.2)bladeDir.lerp(TMP3,PHYS.swordBlend).normalize();
    }
    this.katana.position.copy(handle);
    this.katana.quaternion.setFromUnitVectors(UPY,bladeDir);
    { /* hasuji: the edge leads the cut; at rest it settles forward-down */
      TMP3.copy(this.tipVel).addScaledVector(bladeDir,-this.tipVel.dot(bladeDir));
      const sp=TMP3.length();
      if(sp>1.4)TMP3.divideScalar(sp);
      else TMP3.copy(fwdC).multiplyScalar(.5).setY(-.85).normalize();
      _pv.set(1,0,0).applyQuaternion(this.katana.quaternion);   // current edge
      const cx=_pv.dot(TMP3);
      _pv2.crossVectors(_pv,TMP3);
      const want=Math.atan2(_pv2.dot(bladeDir),cx);
      if(this.katRoll===undefined)this.katRoll=want;
      this.katRoll+=angDiff(want,this.katRoll)*clamp(dt*(sp>1.4?14:5),0,1);
      _pq.setFromAxisAngle(UPY,this.katRoll);
      this.katana.quaternion.multiply(_pq);
    }
    /* keep previous segment for swept collision */
    if(this.bladeA){ this.prevBladeA.copy(this.bladeA); this.prevBladeB.copy(this.bladeB); this.hadPrev=true; }
    else this.hadPrev=false;
    this.bladeA=handle.clone().addScaledVector(bladeDir,
      (this.weapon&&this.weapon.cutFrom)||.12);
    this.bladeB=handle.clone().addScaledVector(bladeDir,
      (this.weapon&&this.weapon.len)||.93);

    /* arms: two-bone IK with anatomical elbow hints */
    const elR=V3(),elL=V3();
    let handR=handle.clone().addScaledVector(bladeDir,-.02);   // at the tsuba
    if(this._ritualGrabR)handR=this._ritualGrabR.clone();
    /* on full extension the LEFT hand slides up the grip toward the
       tsuba rather than tearing off the pommel — as real hands do */
    let gripS=-.15;
    { const maxL=(D.upperArm+D.foreArm)*.94;
      while(gripS<-.03&&
        TMP4.copy(handle).addScaledVector(bladeDir,gripS).distanceTo(shL)>maxL)
        gripS+=.02; }
    let handL=handle.clone().addScaledVector(bladeDir,gripS);
    if(BL){ /* the rear fist guards the jaw — boxing, not prayer */
      handL=chestT.clone().addScaledVector(fwdC,.26)
        .addScaledVector(rightC,-.14);
      handL.y=chestT.y+.14+Math.sin(this.breath*2.2)*.012;
    }
    if(this._ritualGrabL)handL=this._ritualGrabL.clone();
    /* the elbows: down and in at guard, out and up through the raise */
    const rise=clamp((handle.y-shR.y+.18)*2.6,0,1);
    const hintR=rightC.clone().multiplyScalar(lerp(.85,1.2,rise))
      .addScaledVector(fwdC,lerp(-.3,.15,rise)); hintR.y=lerp(-.55,.5,rise);
    solveIK(shR,handR,D.upperArm,D.foreArm,hintR,elR);
    this._ikR=(this._ikR||elR.clone()).copy(elR);      // the exact IK answer
    if(P.elbowR)P.elbowR.position.copy(elR);
    this.soften('elR',elR,34,dt);
    /* flesh may lag the bone by 7cm — never more; then exact length */
    TMP4.subVectors(elR,this._ikR);
    if(TMP4.lengthSq()>.0049)elR.copy(this._ikR).addScaledVector(TMP4.clampLength(0,.07),1);
    TMP4.subVectors(elR,shR).normalize();
    elR.copy(shR).addScaledVector(TMP4,D.upperArm);
    this._K.elR.copy(elR); this._K.haR.copy(handR);
    aimLimb(P.upperArmR,shR,elR); aimLimb(P.forearmR,elR,handR);
    this.setBone('uaR',shR,elR);
    P.handR.position.copy(handR);
    P.handR.quaternion.copy(this.katana.quaternion);
    if(this.brokenParts&&this.brokenParts.forearmR&&!this.hasSword)
      P.handR.rotateX(1.1);   // the hand hangs off the break
    if(this.isPlayer){ game._drift=Math.max(game._drift||0,Math.abs(shR.distanceTo(elR)-D.upperArm));
      game._span=Math.max(game._span||0,Math.abs(P.forearmR.scale.y*P.forearmR.userData.len-elR.distanceTo(handR))); }
    if(!this.disabled.armL&&!this.severed.armL){
      const hintL=rightC.clone().multiplyScalar(lerp(-.85,-1.2,rise))
        .addScaledVector(fwdC,lerp(-.3,.15,rise)); hintL.y=lerp(-.55,.5,rise);
      solveIK(shL,handL,D.upperArm,D.foreArm,hintL,elL);
      this._ikL=(this._ikL||elL.clone()).copy(elL);
      if(P.elbowL)P.elbowL.position.copy(elL);
      this.soften('elL',elL,34,dt);
      TMP4.subVectors(elL,this._ikL);
      if(TMP4.lengthSq()>.0049)elL.copy(this._ikL).addScaledVector(TMP4.clampLength(0,.07),1);
      TMP4.subVectors(elL,shL).normalize();
      elL.copy(shL).addScaledVector(TMP4,D.upperArm);
      this._K.elL.copy(elL); this._K.haL.copy(handL);
      aimLimb(P.upperArmL,shL,elL); aimLimb(P.forearmL,elL,handL);
      this.setBone('uaL',shL,elL);
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
  this.soften('knR',knR,42,dt); this.soften('knL',knL,42,dt);
  TMP4.subVectors(knR,hipR).normalize(); knR.copy(hipR).addScaledVector(TMP4,D.thigh);
  TMP4.subVectors(knL,hipL).normalize(); knL.copy(hipL).addScaledVector(TMP4,D.thigh);
  this._K.hipR.copy(hipR); this._K.hipL.copy(hipL);
  this._K.knR.copy(knR); this._K.knL.copy(knL);
  this._K.ankR.copy(ankR); this._K.ankL.copy(ankL);
  if(PHYS.enabled){
    if(!this.phys)this.buildPhys(this._K);
    this.physTargets(this._K,dt);
  }
  if(this.model){
    if(!MODELPIPE.tickClips(this,dt))MODELPIPE.drive(this,this._K);
  }
  this.tickCloth(dt,this._K);
  this.tickFingers(dt);
  aimLimb(P.thighR,hipR,knR); aimLimb(P.shinR,knR,ankR);
  aimLimb(P.thighL,hipL,knL); aimLimb(P.shinL,knL,ankL);
  this.setBone('thR',hipR,knR); this.setBone('shR',knR,ankR);
  this.setBone('thL',hipL,knL); this.setBone('shL',knL,ankL);
  P.footR.position.set(ft.R.p.x,.028+ft.R.lift,ft.R.p.z);
  P.footR.quaternion.setFromAxisAngle(UPY,ft.R.yaw+.07);
  if(ft.R.roll)P.footR.rotateX(ft.R.roll);
  P.footL.position.set(ft.L.p.x,.028+ft.L.lift,ft.L.p.z);
  P.footL.quaternion.setFromAxisAngle(UPY,ft.L.yaw-.07);
  if(ft.L.roll)P.footL.rotateX(ft.L.roll);

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
  TMP4.subVectors(el,sh).normalize();
  el.copy(sh).addScaledVector(TMP4,D.upperArm);       // exact bone length
  const ha=el.clone(); ha.y-=D.foreArm;
  (side==='R'?this._K.elR:this._K.elL).copy(el);
  (side==='R'?this._K.haR:this._K.haL).copy(ha);
  const ua=side==='R'?P.upperArmR:P.upperArmL, fa=side==='R'?P.forearmR:P.forearmL;
  aimLimb(ua,sh,el);
  this.setBone(side==='R'?'uaR':'uaL',sh,el);
  if(!(this.severed['arm'+side])){ aimLimb(fa,el,ha);
    (side==='R'?P.handR:P.handL).position.copy(ha); }
};

/* ============================== INPUT ================================== */
const input={keys:{},mx:0,my:0,rmb:false,shift:false};
addEventListener('keydown',e=>{ input.keys[e.code]=true;
  if(e.code==='KeyO'){ OUTLINE.on=!OUTLINE.on;
    for(const o of OUTLINE.meshes)o.visible=OUTLINE.on;
    log('outlines '+(OUTLINE.on?'on':'off'),false); }
  if(e.code==='KeyM'&&player){ PICKER.cycle('P',1);
    log('your fighter: '+PICKER.roster[PICKER.idx.P].label+' (next duel)',false); }
  if(e.code==='KeyN'&&enemy){ PICKER.cycle('E',1);
    log('the opponent: '+PICKER.roster[PICKER.idx.E].label+' (next duel)',false); }
  /* physics dials: [ ] = blend, ; ' = assist strength (live tuning) */
  if(PHYS.enabled){
    if(e.code==='BracketLeft'){ PHYS.blend=Math.max(0,PHYS.blend-.1);
      log('physics blend '+PHYS.blend.toFixed(1),false); }
    if(e.code==='BracketRight'){ PHYS.blend=Math.min(1,PHYS.blend+.1);
      log('physics blend '+PHYS.blend.toFixed(1),false); }
    if(e.code==='Semicolon'&&player&&player.phys){
      player.phys.A.compliance*=2; enemy.phys.A.compliance*=2;
      log('balance assist loosened',false); }
    if(e.code==='Quote'&&player&&player.phys){
      player.phys.A.compliance*=.5; enemy.phys.A.compliance*=.5;
      log('balance assist tightened',false); }
  }
  if(e.code==='ShiftLeft'||e.code==='ShiftRight')input.shift=true;
  if(e.code==='KeyR'&&game.state!=='menu')restart(); });
addEventListener('keyup',e=>{ input.keys[e.code]=false;
  if(e.code==='ShiftLeft'||e.code==='ShiftRight')input.shift=false; });
/* pointer lock: the sword hand cannot leave the ring.
   locked → relative deltas accumulate into a virtual cursor;
   unlocked (menus) → absolute position as before. */
addEventListener('mousemove',e=>{
  if(document.pointerLockElement){
    input.mx=clamp(input.mx+e.movementX/innerWidth*2.2,-1.35,1.35);
    input.my=clamp(input.my-e.movementY/innerHeight*2.2,-1.15,1.15);
  } else {
    input.mx=e.clientX/innerWidth*2-1;
    input.my=-(e.clientY/innerHeight*2-1);
  }
});
function grabPointer(){
  try{ if(!document.pointerLockElement&&game.state==='fight')
    renderer.domElement.requestPointerLock(); }catch(e){}
}
if(!IS_TOUCH)addEventListener('mousedown',grabPointer);
document.addEventListener('pointerlockchange',()=>{
  if(!document.pointerLockElement&&game.state==='fight')
    log('pointer freed — click to take up the sword again',false);
});
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
  { const r=Math.max(TMP4.subVectors(t,chest).length(),.3);
    clampBladeDir(TMP4.divideScalar(r),fwd,right);
    t.copy(chest).addScaledVector(TMP4,r); }
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
  constructor(f,P){ this.f=f; this.P=P||{skill:.82,reaction:.19,engage:[1.6,2.6],
      atkCircle:.5,atkBlock:.38,windupT:[.28,.46],strikeT:[.3,.44],
      speedMul:.85,parry:.2,maai:2.15,tempo:[.8,1.9]};
    this.state='circle'; this.t=rand(this.P.engage[0],this.P.engage[1]); // sizes you up first
    this.strafe=Math.random()<.5?1:-1; this.plan=null;
    this.reaction=this.P.reaction; this.alert=0;
    this.aimErr=V3(); this.skill=this.P.skill;
    /* a mind: he watches HOW you fight */
    this.model={h:[0,0,0],n:0,retreats:0,retreatAtk:0};
    this._foeFast=false; this._foeBack=0;
    /* a heart: fear and boldness move the numbers */
    this.mood={fear:0,aggr:0,saidFear:false,saidBold:false}; }                          // <1: human, not machine
  update(dt,foe){
    const f=this.f; if(!f.alive)return;
    if(game.state!=='fight'){ f.telegraph=false; return; }
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

    /* ---- observation: every committed cut you throw is remembered ---- */
    const foeFast=foe.bladeSpeed>7&&foe.hasSword;
    if(foeFast&&!this._foeFast){
      const y=foe.tip.y, b=y<1.0?0:y<1.55?1:2;
      this.model.h[b]++; this.model.n++;
      if(this._foeBack>.3)this.model.retreatAtk++;   // the retreat-then-cut habit
    }
    this._foeFast=foeFast;
    TMP2.subVectors(f.pos,foe.pos).setY(0).normalize();
    this._foeBack=foe.vel.dot(TMP2)>.6?this._foeBack+dt:0;
    const M=this.model;
    const modal=M.h[0]>=M.h[1]&&M.h[0]>=M.h[2]?0:(M.h[1]>=M.h[2]?1:2);
    const readsYou=M.n>=4&&M.h[modal]/M.n>.55;

    /* ---- mood: fear is blood and pain; boldness feeds on your passivity ---- */
    const md=this.mood;
    md.fear=clamp((1-f.bloodFrac)*1.7+f.pain/150,0,1);
    if(foe.bladeSpeed<3.5&&dist>this.P.maai)md.aggr=clamp(md.aggr+dt*.07,0,1);
    else md.aggr=Math.max(0,md.aggr-dt*.05);
    if(md.fear>.6&&!md.saidFear){ md.saidFear=true;
      log(f.name+"'s breath comes ragged — there is fear in it",false); }
    if(md.aggr>.7&&!md.saidBold){ md.saidBold=true;
      log(f.name+' grows bold — he presses forward',false); }
    const desperate2=md.fear>.8;
    this.skill=this.P.skill*(1-md.fear*.22);

    const m=f.mobility, acc=11*m;
    const move=V3();

    /* if disarmed or crippled → desperate retreat */
    const desperate=!f.hasSword||f.bloodFrac<.55;
    /* THE OPENING: a crippled opponent is not spared — he is finished */
    const foeCrippled=foe.alive&&(foe.downT>0||!foe.hasSword||
      foe.consciousness<62||foe.bloodFrac<.55||
      (foe.legDamage&&(foe.legDamage.R+foe.legDamage.L)>1.1));
    md.execute=foeCrippled&&!desperate&&f.consciousness>50;
    if(md.execute&&!md.saidKill){ md.saidKill=true;
      log(f.name+' sees the opening — he moves in to finish it',false); }

    switch(this.state){
      case 'circle':{
        const maai=md.execute?1.7:(desperate?3.4:this.P.maai);
        if(dist>maai+.25)move.add(fwd);
        else if(dist<maai-.25)move.sub(fwd);
        move.addScaledVector(right,this.strafe*.6);
        /* never let the rope pin you */
        { const rr=Math.hypot(f.pos.x,f.pos.z);
          if(rr>RING_R-1.1){ TMP3.set(-f.pos.x,0,-f.pos.z).normalize();
            move.addScaledVector(TMP3,.9); } }
        /* guard posture between engagements: this duelist's kamae */
        (KAMAE[this.P.kamae]||KAMAE.chudan)(f.tipTarget,f.pos,fwd,right);
        f.tipTarget.y+=Math.sin(f.breath*1.3)*.045;
        f.thrust=false; f.guarding=false;
        if(threat&&this.alert>this.reaction&&Math.random()<.85){ this.state='block'; this.t=rand(.3,.55);
          /* a read opponent gets parried: he knows where your cut lives */
          this.f.parryEnabled=Math.random()<(readsYou?Math.min(.9,this.P.parry+.35):this.P.parry);
          this._guardBias=readsYou?modal:1;
          break; }
        if(this.t<=0){ this.strafe*=Math.random()<.4?-1:1; this.t=rand(this.P.tempo[0],this.P.tempo[1]);
          let pAtk=this.P.atkCircle*(1+md.aggr*.85)*(1-md.fear*.5);
          if(desperate2)pAtk=Math.max(pAtk,.55);        // the cornered animal
          if(md.execute)pAtk=Math.max(pAtk,.8);         // no mercy, no hesitation
          if(!desperate&&dist<(md.execute?3.4:2.9)&&Math.random()<pAtk){ this.beginAttack(foe); } }
        break; }
      case 'block':{
        f.guarding=true;
        if(foe.bladeA){ TMP2.addVectors(foe.bladeA,foe.bladeB).multiplyScalar(.5);
          f.tipTarget.copy(chest).lerp(TMP2,.45);
          const gb=this._guardBias===0?.85:this._guardBias===2?1.6:1.2;
          f.tipTarget.y=clamp(lerp(f.tipTarget.y,gb,.35),.7,1.75); }
        move.sub(fwd).multiplyScalar(.5);
        if(this.t<=0){ this.state='circle'; this.t=rand(.3,.8); this.f.parryEnabled=true;
          if(dist<2.6&&Math.random()<this.P.atkBlock)this.beginAttack(foe); }
        break; }
      case 'attack':{
        const pl=this.plan;
        pl.t+=dt;
        /* windup then strike THROUGH the target part */
        if(pl.phase===0){
          f.telegraph=true;
          if(!pl.from)pl.from=f.tip.clone();
          TMP2.copy(chest).addScaledVector(pl.windup,1);
          f.tipTarget.lerpVectors(pl.from,TMP2,minJerk(pl.t/pl.windupT));
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
          f.telegraph=false;
          if(pl.t>pl.strikeT){ this.state='recover'; this.t=rand(.35,.7); f.thrust=false; }
        }
        break; }
      case 'recover':{
        f.telegraph=false;
        move.sub(fwd); move.addScaledVector(right,this.strafe*.4);
        KAMAE.chudan(f.tipTarget,f.pos,fwd,right);
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
    if(this.f.mood&&this.f.mood.execute){
      for(const t of targets)t.w=(t.k==='neck')?9:(t.k==='head')?6:t.w*.3;
    }
    let sum=0; for(const t of targets)sum+=t.w;
    let r=Math.random()*sum, pick=targets[0];
    for(const t of targets){ r-=t.w; if(r<=0){ pick=t; break; } }
    const fwd=V3(Math.sin(f.yaw||0),0,Math.cos(f.yaw||0));
    const right=V3(fwd.z,0,-fwd.x);
    const wu=V3().addScaledVector(right,pick.windup.x).addScaledVector(fwd,-.2);
    wu.y=pick.windup.y+.22;
    this.aimErr.set(rand(-.14,.14),rand(-.12,.12),rand(-.14,.14)).multiplyScalar(2-this.skill*1.2);
    this.plan={target:pick.k,thrust:pick.thrust,windup:wu,
      windupT:rand(this.P.windupT[0],this.P.windupT[1]),
      strikeT:rand(this.P.strikeT[0],this.P.strikeT[1]),range:2.9,t:0,phase:0};
    this.state='attack';
  }
}

/* ============================ COMBAT =================================== */
const BLADE_EFF_MASS=2.0;    // kg effective at the edge (katana + both arms behind it)
const hitTmpA=V3(), hitTmpB=V3(), hitTmpC=V3(), hitTmpD=V3();

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
      const AW=att.weapon||WEAPONS.katana;
      const energy=.5*BLADE_EFF_MASS*AW.effMass*spd*spd*(att.chainMul||1)*AW.dmg;
      const align=AW.blunt?Math.min(att.alignment,.07):att.alignment;
      const dir=TMP1.copy(att.tipVel).normalize();
      def.lastHitDir=dir.clone();
      const res=def.applyCut(key,energy,align,att.thrust,hitTmpB.clone(),dir.clone(),log);
      if(res)def.addHitMark(key,hitTmpB.clone(),dir,res.severity||'minor',AW.blunt);
      if(AW.blunt){ /* the fist SHOVES: bodyweight through the target */
        def.physImpulse&&def.physImpulse(key,dir,Math.min(energy*1.1,400));
        def.stun=Math.max(def.stun,Math.min(energy/620,.75));
        def.pain=Math.min(100,def.pain+energy*.065);
        def.stamina=Math.max(0,def.stamina-energy*.05);   // punches wind you
      }
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
  /* swept: check current-vs-current plus each blade's previous position,
     so steel meeting steel at full speed can't tunnel through a frame */
  let d=segSegClosest(a.bladeA,a.bladeB,b.bladeA,b.bladeB,hitTmpA,hitTmpB);
  if(a.hadPrev){
    const d2=segSegClosest(a.prevBladeA,a.prevBladeB,b.bladeA,b.bladeB,hitTmpC,hitTmpD);
    if(d2<d){ d=d2; hitTmpA.copy(hitTmpC); hitTmpB.copy(hitTmpD); } }
  if(b.hadPrev){
    const d3=segSegClosest(a.bladeA,a.bladeB,b.prevBladeA,b.prevBladeB,hitTmpC,hitTmpD);
    if(d3<d){ d=d3; hitTmpA.copy(hitTmpC); hitTmpB.copy(hitTmpD); } }
  /* a deliberate fresh guard intercepts generously — that's the parry read */
  const win=(a.guardFresh||b.guardFresh)?.13:.075;
  if(d<win){
    game.bladeContacts=(game.bladeContacts||0)+1;
    const rel=TMP1.copy(a.tipVel).sub(b.tipVel).length();
    /* slow sustained steel-on-steel: the blades are BOUND */
    if(rel<2.4&&a.hasSword&&b.hasSword&&a.alive&&b.alive&&!game.bind){
      game._bindTouch=true; game._bindPt=(game._bindPt||V3()).copy(hitTmpA);
    }

    /* PARRY: a fresh guard against a committed cut turns it aside hard
       and opens the attacker for a beat */
    const now=performance.now();
    const tryParry=(def,att)=>{
      if(!def.guardFresh||def.parryEnabled===false)return false;
      if(att.bladeSpeed*att.swordControl<6.5)return false;
      if(now-(game._lastParry||0)<450)return false;
      game._lastParry=now;
      def.parries++;
      att.stun=Math.max(att.stun,.6); att.pain=Math.min(100,att.pain+8);
      att.tipVel.multiplyScalar(-.32);
      TMP3.subVectors(att.tip,def.tip).normalize();
      att.tipTarget.copy(att.tip).addScaledVector(TMP3,1.1).setY(Math.max(.6,att.tip.y-.3));
      att.softHit('shR',TMP3,2.0); att.softHit('chestT',TMP3,1.2);
      att.stagger=(att.stagger||0)+.55;
      if(att===enemy&&typeof enemyAI!=='undefined'){ enemyAI.state='recover'; enemyAI.t=1.0; enemyAI.plan=null; att.telegraph=false; }
      Sound.parry(); sparks(hitTmpA,14);
      game.timeScale=.4; game.slowT=.28;
      log(def.isPlayer?'parried — his blade flies wide. an opening!'
                      :'he reads your cut — turned aside!',false);
      return true;
    };
    if(tryParry(a,b)||tryParry(b,a))return;
    if(rel<1.5)return;                     // resting contact: no clang, no deflect
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
    if(p.held){                       // carried in the victor's hand
      p.heldT-=dt;
      const h=p.held.parts&&p.held.parts.handL;
      if(h)p.mesh.position.copy(h.position);
      if(Math.random()<dt*14)
        emitBlood(p.mesh.position,V3(rand(-.2,.2),-1,rand(-.2,.2)),1.4,3);
      if(p.heldT<=0){ p.held=null; p.vel=p.relVel||V3(2,3,0); }
      continue;
    }
    if(!p.vel)continue;
    if(p.cloth){ p.vel.y-=2.6*dt; p.vel.multiplyScalar(1-1.4*dt); }
    else p.vel.y-=9.8*dt;
    p.mesh.position.addScaledVector(p.vel,dt);
    p.mesh.rotation.x+=p.ang.x*dt; p.mesh.rotation.z+=p.ang.z*dt;
    /* the tumbling piece bleeds as it flies */
    if(p.bleed>0){ p.bleed-=dt;
      if(Math.random()<dt*22)
        emitBlood(p.mesh.position,V3(rand(-.4,.4),-.6,rand(-.4,.4)),1.2,2); }
    if(p.mesh.position.y<=.05){ p.mesh.position.y=.05; p.vel=null;
      addStain(p.mesh.position.x,p.mesh.position.z,.2);
      addStain(p.mesh.position.x+rand(-.1,.1),p.mesh.position.z+rand(-.1,.1),.1); }
  }
  if(f._fleshM)for(const m of f._fleshM)
    if(m.color&&f.bloodTint)m.color.lerp(f.bloodTint,dt*.05*(1-(f.bloodFrac||1)));
  if(f.brokenParts){       /* broken shins: the foot flops */
    if(f.brokenParts.shinR&&f.feet)f.feet.R.roll=.55;
    if(f.brokenParts.shinL&&f.feet)f.feet.L.roll=-.55;
  }
  /* torn cloth breathes and swings */
  if(f._flaps&&f._flaps.length){
    const t=performance.now()*.003,
          sway=1+Math.hypot(f.vel.x,f.vel.z)*1.5;
    for(const fl of f._flaps){
      const u=fl.userData;
      fl.rotation.x=u.base-.5-Math.abs(Math.sin(t*2+u.ph))*u.amp*sway;
      fl.rotation.z=Math.sin(t*2.7+u.ph)*.2*sway;
    }
  }
  /* the gutted keep losing what should stay in */
  if(f.gutsOut&&f.alive&&(f._gutDrip=(f._gutDrip||0)-dt)<0&&
     Math.hypot(f.vel.x,f.vel.z)>.6){
    f._gutDrip=2.2+Math.random()*1.5;
    const p=mkGutLoop(); p.scale.setScalar(.7);
    p.position.copy(f.pos).setY(.95); scene.add(p);
    f.severedPieces=f.severedPieces||[];
    f.severedPieces.push({mesh:p,bleed:.8,
      vel:V3(rand(-.4,.4),-.2,rand(-.4,.4)),ang:V3(rand(-3,3),0,rand(-3,3))});
    emitBlood(p.position,V3(0,-.6,0),2,8);
  }
  /* the fresh stump pumps in time with the heart */
  if(f.stumpBleed>0&&f.stumpAt){
    f.stumpBleed-=dt;
    if(Math.random()<dt*9){
      TMP1.setFromMatrixPosition(f.stumpAt.matrixWorld);
      TMP2.set(rand(-.5,.5),1,rand(-.5,.5)).normalize();
      emitBlood(TMP1,TMP2,2.6,7);
    }
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

/* ============== MATERIAL REALISM: normals, reflections, overrides ======
   Normal maps computed from procedural height fields (Sobel gradients);
   a canvas cube environment so steel reflects the night; and a texture
   override system: drop photoreal maps in /textures/ (e.g. generated on
   a local ComfyUI rig) and they replace the procedural ones on load. */
function mkNormalTex(size,heightDraw,strength){
  try{
    const c=document.createElement('canvas'); c.width=c.height=size;
    const x=c.getContext('2d'); if(!x)return null;
    heightDraw(x,size,size);
    const d=x.getImageData(0,0,size,size).data;
    const out=document.createElement('canvas'); out.width=out.height=size;
    const ox=out.getContext('2d'), o=ox.createImageData(size,size);
    const H=(i,j)=>d[(((j+size)%size)*size+((i+size)%size))*4]/255;
    for(let j=0;j<size;j++)for(let i=0;i<size;i++){
      const dx=(H(i+1,j)-H(i-1,j))*strength, dy=(H(i,j+1)-H(i,j-1))*strength;
      const il=1/Math.sqrt(dx*dx+dy*dy+1), k=(j*size+i)*4;
      o.data[k]=(-dx*il*.5+.5)*255; o.data[k+1]=(-dy*il*.5+.5)*255;
      o.data[k+2]=(il*.5+.5)*255; o.data[k+3]=255;
    }
    ox.putImageData(o,0,0);
    const t=new THREE.CanvasTexture(out);
    t.wrapS=t.wrapT=THREE.RepeatWrapping;
    return t;
  }catch(e){ return null; }
}
const envCube=(()=>{
  try{
    const face=(draw)=>{ const c=document.createElement('canvas');
      c.width=c.height=64; const x=c.getContext('2d');
      if(!x)throw 0; draw(x,64,64); return c; };
    const side=()=>face((x,w,h)=>{
      const g=x.createLinearGradient(0,0,0,h);
      g.addColorStop(0,'#070b14'); g.addColorStop(.62,'#101a2a');
      g.addColorStop(.72,'#1c2838'); g.addColorStop(.78,'#8d99a8');
      g.addColorStop(1,'#a8b2bf');
      x.fillStyle=g; x.fillRect(0,0,w,h); });
    const top=face((x,w,h)=>{ x.fillStyle='#05070d'; x.fillRect(0,0,w,h);
      x.fillStyle='#c8d4ea';
      for(let i=0;i<26;i++)x.fillRect(Math.random()*w,Math.random()*h,1,1); });
    const bot=face((x,w,h)=>{ x.fillStyle='#9aa4b0'; x.fillRect(0,0,w,h); });
    const t=new THREE.CubeTexture([side(),side(),top,bot,side(),side()]);
    t.needsUpdate=true; return t;
  }catch(e){ return null; }
})();
/* photoreal override: /textures/<name>.jpg quietly replaces procedural */
function overrideTex(name,apply){
  if(typeof process!=='undefined')return;   // browser only
  try{
    new THREE.TextureLoader().load('textures/'+name+'.jpg',
      t=>{ t.wrapS=t.wrapT=THREE.RepeatWrapping; t.encoding=THREE.sRGBEncoding;
        apply(t); },undefined,()=>{});
  }catch(e){}
}

/* ----------------- the ground fights too: depth and ice ---------------- */
function snowDepth(x,z){
  const r=Math.hypot(x,z);
  const t=clamp((r-2.1)/(RING_R-2.1),0,1);
  return .02+.11*t*t*(3-2*t)+Math.sin(x*3.1)*Math.cos(z*2.7)*.012;
}
/* a raised blade catches the moon */
const glintTex=canTex(64,64,(ctx,w,h)=>{
  const g=ctx.createRadialGradient(32,32,1,32,32,30);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(.25,'rgba(220,235,255,.5)');
  g.addColorStop(1,'rgba(200,220,255,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  ctx.fillStyle='rgba(255,255,255,.85)';
  ctx.fillRect(30,4,4,56); ctx.fillRect(4,30,56,4);
});
function mkGlint(){
  const m=new THREE.SpriteMaterial({map:glintTex||null,transparent:true,
    opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
  const s=new THREE.Sprite(m); s.scale.set(.5,.5,1); scene.add(s); return s;
}
/* breath in the cold */
const puffTex=canTex(48,48,(ctx,w,h)=>{
  const g=ctx.createRadialGradient(24,24,2,24,24,22);
  g.addColorStop(0,'rgba(235,240,248,.7)');
  g.addColorStop(1,'rgba(235,240,248,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
});
const flares=[];
function impactFlare(p,big){
  try{
    const m=new THREE.SpriteMaterial({map:glintTex||null,transparent:true,
      opacity:.95,depthWrite:false,blending:THREE.AdditiveBlending,
      color:big?0xfff2d8:0xdfe8ff});
    const s=new THREE.Sprite(m); s.position.copy(p);
    s.scale.setScalar(big?.28:.16);
    s.userData={life:big?.26:.18,max:big?.26:.18,grow:big?4.5:3};
    scene.add(s); flares.push(s);
  }catch(e){}
}
function updateFlares(dt){
  for(let i=flares.length-1;i>=0;i--){ const s=flares[i],u=s.userData;
    u.life-=dt;
    if(u.life<=0){ scene.remove(s); flares.splice(i,1); continue; }
    const k=u.life/u.max;
    s.material.opacity=.95*k;
    s.scale.setScalar(s.scale.x+dt*u.grow*.1);
  }
}
/* ================= GORE KIT: the wound is not abstract =================
   Severing leaves a JAGGED STUMP — torn flesh ring, protruding bone —
   on both the body and the flying piece, which trails blood as it
   tumbles. Severe cuts leave gash decals stuck to the body part. */
function jaggedCap(r){
  const g=new THREE.Group();
  try{
    const N=12, pos=[0,0,0], idx=[];
    for(let i=0;i<=N;i++){
      const a=i/N*Math.PI*2, rr=r*(0.62+Math.random()*.55);
      pos.push(Math.cos(a)*rr, Math.sin(a)*rr, (Math.random()-.5)*r*.35);
    }
    for(let i=1;i<=N;i++)idx.push(0,i,i+1);
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const meat=new THREE.Mesh(geo,stdMat(0x5e0f0f,{roughness:.55,side:THREE.DoubleSide}));
    const meat2=new THREE.Mesh(geo,stdMat(0x7e1b16,{roughness:.7,side:THREE.DoubleSide}));
    meat2.scale.setScalar(.72); meat2.position.z=r*.06;
    const bone=new THREE.Mesh(new THREE.CylinderGeometry(r*.24,r*.28,r*.9,8),
      stdMat(0xd9d2c0,{roughness:.5}));
    bone.rotation.x=Math.PI/2; bone.position.z=r*.28;
    g.add(meat,meat2,bone);
  }catch(e){}
  return g;
}
function attachStump(part,atY,r){
  const s=jaggedCap(r);
  s.rotation.x=Math.PI/2; s.position.y=atY;
  part.add(s); return s;
}
/* a gash: dark jagged decal stuck to the part, in its local frame */
const gashTex=canTex(128,64,(x,w,h)=>{
  x.clearRect(0,0,w,h);
  x.strokeStyle='rgba(70,8,8,.95)'; x.lineWidth=7; x.lineCap='round';
  x.beginPath(); x.moveTo(8,h*.5);
  for(let px=8;px<=w-8;px+=9)x.lineTo(px,h*.5+(Math.random()-.5)*h*.55);
  x.stroke();
  x.strokeStyle='rgba(150,26,20,.8)'; x.lineWidth=3;
  x.beginPath(); x.moveTo(10,h*.5);
  for(let px=10;px<=w-10;px+=9)x.lineTo(px,h*.5+(Math.random()-.5)*h*.4);
  x.stroke();
});
/* brain: pale pink-gray, convoluted */
const brainTex=canTex(128,128,(x,w,h)=>{
  x.fillStyle='#c9a3a0'; x.fillRect(0,0,w,h);
  x.strokeStyle='rgba(120,70,74,.75)'; x.lineWidth=3; x.lineCap='round';
  for(let i=0;i<46;i++){
    x.beginPath();
    let px=Math.random()*w, py=Math.random()*h, a=Math.random()*6.28;
    x.moveTo(px,py);
    for(let s=0;s<5;s++){ a+=(Math.random()-.5)*1.8;
      px+=Math.cos(a)*9; py+=Math.sin(a)*9; x.lineTo(px,py); }
    x.stroke();
  }
});
/* the skull cleft: bone-rimmed breach, the brain beneath */
Fighter.prototype.decapitate=function(worldPt,hitDir){
  if(this.severed.head)return; this.severed.head=true;
  try{
    const head=this.parts.head;
    scene.attach(head);
    this.severedPieces=this.severedPieces||[];
    this.severedPieces.push({mesh:head,bleed:3,
      vel:V3(hitDir.x*2.6+rand(-.6,.6),rand(2.8,3.8),hitDir.z*2.6+rand(-.6,.6)),
      ang:V3(rand(-8,8),rand(-8,8),rand(-8,8))});
    attachStump(this.parts.neck,0,.045);
    /* the fountain */
    addSquirt(this,'neck',worldPt,4.2,2.6);
    emitBlood(worldPt,V3(0,1,0),6,70);
    emitBlood(worldPt,hitDir,4,30);
    game.timeScale=.3; game.slowT=.5; game.shake=1.2;
  }catch(e){}
};
Fighter.prototype.launchHeart=function(worldPt,hitDir){
  if(this.heartOut)return; this.heartOut=true;
  try{
    const heart=new THREE.Group();
    const h=new THREE.Mesh(new THREE.SphereGeometry(.034,9,8),
      stdMat(0x8e1420,{roughness:.25}));
    h.scale.set(1,.85,.8);
    const t1=new THREE.Mesh(new THREE.CylinderGeometry(.008,.011,.03,6),
      stdMat(0x5e2028,{roughness:.4}));
    t1.position.set(.01,.032,0); t1.rotation.z=-.4;
    heart.add(h,t1);
    heart.position.copy(worldPt); scene.add(heart);
    this.severedPieces=this.severedPieces||[];
    this.severedPieces.push({mesh:heart,bleed:2.2,
      vel:V3(hitDir.x*2.4,rand(2,3),hitDir.z*2.4),
      ang:V3(rand(-9,9),rand(-9,9),rand(-9,9))});
    addSquirt(this,'chest',worldPt,3,2.2);
    emitBlood(worldPt,hitDir,5,44);
    game.timeScale=.3; game.slowT=.45;
  }catch(e){}
};
Fighter.prototype.exposeBrain=function(worldPt,hitDir){
  if(this.brainOut||this.severed.head)return; this.brainOut=true;
  try{
    const head=this.parts.head, R=this.dims.headR, CUT=1.0;
    let skull=null,hair=null;
    head.traverse(o=>{ if(o.userData&&o.userData.skull)skull=o; });
    /* the remaining head: everything below the cut line */
    if(skull){
      const lower=new THREE.SphereGeometry(R,26,20,0,Math.PI*2,CUT,Math.PI-CUT);
      lower.rotateY(-Math.PI/2);
      skull.geometry.dispose&&skull.geometry.dispose();
      skull.geometry=lower;
      /* the bowl: bone rim, meat, the brain sitting in it */
      const capY=R*Math.cos(CUT)*1.08;
      const cap=new THREE.Group();
      const meat=new THREE.Mesh(new THREE.CircleGeometry(R*Math.sin(CUT)*.95,18),
        stdMat(0x6e1414,{roughness:.3,side:THREE.DoubleSide}));
      meat.rotation.x=-Math.PI/2;
      const rim=new THREE.Mesh(new THREE.TorusGeometry(R*Math.sin(CUT)*.92,.006,6,18),
        stdMat(0xe0d8c4,{roughness:.45}));
      rim.rotation.x=Math.PI/2;
      const brain=new THREE.Mesh(new THREE.SphereGeometry(R*.62,14,10),
        stdMat(0xffffff,{map:brainTex||null,color:brainTex?0xffffff:0xc9a3a0,
          roughness:.25}));
      brain.scale.y=.55; brain.position.y=.004;
      cap.add(meat,rim,brain); cap.position.y=capY;
      head.add(cap);
    }
    /* the crown, flying: scalp + hair, hollow underside */
    const crownG=new THREE.SphereGeometry(R,20,10,0,Math.PI*2,0,CUT);
    crownG.rotateY(-Math.PI/2);
    const crown=new THREE.Group();
    const scalp=new THREE.Mesh(crownG,
      stdMat(this.palette?this.palette.skin:0xc9a184,{roughness:.55,
        side:THREE.DoubleSide}));
    const under=new THREE.Mesh(new THREE.CircleGeometry(R*Math.sin(CUT)*.9,14),
      stdMat(0x5e0f0f,{roughness:.35,side:THREE.DoubleSide}));
    under.rotation.x=Math.PI/2; under.position.y=R*Math.cos(CUT);
    crown.add(scalp,under);
    head.updateMatrixWorld(true);
    crown.position.setFromMatrixPosition(head.matrixWorld);
    crown.position.y+=R*.5;
    scene.add(crown);
    this.severedPieces=this.severedPieces||[];
    this.severedPieces.push({mesh:crown,bleed:2,
      vel:V3((hitDir?hitDir.x:0)*2.2+rand(-.5,.5),rand(2.2,3),(hitDir?hitDir.z:0)*2.2+rand(-.5,.5)),
      ang:V3(rand(-8,8),rand(-8,8),rand(-8,8))});
    addSquirt(this,'head',worldPt,3.6,2.2);
    emitBlood(worldPt,V3(0,1,0),5,50);
    game.timeScale=.32; game.slowT=.45; game.shake=1;
  }catch(e){}
};
/* evisceration: the belly opens and does not hold */
const gutMat=()=>stdMat(0xa86868,{roughness:.28});
function mkGutLoop(){
  const g=new THREE.Group();
  try{
    for(let i=0;i<3;i++){
      const t=new THREE.Mesh(new THREE.TorusGeometry(.042+Math.random()*.02,
        .019,7,14,Math.PI*(1.2+Math.random()*.8)),gutMat());
      t.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
      t.position.set(rand(-.02,.02),rand(-.02,.02),rand(-.02,.02));
      g.add(t);
    }
  }catch(e){}
  return g;
}
Fighter.prototype.eviscerate=function(worldPt,dir){
  if(this.gutsOut)return; this.gutsOut=true;
  try{
    const ab=this.parts.abdomen;
    ab.updateMatrixWorld(true);
    /* the open wound itself: torn lips, dark interior */
    const cap=jaggedCap(.06);
    const local=ab.worldToLocal(worldPt.clone());
    cap.position.copy(local); cap.lookAt(local.clone().multiplyScalar(3));
    ab.add(cap);
    /* a loop that stays, hanging from the wound */
    const hang=mkGutLoop();
    hang.position.copy(local).multiplyScalar(1.02); hang.position.y-=.05;
    ab.add(hang);
    /* and loops that do not stay */
    this.severedPieces=this.severedPieces||[];
    for(let i=0;i<4;i++){
      const p=mkGutLoop(); p.position.copy(worldPt); scene.add(p);
      this.severedPieces.push({mesh:p,bleed:1.2,
        vel:V3(dir.x*.8+rand(-.5,.5),rand(.3,1),dir.z*.8+rand(-.5,.5)),
        ang:V3(rand(-4,4),rand(-4,4),rand(-4,4))});
    }
    const liver=new THREE.Mesh(new THREE.SphereGeometry(.038,9,7),
      stdMat(0x5e2028,{roughness:.32}));
    liver.scale.set(1.3,.7,.9); liver.position.copy(worldPt); scene.add(liver);
    this.severedPieces.push({mesh:liver,bleed:1.5,
      vel:V3(dir.x*.6,rand(.2,.7),dir.z*.6),ang:V3(rand(-3,3),0,rand(-3,3))});
    this.bleedRate+=14; this.pain=Math.min(100,this.pain+35);
    addSquirt(this,'abdomen',worldPt,3,1.7);
    this._gutDrip=2.4;                       // more will slip out
    emitBlood(worldPt,V3(0,-.4,0),4,44);
    emitBlood(worldPt,dir,3,22);
  }catch(e){}
};
/* torn-cloth edge: jagged alpha */
const tearTex=canTex(64,64,(x,w,h)=>{
  x.clearRect(0,0,w,h);
  x.fillStyle='#fff';
  x.beginPath(); x.moveTo(0,0); x.lineTo(w,0);
  let px=w;
  for(let i=0;i<=8;i++){ px=w-i*(w/8);
    x.lineTo(px,h*(.55+Math.random()*.45)); }
  x.closePath(); x.fill();
});
const CLOTHED=/chest|abdomen|upperArm|thigh|pelvis/;
/* the cloth comes OFF: collapse the fabric out of a torso band, reveal
   a flesh under-body, and throw kimono panels fluttering to the snow */
const REND_BANDS={
  chest:  {y0:1.04,y1:1.52,fx:(x,z)=>Math.hypot(x,z)<.21,part:'chest',  r:[.142,.152],cloth:'kimono'},
  abdomen:{y0:.76, y1:1.04,fx:(x,z)=>Math.hypot(x,z)<.21,part:'abdomen',r:[.125,.14], cloth:'kimono'},
  armR:   {y0:1.12,y1:1.46,fx:(x,z)=>x>.15, part:'upperArmR',r:[.05,.056],cloth:'kimono'},
  armL:   {y0:1.12,y1:1.46,fx:(x,z)=>x<-.15,part:'upperArmL',r:[.05,.056],cloth:'kimono'},
  thighR: {y0:.4,  y1:.8,  fx:(x,z)=>x>.02, part:'thighR',  r:[.07,.09], cloth:'hakama'},
  thighL: {y0:.4,  y1:.8,  fx:(x,z)=>x<-.02,part:'thighL',  r:[.07,.09], cloth:'hakama'}};
const REND_MAP={chest:'chest',abdomen:'abdomen',upperArmR:'armR',upperArmL:'armL',
  thighR:'thighR',thighL:'thighL'};
Fighter.prototype.rendRegion=function(region,worldPt){
  this._rend=this._rend||{};
  if(this._rend[region]||!REND_BANDS[region])return;
  this._rend[region]=true;
  try{
    const R=REND_BANDS[region];
    const {y0,y1}=R;
    /* 1) the fabric is cut away (bind-space vertex collapse) */
    if(this.skin&&this.skin.mesh&&this.skin.mesh.geometry){
      const pos=this.skin.mesh.geometry.attributes.position;
      for(let i=0;i<pos.count;i++){
        const y=pos.getY(i), x=pos.getX(i), z=pos.getZ(i);
        if(y>=y0&&y<=y1&&R.fx(x,z)){
          pos.setX(i,x*.1); pos.setZ(i,z*.1);
        }
      }
      pos.needsUpdate=true;
    }
    /* 2) the body beneath */
    const part=this.parts[R.part];
    if(part&&this.palette){
      const len=y1-y0+.05;
      const flesh=new THREE.Mesh(
        new THREE.CylinderGeometry(R.r[0],R.r[1],len,12,1,false),
        stdMat(this.palette.skin,{roughness:.5,map:skinTex||null,
          normalMap:skinNrm||null}));
      flesh.position.y=-len*.5+.02;
      flesh.userData.flesh=true;
      part.add(flesh);
      this._fleshM=this._fleshM||[];
      this._fleshM.push(flesh.material);
    }
    /* 3) the torn panels flutter down */
    this.severedPieces=this.severedPieces||[];
    for(let i=0;i<2;i++){
      const scrap=new THREE.Mesh(new THREE.PlaneGeometry(.24,.36),
        new THREE.MeshStandardMaterial({
          color:this.palette[R.cloth],
          roughness:.92,side:THREE.DoubleSide,
          alphaMap:tearTex||null,transparent:!!tearTex,
          alphaTest:tearTex?.35:0}));
      scrap.position.copy(worldPt||this.pos.clone().setY((y0+y1)/2));
      scrap.position.x+=rand(-.06,.06); scrap.position.z+=rand(-.06,.06);
      scene.add(scrap);
      this.severedPieces.push({mesh:scrap,bleed:0,cloth:true,
        vel:V3(rand(-1.2,1.2),rand(.6,1.4),rand(-1.2,1.2)),
        ang:V3(rand(-5,5),rand(-5,5),rand(-5,5))});
    }
    Sound&&Sound.cloth&&Sound.cloth();
  }catch(e){}
};
Fighter.prototype.boneBreak=function(partKey,worldPt,hitDir){
  this.brokenParts=this.brokenParts||{};
  if(this.brokenParts[partKey])return;
  this.brokenParts[partKey]=true;
  const part=this.parts[partKey]; if(!part)return;
  try{
    /* compound fracture: splinters jut from the break */
    part.updateMatrixWorld(true);
    const local=part.worldToLocal(worldPt.clone());
    for(let i=0;i<2;i++){
      const spike=new THREE.Mesh(new THREE.ConeGeometry(.009,.075,5),
        stdMat(0xe6dfc9,{roughness:.4}));
      spike.position.copy(local).multiplyScalar(1.02);
      spike.position.x+=rand(-.015,.015); spike.position.y+=rand(-.02,.02);
      spike.lookAt(local.clone().multiplyScalar(4));
      spike.rotateX(Math.PI/2+rand(-.5,.5));
      part.add(spike);
    }
    this.gib(worldPt,hitDir||V3(0,1,0),1,true);
    Sound.bone&&Sound.bone();
  }catch(e){}
};
Fighter.prototype.gib=function(worldPt,dir,n,withBone){
  this.severedPieces=this.severedPieces||[];
  try{
    for(let i=0;i<n;i++){
      const c=new THREE.Mesh(new THREE.IcosahedronGeometry(.014+Math.random()*.02,0),
        stdMat(Math.random()<.5?0x6e1414:0x8e1e18,{roughness:.3}));
      c.position.copy(worldPt); scene.add(c);
      this.severedPieces.push({mesh:c,bleed:.7,
        vel:V3(dir.x*2+rand(-1.6,1.6),rand(1,2.6),dir.z*2+rand(-1.6,1.6)),
        ang:V3(rand(-9,9),rand(-9,9),rand(-9,9))});
    }
    if(withBone){
      const s=new THREE.Mesh(new THREE.ConeGeometry(.007,.05,5),
        stdMat(0xe0d8c4,{roughness:.4}));
      s.position.copy(worldPt); scene.add(s);
      this.severedPieces.push({mesh:s,bleed:0,
        vel:V3(dir.x*2.4,rand(1.6,3),dir.z*2.4),
        ang:V3(rand(-12,12),rand(-12,12),rand(-12,12))});
    }
  }catch(e){}
};
/* bright arcade marks: a saturated slash on skin, a splatter on cloth,
   a bruise bloom from fists — unlit so the night can't mute them */
const brightGashTex=canTex(128,64,(x,w,h)=>{
  x.clearRect(0,0,w,h);
  x.lineCap='round';
  x.strokeStyle='#c60d16'; x.lineWidth=11;
  x.beginPath(); x.moveTo(10,h*.5);
  for(let px=10;px<=w-10;px+=8)x.lineTo(px,h*.5+(Math.random()-.5)*h*.5);
  x.stroke();
  x.strokeStyle='#ff3540'; x.lineWidth=4;
  x.beginPath(); x.moveTo(12,h*.5);
  for(let px=12;px<=w-12;px+=8)x.lineTo(px,h*.5+(Math.random()-.5)*h*.36);
  x.stroke();
  x.fillStyle='#d81420';
  for(let i=0;i<10;i++)
    x.fillRect(Math.random()*w,h*.5+(Math.random()-.5)*h*.8,2.5,2.5);
});
const splatTex=canTex(128,128,(x,w,h)=>{
  x.clearRect(0,0,w,h);
  x.fillStyle='#c40d16';
  x.beginPath();
  for(let a=0;a<6.283;a+=.4){
    const r=w*.22*(0.7+Math.random()*.6);
    const px=w*.5+Math.cos(a)*r, py=h*.5+Math.sin(a)*r;
    a===0?x.moveTo(px,py):x.lineTo(px,py);
  }
  x.closePath(); x.fill();
  x.fillStyle='#e01822';
  for(let i=0;i<14;i++){ const a=Math.random()*6.283, r=w*(.26+Math.random()*.2);
    x.beginPath();
    x.arc(w*.5+Math.cos(a)*r,h*.5+Math.sin(a)*r,1.5+Math.random()*3.5,0,6.283);
    x.fill(); }
});
Fighter.prototype.addHitMark=function(partKey,worldPt,hitDir,severity,blunt){
  this._marks=(this._marks||0);
  if(this._marks>=24)return;
  const part=this.parts[partKey]; if(!part)return;
  this._marks++;
  try{
    const onCloth=!this.build.bare&&CLOTHED.test(partKey);
    const size=(severity==='mortal'?.23:severity==='severe'?.18:.13);
    const tex=blunt?null:(onCloth?splatTex:brightGashTex);
    const mat=new THREE.MeshBasicMaterial({
      map:tex||null,transparent:!!tex,depthWrite:false,
      color:blunt?0x7a1230:0xffffff,
      opacity:blunt?.75:1,
      polygonOffset:true,polygonOffsetFactor:-5});
    const m=new THREE.Mesh(
      new THREE.PlaneGeometry(size,blunt?size*.85:(onCloth?size:size*.45)),mat);
    part.updateMatrixWorld(true);
    m.position.copy(part.worldToLocal(worldPt.clone())).multiplyScalar(1.08);
    m.lookAt(m.position.clone().multiplyScalar(3));
    m.renderOrder=4;
    /* the stripe follows the cut's line */
    if(!onCloth&&!blunt&&hitDir)
      m.rotation.z=-Math.atan2(hitDir.y,
        Math.hypot(hitDir.x,hitDir.z)+.001)*1.1+rand(-.3,.3);
    else m.rotation.z=Math.random()*Math.PI;
    part.add(m);
  }catch(e){}
};
Fighter.prototype.addOpenWound=function(partKey,worldPt,severity){
  this._openW=(this._openW||0);
  if(this._openW>=14)return;
  const part=this.parts[partKey]; if(!part)return;
  this._openW++;
  try{
    const g=new THREE.Group();
    const deep=severity!=='severe'?true:Math.random()<.6;
    const big=severity==='mortal'?3.0:(severity==='severe'?2.1:1.4);
    const clothed=CLOTHED.test(partKey);
    /* torn cloth rim, in this fighter's own cloth color */
    if(clothed&&this.palette){
      const rim=jaggedCap(.052*big);
      rim.traverse(o=>{ if(o.isMesh&&o.material){
        o.material=stdMat(partKey==='chest'||/upperArm/.test(partKey)?
          this.palette.kimono:this.palette.hakama,{roughness:.92,
          side:THREE.DoubleSide}); } });
      rim.scale.z=.4; g.add(rim);
    }
    /* the flesh beneath */
    const meat=new THREE.Mesh(new THREE.SphereGeometry(.034*big,10,8),
      stdMat(0x6e1414,{roughness:.3}));
    meat.scale.set(1.25,.85,.45); g.add(meat);
    const meat2=new THREE.Mesh(new THREE.SphereGeometry(.021*big,9,7),
      stdMat(0x9c2820,{roughness:.18}));
    meat2.scale.set(1.1,.72,.5); meat2.position.z=.009*big; g.add(meat2);
    /* the bone, for the deep ones */
    if(deep){
      const bone=new THREE.Mesh(new THREE.CylinderGeometry(.008*big,.008*big,.05*big,6),
        stdMat(0xe0d8c4,{roughness:.45}));
      bone.rotation.z=Math.PI/2+rand(-.4,.4); bone.position.z=.014*big;
      g.add(bone);
      if(severity==='mortal'){          // shattered: a second splintered end
        const b2=bone.clone(); b2.rotation.z+=rand(.5,1.1);
        b2.position.x+=.02; g.add(b2);
      }
    }
    /* cloth flaps that hang and sway at the tear */
    if(clothed&&this.palette){
      this._flaps=this._flaps||[];
      for(let i=0;i<2;i++){
        const flap=new THREE.Mesh(new THREE.PlaneGeometry(.055,.09),
          new THREE.MeshStandardMaterial({
            color:partKey==='chest'?this.palette.kimono:this.palette.hakama,
            roughness:.92,side:THREE.DoubleSide,
            alphaMap:tearTex||null,transparent:!!tearTex,
            alphaTest:tearTex?.4:0}));
        flap.geometry.translate(0,-.045,0);      // hinge at the top edge
        flap.position.set((i?1:-1)*.03,.03,.006);
        flap.userData={ph:Math.random()*6.28,amp:.35+Math.random()*.4,
          base:rand(-.3,.3)};
        g.add(flap);
        this._flaps.push(flap);
      }
    }
    part.updateMatrixWorld(true);
    g.position.copy(part.worldToLocal(worldPt.clone())).multiplyScalar(1.07);
    g.lookAt(g.position.clone().multiplyScalar(3));
    g.traverse(o=>{ if(o.isMesh){ o.renderOrder=3;
      if(o.material){ o.material.polygonOffset=true;
        o.material.polygonOffsetFactor=-4; } } });
    part.add(g);
  }catch(e){}
};
Fighter.prototype.addGash=function(partKey,worldPt,dir){
  this._gashes=this._gashes||0;
  if(this._gashes>=20||!gashTex)return;
  const part=this.parts[partKey]; if(!part)return;
  this._gashes++;
  try{
    const g=new THREE.Group();
    const m=new THREE.Mesh(new THREE.PlaneGeometry(.21,.09),
      new THREE.MeshBasicMaterial({map:gashTex,transparent:true,
        depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
    /* parted flesh: two raised lips flanking the cut, wet interior */
    const lipM=stdMat(0x8a4038,{roughness:.45});
    for(const s of [1,-1]){
      const lip=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.11,6),lipM);
      lip.rotation.z=Math.PI/2; lip.position.y=s*.011; lip.position.z=.004;
      g.add(lip);
    }
    const wet=new THREE.Mesh(new THREE.PlaneGeometry(.11,.017),
      stdMat(0x4a0c0c,{roughness:.15}));
    wet.position.z=.002; g.add(wet,m);
    part.updateMatrixWorld(true);
    g.position.copy(part.worldToLocal(worldPt.clone()));
    g.position.multiplyScalar(.92);          // hug the surface
    g.lookAt(g.position.clone().multiplyScalar(2));
    g.rotation.z=Math.random()*Math.PI;
    part.add(g);
  }catch(e){}
};

/* ============ PRESSURE: wounds squirt in arcs, and keep squirting ======= */
const SQUIRTS=[];
function addSquirt(f,partKey,worldPt,dur,power){
  const part=f.parts[partKey]||f.parts.chest;
  try{
    part.updateMatrixWorld(true);
    SQUIRTS.push({f,part,local:part.worldToLocal(worldPt.clone()),
      t:dur,power,pulse:0});
  }catch(e){}
}
const _sq=V3(), _sd=V3();
function updateSquirts(dt){
  for(let i=SQUIRTS.length-1;i>=0;i--){
    const s=SQUIRTS[i];
    s.t-=dt;
    if(s.t<=0||!s.f.parts){ SQUIRTS.splice(i,1); continue; }
    s.pulse-=dt;
    if(s.pulse<=0){
      s.pulse=.11+Math.random()*.09;              // heart-paced spurts
      s.part.updateMatrixWorld(true);
      _sq.copy(s.local).applyMatrix4(s.part.matrixWorld);
      _sd.set(rand(-.6,.6),rand(.7,1.4),rand(-.6,.6)).normalize();
      emitBlood(_sq,_sd,(3+Math.random()*3)*s.power,
        Math.floor((7+Math.random()*7)*s.power));
    }
  }
}

/* contact shadows: soft dark blobs under feet and body — grounding
   that a single directional shadow can't provide */
const blobTex=canTex(64,64,(x,w,h)=>{
  const g=x.createRadialGradient(32,32,2,32,32,30);
  g.addColorStop(0,'rgba(8,10,16,.55)'); g.addColorStop(.6,'rgba(8,10,16,.28)');
  g.addColorStop(1,'rgba(8,10,16,0)');
  x.fillStyle=g; x.fillRect(0,0,w,h);
});
function mkBlobs(f){
  f.blobs=[];
  for(let i=0;i<3;i++){
    const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
      new THREE.MeshBasicMaterial({map:blobTex||null,transparent:true,
        depthWrite:false,opacity:1}));
    m.rotation.x=-Math.PI/2; m.renderOrder=2;
    scene.add(m); f.blobs.push(m);
  }
}
function updateBlobs(f){
  if(!f.blobs)mkBlobs(f);
  const set=(m,x,z,y,s,o)=>{ m.position.set(x,.006,z);
    m.scale.setScalar(s*(1+y*1.6)); m.material.opacity=o/(1+y*3); };
  const fr=f.feet.R,fl=f.feet.L;
  set(f.blobs[0],fr.p.x,fr.p.z,fr.lift||0,.34,.85);
  set(f.blobs[1],fl.p.x,fl.p.z,fl.lift||0,.34,.85);
  const py=f.physDead&&f.phys?f.phys.B.pelvis.pos.y:.9;
  set(f.blobs[2],f.pos.x,f.pos.z,0,f.physDead?1.5:.62,f.physDead?.5:.3);
}
const puffs=[];
function breathe(f,foe){
  const m=new THREE.SpriteMaterial({map:puffTex||null,transparent:true,
    opacity:.22,depthWrite:false});
  const s=new THREE.Sprite(m);
  TMP1.subVectors(foe.pos,f.pos).setY(0).normalize();
  s.position.copy(f.parts.head.position).addScaledVector(TMP1,.13); s.position.y-=.02;
  s.scale.set(.1,.08,1);
  s.userData={life:1.1,v:TMP1.clone().multiplyScalar(.28).setY(.22)};
  scene.add(s); puffs.push(s);
}
function updatePuffs(dt){
  for(let i=puffs.length-1;i>=0;i--){ const s=puffs[i],u=s.userData;
    u.life-=dt;
    if(u.life<=0){ scene.remove(s); puffs.splice(i,1); continue; }
    s.position.addScaledVector(u.v,dt); u.v.multiplyScalar(Math.exp(-1.4*dt));
    s.scale.x+=dt*.22; s.scale.y+=dt*.18;
    s.material.opacity=.22*clamp(u.life/1.1,0,1);
  }
}
let iceMesh=null;
function placeIce(){
  if(iceMesh){ scene.remove(iceMesh); iceMesh=null; }
  if(Math.random()<.25){ game.ice=null; return; }   // some nights, no ice
  const a=rand(0,Math.PI*2), rr=rand(1.4,RING_R-1.6);
  game.ice={x:Math.sin(a)*rr,z:Math.cos(a)*rr,r:rand(.7,1.15)};
  iceMesh=new THREE.Mesh(new THREE.CircleGeometry(game.ice.r,26),
    stdMat(0x9fb9cc,{roughness:.12,metalness:.25,transparent:true,opacity:.4}));
  iceMesh.rotation.x=-Math.PI/2; iceMesh.position.set(game.ice.x,.012,game.ice.z);
  scene.add(iceMesh);
}
const onIce=(p)=>game.ice&&Math.hypot(p.x-game.ice.x,p.z-game.ice.z)<game.ice.r;

/* ------------------ cloth: woven kimono, pleated hakama ---------------- */
const kimonoTex=canTex(512,512,(ctx,w,h)=>{
  ctx.fillStyle='#d8d8d8'; ctx.fillRect(0,0,w,h);
  /* tsumugi weave: fine cross-hatch with slub irregularities */
  for(let y=0;y<h;y+=2){ ctx.fillStyle='rgba(0,0,0,'+(.045+Math.random()*.05)+')';
    ctx.fillRect(0,y,w,1); }
  for(let x=0;x<w;x+=2){ ctx.fillStyle='rgba(255,255,255,'+(.03+Math.random()*.04)+')';
    ctx.fillRect(x,0,1,h); }
  for(let i=0;i<260;i++){ ctx.fillStyle=Math.random()<.5?'rgba(0,0,0,.08)':'rgba(255,255,255,.07)';
    ctx.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*3,1); }
});
if(kimonoTex){ kimonoTex.wrapS=kimonoTex.wrapT=THREE.RepeatWrapping; kimonoTex.repeat.set(3,3); }
const kimonoNrm=mkNormalTex(256,(x,w,h)=>{
  x.fillStyle='#808080'; x.fillRect(0,0,w,h);
  for(let y=0;y<h;y+=2){ x.fillStyle='rgba(0,0,0,.5)'; x.fillRect(0,y,w,1); }
  for(let i=0;i<w;i+=2){ x.fillStyle='rgba(255,255,255,.3)'; x.fillRect(i,0,1,h); }
},2.2);
if(kimonoNrm)kimonoNrm.repeat.set(3,3);
/* a FACE, painted the way 90s digitized fighters were: airbrushed skin
   values, socketed eyes with catchlights, feathered brows, two-tone lips.
   Painted per-fighter in his own skin tone; mapped onto the skull. */
function faceTex(skinHex,face){
  return canTex(512,512,(x,w,h)=>{
    const c=new THREE.Color(skinHex);
    const R=c.r*255,G=c.g*255,B=c.b*255;
    const tone=(m,a)=>'rgba('+Math.round(R*m)+','+Math.round(G*m)+','+Math.round(B*m)+','+(a===undefined?1:a)+')';
    x.fillStyle=tone(1); x.fillRect(0,0,w,h);
    /* airbrush: forehead light, temples/jaw shaded */
    let g=x.createLinearGradient(0,h*.3,0,h*.72);
    g.addColorStop(0,tone(1.1,.55)); g.addColorStop(.45,tone(1,.0));
    g.addColorStop(1,tone(.72,.5)); x.fillStyle=g; x.fillRect(0,0,w,h);
    g=x.createRadialGradient(w*.5,h*.5,w*.1,w*.5,h*.5,w*.34);
    g.addColorStop(0,tone(1.06,.3)); g.addColorStop(1,tone(.85,.35));
    x.fillStyle=g; x.fillRect(w*.2,h*.28,w*.6,h*.44);
    const mir=f=>{ for(const s of [1,-1]){ x.save();
      x.translate(w*.5,0); x.scale(s,1); f(x); x.restore(); } };
    /* eye sockets */
    mir(x=>{ const g2=x.createRadialGradient(w*.052,h*.435,2,w*.052,h*.435,w*.055);
      g2.addColorStop(0,tone(.62,.5)); g2.addColorStop(1,tone(1,0));
      x.fillStyle=g2; x.beginPath();
      x.ellipse(w*.052,h*.435,w*.055,h*.038,0,0,6.29); x.fill(); });
    /* whites, iris, pupil, catchlight */
    mir(x=>{ x.fillStyle='rgba(226,220,206,.95)'; x.beginPath();
      x.ellipse(w*.052,h*.44,w*.03,h*.016,0,0,6.29); x.fill();
      x.fillStyle='#3a2a1c'; x.beginPath();
      x.arc(w*.052,h*.441,w*.0145,0,6.29); x.fill();
      x.fillStyle='#120c08'; x.beginPath();
      x.arc(w*.052,h*.441,w*.007,0,6.29); x.fill();
      x.fillStyle='rgba(255,255,255,.9)'; x.beginPath();
      x.arc(w*.046,h*.435,w*.004,0,6.29); x.fill();
      /* lash line + lid crease */
      x.strokeStyle='rgba(30,20,14,.85)'; x.lineWidth=w*.006;
      x.beginPath(); x.ellipse(w*.052,h*.437,w*.031,h*.015,0,Math.PI*1.05,Math.PI*1.95);
      x.stroke();
      x.strokeStyle=tone(.7,.55); x.lineWidth=w*.004;
      x.beginPath(); x.ellipse(w*.052,h*.428,w*.033,h*.014,0,Math.PI*1.1,Math.PI*1.9);
      x.stroke(); });
    /* brows: feathered strokes, angled */
    mir(x=>{ x.strokeStyle='rgba(24,17,12,.9)'; x.lineWidth=w*.004;
      for(let i=0;i<9;i++){
        const t=i/8, bx=w*(.022+t*.062), by=h*(.402-t*.014)+Math.random()*h*.004;
        x.beginPath(); x.moveTo(bx,by+h*.008); x.lineTo(bx+w*.008,by-h*.006); x.stroke(); } });
    /* nostril shadows (the 3D nose sits above) */
    mir(x=>{ x.fillStyle=tone(.55,.6); x.beginPath();
      x.ellipse(w*.018,h*.532,w*.009,h*.006,.4,0,6.29); x.fill(); });
    /* lips: two-tone with center line and highlight */
    g=x.createLinearGradient(0,h*.575,0,h*.605);
    g.addColorStop(0,'rgba(148,86,72,.95)'); g.addColorStop(.5,'rgba(120,62,52,.95)');
    g.addColorStop(.52,'rgba(60,32,26,.95)'); g.addColorStop(.62,'rgba(158,96,80,.95)');
    g.addColorStop(1,'rgba(134,78,64,.9)');
    x.fillStyle=g; x.beginPath();
    x.ellipse(w*.5,h*.59,w*.042,h*.017,0,0,6.29); x.fill();
    x.fillStyle='rgba(255,235,225,.25)'; x.beginPath();
    x.ellipse(w*.5,h*.597,w*.02,h*.005,0,0,6.29); x.fill();
    /* chin + jaw shading, philtrum */
    g=x.createRadialGradient(w*.5,h*.655,2,w*.5,h*.655,w*.05);
    g.addColorStop(0,tone(1.05,.3)); g.addColorStop(1,tone(.8,.25));
    x.fillStyle=g; x.fillRect(w*.42,h*.61,w*.16,h*.09);
    x.strokeStyle=tone(.8,.4); x.lineWidth=w*.005;
    x.beginPath(); x.moveTo(w*.5,h*.555); x.lineTo(w*.5,h*.572); x.stroke();
    if(face&&face.feminine){
      /* stronger lash line, fuller lips, softer jaw */
      const m=(f)=>{ for(const s of [1,-1]){ x.save();
        x.translate(w*.5,0); x.scale(s,1); f(x); x.restore(); } };
      m(x=>{ x.strokeStyle='rgba(20,12,10,.95)'; x.lineWidth=w*.009;
        x.beginPath();
        x.ellipse(w*.052,h*.436,w*.033,h*.016,0,Math.PI*1.02,Math.PI*1.98);
        x.stroke(); });
      g=x.createLinearGradient(0,h*.575,0,h*.61);
      g.addColorStop(0,'rgba(178,86,88,.95)'); g.addColorStop(.5,'rgba(150,58,62,.95)');
      g.addColorStop(.52,'rgba(80,30,34,.95)'); g.addColorStop(1,'rgba(188,96,98,.95)');
      x.fillStyle=g; x.beginPath();
      x.ellipse(w*.5,h*.59,w*.046,h*.02,0,0,6.29); x.fill();
    }
    /* stubble for the bearded */
    if(face&&(face.beard||face.stubble)){
      x.fillStyle='rgba(25,18,12,.16)';
      for(let i=0;i<900;i++){ const a=Math.random()*6.29,r=Math.random();
        const px=w*.5+Math.cos(a)*w*.11*r, py=h*.62+Math.sin(a)*h*.07*r;
        if(py>h*.6)x.fillRect(px,py,1.4,1.4); } }
  });
}
const skinTex=canTex(512,512,(ctx,w,h)=>{
  ctx.fillStyle='#d9d2ca'; ctx.fillRect(0,0,w,h);
  /* subsurface mottle: warm and cool blotches, very soft */
  for(let i=0;i<140;i++){
    const x=Math.random()*w,y=Math.random()*h,r=6+Math.random()*22;
    const g=ctx.createRadialGradient(x,y,1,x,y,r);
    const warm=Math.random()<.55;
    g.addColorStop(0,warm?'rgba(198,120,100,.06)':'rgba(120,130,150,.05)');
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,6.29); ctx.fill();
  }
  /* pores and grain */
  for(let i=0;i<2600;i++){
    ctx.fillStyle='rgba(90,70,60,'+(0.015+Math.random()*.03)+')';
    ctx.fillRect(Math.random()*w,Math.random()*h,1,1);
  }
});
if(skinTex){ skinTex.wrapS=skinTex.wrapT=THREE.RepeatWrapping; skinTex.repeat.set(2,2); }
const skinNrm=mkNormalTex(256,(x,w,h)=>{
  x.fillStyle='#808080'; x.fillRect(0,0,w,h);
  for(let i=0;i<3200;i++){ const v=Math.random()<.5;
    x.fillStyle=v?'rgba(60,60,60,.5)':'rgba(190,190,190,.35)';
    const s=Math.random()<.85?1:2;
    x.fillRect(Math.random()*w,Math.random()*h,s,s); }
},1.1);
if(skinNrm)skinNrm.repeat.set(2,2);
overrideTex('kimono',t=>{ t.repeat.set(3,3); kimonoTex&&(kimonoTex.image=t.image,kimonoTex.needsUpdate=true); });
overrideTex('hakama',t=>{ t.repeat.set(4,1.6); hakamaTex&&(hakamaTex.image=t.image,hakamaTex.needsUpdate=true); });
overrideTex('skin',t=>{ t.repeat.set(2,2); skinTex&&(skinTex.image=t.image,skinTex.needsUpdate=true); });
const hakamaTex=canTex(512,512,(ctx,w,h)=>{
  ctx.fillStyle='#d2d2d2'; ctx.fillRect(0,0,w,h);
  /* pleats: broad vertical bands, each shaded across its width */
  const P=5, bw=w/P;
  for(let i=0;i<P;i++){
    const g=ctx.createLinearGradient(i*bw,0,(i+1)*bw,0);
    g.addColorStop(0,'rgba(255,255,255,.16)');
    g.addColorStop(.45,'rgba(0,0,0,0)');
    g.addColorStop(.92,'rgba(0,0,0,.34)');
    g.addColorStop(1,'rgba(0,0,0,.5)');
    ctx.fillStyle=g; ctx.fillRect(i*bw,0,bw,h);
  }
  for(let y=0;y<h;y+=2){ ctx.fillStyle='rgba(0,0,0,'+(.03+Math.random()*.04)+')';
    ctx.fillRect(0,y,w,1); }
});
if(hakamaTex){ hakamaTex.wrapS=hakamaTex.wrapT=THREE.RepeatWrapping; hakamaTex.repeat.set(4,1.6); }
const hakamaNrm=mkNormalTex(256,(x,w,h)=>{
  const P=5,bw=w/P;
  for(let i=0;i<P;i++){
    const g=x.createLinearGradient(i*bw,0,(i+1)*bw,0);
    g.addColorStop(0,'#b0b0b0'); g.addColorStop(.5,'#707070');
    g.addColorStop(.94,'#404040'); g.addColorStop(1,'#c0c0c0');
    x.fillStyle=g; x.fillRect(i*bw,0,bw,h);
  }
},3);
if(hakamaNrm)hakamaNrm.repeat.set(4,1.6);

/* ============ FIGHTING-GAME RENDER KIT: silhouette + edge light ========
   90s arcade readability: every fighter wears a dark inverted-hull
   OUTLINE (normal-displaced so it deforms with the skin) and a cool
   fresnel RIM so the silhouette pops off the night. O toggles outlines. */
const OUTLINE={on:true,meshes:[]};
function addOutline(mesh,thick){
  try{
    if(!mesh.geometry||!mesh.geometry.attributes.position)return;
    if(mesh.geometry.attributes.position.count<60)return;   // skip face micro-parts
    const mat=new THREE.MeshBasicMaterial({color:0x04060b,side:THREE.BackSide});
    if(mesh.isSkinnedMesh)mat.skinning=true;
    const t=(thick||.007).toFixed(4);
    mat.onBeforeCompile=s=>{ s.vertexShader=s.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += objectNormal*'+t+';'); };
    let o;
    if(mesh.isSkinnedMesh){ o=new THREE.SkinnedMesh(mesh.geometry,mat);
      o.bind(mesh.skeleton,mesh.bindMatrix); }
    else o=new THREE.Mesh(mesh.geometry,mat);
    o.frustumCulled=false; o.castShadow=false; o.userData.outline=true;
    mesh.add(o); OUTLINE.meshes.push(o);
  }catch(e){}
}
function rimify(m,r,g,b,power,strength){
  m.onBeforeCompile=s=>{ s.fragmentShader=s.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n'+
    '{ float f=pow(1.0-clamp(dot(normalize(vNormal),normalize(vViewPosition)),0.0,1.0),'+power.toFixed(1)+');\n'+
    '  totalEmissiveRadiance += vec3('+r+','+g+','+b+')*f*'+strength+'; }'); };
  return m;
}

/* ================= CLOTH: the hakama obeys gravity ==================
   Verlet panels pinned at the waist, colliding with the legs, settling
   over the corpse. Real fabric, ~60 points per fighter. */
function mkClothPanel(cols,rows,mat){
  const geo=new THREE.PlaneGeometry(1,1,cols-1,rows-1);
  const mesh=new THREE.Mesh(geo,mat);
  mesh.frustumCulled=false; mesh.castShadow=true;
  const pts=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)
    pts.push({p:V3(),pp:V3(),pin:r===0});
  const cons=[];
  const idx=(r,c)=>r*cols+c;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const wSp=lerp(.062,.088,r/(rows-1));            // hakama flares
    if(c+1<cols)cons.push([idx(r,c),idx(r,c+1),wSp]);
    if(r+1<rows)cons.push([idx(r,c),idx(r+1,c),.1]);
    if(c+1<cols&&r+1<rows)cons.push([idx(r,c),idx(r+1,c+1),Math.hypot(wSp,.1)*1.02]);
  }
  return {mesh,pts,cons,cols,rows,ni:0};
}
const _cp=V3(), _cq=V3();
function segPush(pt,a,b,rad){
  _cp.subVectors(b,a);
  const L2=_cp.lengthSq(); if(L2<1e-8)return;
  let t=_cq.subVectors(pt,a).dot(_cp)/L2; t=clamp(t,0,1);
  _cq.copy(a).addScaledVector(_cp,t);
  const d=pt.distanceTo(_cq);
  if(d<rad&&d>1e-6)pt.addScaledVector(TMP1.subVectors(pt,_cq).divideScalar(d),rad-d);
}
Fighter.prototype.buildCloth=function(hakamaMat){
  if(this.build.cloth===false)return;
  this.cloth=[];
  for(const side of [1,-1]){   // front, back
    const P=mkClothPanel(6,5,hakamaMat);
    P.side=side;
    scene.add(P.mesh);
    /* start points near the pelvis so the first frames don't explode */
    for(const q of P.pts){ q.p.set(this.pos.x,0.7,this.pos.z); q.pp.copy(q.p); }
    this.cloth.push(P);
  }
  if(this.skirtF)this.skirtF.visible=false;
  if(this.skirtB)this.skirtB.visible=false;
};
Fighter.prototype.tickCloth=function(dt,J){
  if(!this.cloth)return;
  dt=Math.min(dt,.033);
  const yaw=this.bodyYaw||0, fwd=DIRY(yaw), right=V3(fwd.z,0,-fwd.x);
  for(const P of this.cloth){
    /* pin the waistband */
    for(let c=0;c<P.cols;c++){
      const q=P.pts[c];
      const lx=(c/(P.cols-1)-.5)*.3;
      q.p.copy(J.pelvis)
        .addScaledVector(right,lx)
        .addScaledVector(fwd,P.side*.125);
      q.p.y=J.pelvis.y-.06;
      q.pp.copy(q.p);
    }
    /* verlet */
    for(let i=P.cols;i<P.pts.length;i++){
      const q=P.pts[i];
      TMP2.subVectors(q.p,q.pp).multiplyScalar(.965);
      q.pp.copy(q.p);
      q.p.add(TMP2);
      q.p.y-=5.4*dt*dt;                                   // gravity (verlet form)
      q.p.addScaledVector(fwd,Math.sin(performance.now()*.0012+i)*.0004);
      q.p.addScaledVector(this.vel,-dt*.25);              // drag from movement
    }
    for(let it=0;it<3;it++){
      for(const [a,b,rest] of P.cons){
        const A=P.pts[a],B=P.pts[b];
        TMP2.subVectors(B.p,A.p);
        const d=TMP2.length(); if(d<1e-6)continue;
        const diff=(d-rest)/d*.5;
        if(!A.pin)A.p.addScaledVector(TMP2,diff*(B.pin?2:1));
        if(!B.pin)B.p.addScaledVector(TMP2,-diff*(A.pin?2:1));
      }
      /* the legs are inside the garment */
      for(let i=P.cols;i<P.pts.length;i++){
        const q=P.pts[i];
        segPush(q.p,J.hipR,J.knR,.1); segPush(q.p,J.knR,J.ankR,.085);
        segPush(q.p,J.hipL,J.knL,.1); segPush(q.p,J.knL,J.ankL,.085);
        if(q.p.y<.015)q.p.y=.015;
      }
    }
    /* write to the mesh */
    const pos=P.mesh.geometry.attributes.position;
    for(let i=0;i<P.pts.length;i++)
      pos.setXYZ(i,P.pts[i].p.x,P.pts[i].p.y,P.pts[i].p.z);
    pos.needsUpdate=true;
    if((P.ni++&1)===0)P.mesh.geometry.computeVertexNormals();
  }
};

/* THE GRIP CONE — a two-handed katana has a hard orientation envelope:
   up to full jodan overhead (even cocked slightly back), down to a deep
   gedan (~46° below), out to waki at the flank — but never inverted, and
   never backward through your own chest. */
function clampBladeDir(d,fwd,right){
  let lx=d.dot(right), ly=clamp(d.y,-.72,.999), lz=d.dot(fwd);
  /* backward is legal only overhead (jodan cock) or at the flank (waki) */
  if(ly<.7&&Math.abs(lx)<.55&&lz<.06)lz=.06;
  const h=Math.sqrt(Math.max(1-ly*ly,1e-6)), hl=Math.hypot(lx,lz)||1e-6;
  lx*=h/hl; lz*=h/hl;
  return d.set(0,ly,0).addScaledVector(right,lx).addScaledVector(fwd,lz).normalize();
}



/* ---------------- kamae: the five guards, as tip targets --------------- */
const KAMAE={
  chudan:(o,p,fwd,right)=>o.copy(p).addScaledVector(fwd,.95).setY(1.28),
  seigan:(o,p,fwd,right)=>o.copy(p).addScaledVector(fwd,.90).setY(1.44),
  jodan: (o,p,fwd,right)=>o.copy(p).addScaledVector(fwd,.24)
           .addScaledVector(right,.10).setY(2.02),
  gedan: (o,p,fwd,right)=>o.copy(p).addScaledVector(fwd,.85).setY(.70),
  waki:  (o,p,fwd,right)=>o.copy(p).addScaledVector(fwd,-.28)
           .addScaledVector(right,.52).setY(.92),
};

/* ------------------------- the opponent ladder ------------------------- */
const DUELISTS=[
  {name:'KIYOMASA', kanji:'猪', epithet:'the Boar',
   palette:{kimono:0x542c20,hakama:0x2a1810,obi:0xc07a20,skin:0xbf9276,accent:0x101010,
     face:{beard:true}},
   ai:{skill:.72,reaction:.24,engage:[1.2,2.0],atkCircle:.62,atkBlock:.3,
       windupT:[.36,.5],strikeT:[.3,.44],speedMul:.8,parry:.12,maai:1.95,tempo:[.5,1.2],
       kamae:'jodan'}},
  {name:'GENNOSUKE', kanji:'鏡', epithet:'the Mirror',
   palette:{kimono:0x2c3e52,hakama:0x18222e,obi:0xd8d0b8,skin:0xc9a184,accent:0x0e0e0e},
   ai:{skill:.86,reaction:.14,engage:[2.2,3.4],atkCircle:.16,atkBlock:.66,
       windupT:[.3,.42],strikeT:[.28,.4],speedMul:.9,parry:.5,maai:2.3,tempo:[.9,1.9],
       kamae:'seigan'}},
  {name:'SHIZUKA', kanji:'静', epithet:'First Draw',
   palette:{kimono:0x46302a,hakama:0x241a14,obi:0xa82424,skin:0xbf9276,accent:0x101010,
     face:{mustache:true}},
   ai:{skill:.95,reaction:.11,engage:[2.6,4.2],atkCircle:.32,atkBlock:.28,
       windupT:[.2,.3],strikeT:[.26,.36],speedMul:1.02,parry:.35,maai:2.5,tempo:[1.2,2.4],
       kamae:'waki'}},
];
game.stage=0; game.advance=false;
game.legacy=null;

/* after the named three, the road provides — endlessly, and harder */
const GEN={
  syl:['Ka','Ju','Mune','Tada','Yoshi','Nobu','Hiro','Masa','Kage','Ryu','Tomo','Iku','Sada','Gen'],
  syl2:['tsune','maru','katsu','nori','shige','taka','zane','hide','tomo','yasu','mori','oki'],
  kanji:['刃','鬼','嵐','霜','狼','影','雷','岩','鷹','蛇'],
  epi:['the Wolf','the Storm','of the Frost','the Unmoved','the Left-Handed',
       'of Two Heavens','the Silent','the Ox','of the Red Sheath','the Pilgrim'],
  kamae:['chudan','seigan','jodan','gedan','waki'],
};
function genDuelist(stage){
  const name=(GEN.syl[Math.floor(Math.random()*GEN.syl.length)]
    +GEN.syl2[Math.floor(Math.random()*GEN.syl2.length)]).toUpperCase();
  const s=Math.min(.985,.8+stage*.018+Math.random()*.05);
  const arch=Math.random();          // blend of the three schools
  return {name,
    kanji:GEN.kanji[Math.floor(Math.random()*GEN.kanji.length)],
    epithet:GEN.epi[Math.floor(Math.random()*GEN.epi.length)],
    palette:{kimono:[0x3a2420,0x27313d,0x352822,0x2c3527,0x3d2733][Math.floor(Math.random()*5)],
      hakama:0x1c1712,obi:[0x8a5a1f,0xb9b3a4,0x7c1f1f,0x746c58][Math.floor(Math.random()*4)],
      skin:0xbf9276,accent:0x101010,
      face:{beard:Math.random()<.3,mustache:Math.random()<.35}},
    ai:{skill:s,reaction:lerp(.2,.1,s),engage:[1.4+arch*1.4,2.4+arch*1.8],
      atkCircle:lerp(.6,.2,arch),atkBlock:lerp(.3,.6,arch),
      windupT:[lerp(.34,.2,s),lerp(.5,.3,s)],strikeT:[.26,.4],
      speedMul:Math.min(1.1,.82+stage*.02+Math.random()*.06),
      parry:lerp(.15,.55,arch),maai:1.9+arch*.7,tempo:[.5+arch*.7,1.2+arch*1.2],
      kamae:GEN.kamae[Math.floor(Math.random()*5)]}};
}

function setup(){
  if(player){ disposeFighter(player); disposeFighter(enemy); }
  for(const p of bloodStains)scene.remove(p.mesh); bloodStains.length=0;
  for(const m of allStains)scene.remove(m); allStains.length=0; stainCount=0;
  if(groundMark)groundMark.reset();   // fresh snow fell overnight
  player=new Fighter(BUILDS[SELECT.P].label.split(' — ')[0],
    null,-1.9,1,true,SELECT.P);
  const D=DUELISTS[game.stage];
  enemy=new Fighter(D.name,SELECT.E==='musashi'?D.palette:null,1.9,-1,false,SELECT.E);
  enemy.speedMul=D.ai.speedMul;
  const lbl=document.getElementById('name-enemy');
  if(lbl)lbl.innerHTML='<span style="color:var(--dim)">'+D.kanji+' </span>'+D.name
    +' <span style="color:var(--dim);font-size:11px">幕'+(game.stage+1)+'</span>';
  if(game.legacy){
    player.legDamage.R=game.legacy.legR; player.legDamage.L=game.legacy.legL;
    player.blood=game.legacy.blood;
    if(game.legacy.legR>.2||game.legacy.legL>.2||game.legacy.blood<4600)
      log('the old wounds ache in the cold — they never fully leave',false);
  }
  enemyAI=new AI(enemy,DUELISTS[game.stage].ai);
  player.yaw=Math.atan2(enemy.pos.x-player.pos.x,enemy.pos.z-player.pos.z);
  enemy.yaw=Math.atan2(player.pos.x-enemy.pos.x,player.pos.z-enemy.pos.z);
  buildDiagram(document.getElementById('diagram-player'));
  buildDiagram(document.getElementById('diagram-enemy'));
  logEl.innerHTML='';
}
function disposeFighter(f){
  if(f.cloth)for(const P of f.cloth)scene.remove(P.mesh);
  scene.remove(f.root); scene.remove(f.katana); scene.remove(f.trailMesh);
  if(f.skin)scene.remove(f.skin.mesh);
  if(f.glint)scene.remove(f.glint);
  if(f.blobs)for(const b of f.blobs)scene.remove(b);
  f._asleep=false; f._calm=0;
  f.disposePhys&&f.disposePhys();
  if(f.model){ scene.remove(f.model.root); f.model=null; }
  for(const k in f.parts)scene.remove(f.parts[k]);
}
function restart(){
  if(game.advance===true)game.stage=Math.min(game.stage+1,DUELISTS.length-1);
  OUTLINE.meshes=OUTLINE.meshes.filter(o=>!!o.parent&&o.parent.parent!==null);
  game.advance=false; killCam=null; game.firstBlood=false;
  game.bind=null; game._bindN=0; placeIce();
  game.introT=0;
  if(MODELPIPE.enabled)setTimeout(()=>{
    let any=false;
    for(const f of [player,enemy]){ if(!f)continue;
      if(f.model)any=MODELPIPE.playClip(f,'draw',.1)||any;
      else any=MODELPIPE.playPuppet(f,'draw')||any; }
    if(any)game.introT=1.55;
  },250);
  document.body.classList.remove('cine');
  document.getElementById('verdict').classList.add('hidden');
  setTimeout(grabPointer,60);
  if(MODELPIPE.enabled){
    if(MODELPIPE.current.P)player.setModel(MODELPIPE.current.P);
    if(MODELPIPE.current.E)enemy.setModel(MODELPIPE.current.E);
  }
  setup(); game.state='fight'; game.timeScale=1; game.duelTime=0;
}
function endDuel(){
  game.state='over';
  Sound.killMoment();
  const won=enemy.dead;
  const v=document.getElementById('verdict');
  const K=document.getElementById('verdict-kanji');
  if(won){
    if(game.stage+1>=DUELISTS.length)DUELISTS.push(genDuelist(game.stage+1));
    K.textContent=game.stage===2?'三':'勝'; K.className='kanji';
    document.getElementById('verdict-sub').textContent=
      (game.stage===2?'三人斬り — AND STILL THEY COME · ':'YOU PREVAIL — ')+
      'NEXT: '+DUELISTS[game.stage+1].name+', '+DUELISTS[game.stage+1].epithet;
    game.advance=true;
    /* the body remembers: wounds follow you to the next duel, half-healed */
    game.legacy={
      legR:player.legDamage.R*.6, legL:player.legDamage.L*.6,
      blood:Math.max(3600,5000-(5000-player.blood)*.4),
      kills:(game.legacy?game.legacy.kills:0)+1,
      woundsCarried:(game.legacy?game.legacy.woundsCarried:0)+player.wounds.length};
  } else {
    K.textContent='死'; K.className='kanji red';
    const kills=game.legacy?game.legacy.kills:0;
    let best=0; try{ best=+localStorage.getItem('zan_best')||0;
      if(kills>best){ best=kills; localStorage.setItem('zan_best',kills); } }catch(e){}
    document.getElementById('verdict-sub').textContent=
      kills>0?('生涯 — FELL IN DUEL '+(game.stage+1)+' · '+kills+' CUT DOWN BEFORE HIM'
        +(best>0?' · BEST: '+best:''))
      :'YOU FALL';
    game.advance=false; game.legacy=null; game.stage=0;
  }
  const dead=won?enemy:player;
  document.getElementById('cause').textContent=
    (won?enemy.name:'Musashi')+' — cause of death: '+(dead.deathCause||'wounds')+'.'+
    ' Duel lasted '+game.duelTime.toFixed(1)+'s. Wounds dealt: '+enemy.wounds.length+' · taken: '+player.wounds.length+
    (player.parries?'. Parries: '+player.parries:'')+'.'
  ;
  setTimeout(()=>v.classList.remove('hidden'),1400);
  try{ document.exitPointerLock&&document.exitPointerLock(); }catch(e){}
  beginKillCam(won?enemy:player, won?player:enemy);
}

document.getElementById('btn-begin').addEventListener('click',()=>{
  Sound.ac().resume&&Sound.ac().resume();
  Sound.startWind();
  document.getElementById('menu').classList.add('hidden');
  setTimeout(grabPointer,60);
  restart();
});
document.getElementById('btn-again').addEventListener('click',restart);

/* ==================== TOUCH CONTROLS ====================
   Left thumb: footwork joystick. Right half: the SWORD — your finger
   position is the tip, exactly as the mouse is on desktop.
   Hold GUARD / THRUST buttons. */
if(IS_TOUCH){
  document.body.classList.add('touch');
  const joy=document.getElementById('joy'),
        nub=document.getElementById('joynub'),
        zone=document.getElementById('swordzone');
  let joyId=null, swId=null;
  const setKeys=(x,y)=>{           // analog → the same keys combat reads
    input.keys.KeyW=y>.3;  input.keys.KeyS=y<-.3;
    input.keys.KeyD=x>.3;  input.keys.KeyA=x<-.3;
  };
  const joyAt=(t)=>{
    const r=joy.getBoundingClientRect();
    let dx=(t.clientX-(r.left+r.width/2))/(r.width/2),
        dy=((r.top+r.height/2)-t.clientY)/(r.height/2);
    const m=Math.hypot(dx,dy); if(m>1){ dx/=m; dy/=m; }
    nub.style.left=(38+dx*38)+'px'; nub.style.top=(38-dy*38)+'px';
    setKeys(dx,dy);
  };
  const swordAt=(t)=>{
    const r=zone.getBoundingClientRect();
    const nx=((t.clientX-r.left)/r.width)*2-1;          // -1..1 across zone
    const ny=1-((t.clientY-r.top)/r.height);            // 0 bottom..1 top
    input.mx=clamp(nx*1.5,-1.3,1.3);
    input.my=clamp(ny*1.45-.15,-.1,1.25);
  };
  joy.addEventListener('touchstart',e=>{ e.preventDefault();
    const t=e.changedTouches[0]; joyId=t.identifier; joyAt(t); },{passive:false});
  zone.addEventListener('touchstart',e=>{ e.preventDefault();
    const t=e.changedTouches[0]; swId=t.identifier; swordAt(t); },{passive:false});
  addEventListener('touchmove',e=>{
    for(const t of e.changedTouches){
      if(t.identifier===joyId)joyAt(t);
      else if(t.identifier===swId)swordAt(t);
    }
    if(joyId!==null||swId!==null)e.preventDefault();
  },{passive:false});
  addEventListener('touchend',e=>{
    for(const t of e.changedTouches){
      if(t.identifier===joyId){ joyId=null;
        nub.style.left='38px'; nub.style.top='38px'; setKeys(0,0); }
      if(t.identifier===swId)swId=null;   // blade rests where you left it
    }
  });
  const hold=(id,fn)=>{
    const b=document.getElementById(id);
    b.addEventListener('touchstart',e=>{ e.preventDefault();
      b.classList.add('on'); fn(true); },{passive:false});
    b.addEventListener('touchend',e=>{ e.preventDefault();
      b.classList.remove('on'); fn(false); },{passive:false});
  };
  hold('btn-guard',v=>input.rmb=v);
  hold('btn-thrust',v=>input.shift=v);
  document.addEventListener('contextmenu',e=>e.preventDefault());
}
document.addEventListener('click',ev=>{
  const b=ev.target&&ev.target.closest?ev.target.closest('.selbtn'):null;
  if(!b)return;
  ev.stopPropagation();
  const map={'selP-prev':['P',-1],'selP-next':['P',1],
             'selE-prev':['E',-1],'selE-next':['E',1]};
  const wmap={'selWP-prev':['P',-1],'selWP-next':['P',1],
              'selWE-prev':['E',-1],'selWE-next':['E',1]};
  const m=map[b.id], wm=wmap[b.id];
  if(m)PICKER.cycle(m[0],m[1]);
  if(wm)PICKER.cycleW(wm[0],wm[1]);
},true);
pickdbg('picker ready \u00b7 click the arrows');

/* =============================== THE BIND ==============================
   Real fencing lives in blade contact: pressure, leverage, feeling the
   other man's intent through steel. Win the pressure and his blade flies
   wide; yield too long and yours does. */
function updateBind(dt){
  /* detection: sustained quiet contact */
  if(!game.bind){
    game._bindN=game._bindTouch?(game._bindN||0)+1:0;
    game._bindTouch=false;
    if(game._bindN>=8&&game.state==='fight'){
      if((player.weapon&&player.weapon.blunt)||(enemy.weapon&&enemy.weapon.blunt)){
        game._bindN=0;   // there is no bind without two blades
      } else
      game.bind={t:0,pr:0,pt:game._bindPt.clone(),scr:0,yielding:false};
      /* the Mirror yields on purpose, to whirl and counter */
      if(enemyAI.P.kamae==='seigan'&&Math.random()<.6)game.bind.yielding=true;
      log('the blades bind — press, or be pressed',false);
    }
    return;
  }
  const B=game.bind; B.t+=dt;
  const pushDir=TMP1.subVectors(enemy.pos,player.pos).setY(0).normalize();
  /* player pressure: drive the sword (and your feet) into him */
  const pP=clamp(TMP2.subVectors(player.tipTarget,B.pt).dot(pushDir)*1.6,-1,1.6)
    +(input.keys&&input.keys.KeyW?.45:0);
  /* his pressure: skill, boldness, and how afraid he is */
  const md=enemyAI.mood;
  let pE=enemyAI.skill*.85+md.aggr*.5-md.fear*.5+rand(-.15,.15);
  if(B.yielding)pE*=.25;
  B.pr+=(pP*(player.swordControl)-pE)*dt*.9;
  /* both blades pinned to the contest */
  player.tipTarget.copy(B.pt).addScaledVector(pushDir,clamp(B.pr,-1,1)*.28);
  enemy.tipTarget.copy(B.pt).addScaledVector(pushDir,clamp(B.pr,-1,1)*.28);
  player.stamina=Math.max(0,player.stamina-dt*6);
  enemy.stamina=Math.max(0,enemy.stamina-dt*6);
  B.scr-=dt;
  if(B.scr<=0){ B.scr=.3+Math.random()*.25;
    Sound.scrape&&Sound.scrape(); sparks(B.pt,3); }
  const disengage=input.keys&&input.keys.KeyS;
  if(B.pr>1){          // you drive through him
    enemy.stun=Math.max(enemy.stun,.5); enemy.stagger=(enemy.stagger||0)+.6;
    enemy.tipTarget.addScaledVector(pushDir,-1).setY(.6);
    enemy.softHit('shR',pushDir,1.8);
    log('you drive his blade aside — an opening!',false);
    game.timeScale=.45; game.slowT=.25; game.bind=null;
  } else if(B.pr<-1){  // he throws yours wide
    player.stun=Math.max(player.stun,.5); player.stagger=(player.stagger||0)+.6;
    player.softHit('shR',TMP2.copy(pushDir).negate(),1.8);
    log('he throws your blade wide!',false);
    game.bind=null;
    if(enemyAI.state!=='attack')enemyAI.beginAttack(player);
  } else if(B.yielding&&B.t>.9){   // the Mirror whirls away
    game.bind=null; enemyAI.beginAttack(player);
    log('he yields — and whirls into the cut!',false);
  } else if(disengage&&B.t>.3){
    game.bind=null;
    log('you break the bind and step away',false);
    if(Math.random()<.4)enemyAI.beginAttack(player);
  } else if(B.t>2.6){
    game.bind=null;
    player.softHit('chestT',TMP2.copy(pushDir).negate(),1.1);
    enemy.softHit('chestT',pushDir,1.1);
    log('the bind breaks — both step back',false);
  }
}

/* ============================== CAMERA ================================= */
let killCam=null;
function beginKillCam(victim,victor){
  killCam={victim,victor,t:0,ritual:0,flicked:false,orbit:rand(0,Math.PI*2)};
  document.body.classList.add('cine');
}
function updateKillRitual(dt){
  if(!killCam)return;
  const kc=killCam; kc.ritual+=dt;
  const vt=kc.victor;
  if(!vt.alive)return;
  /* THE TAKING: the victor walks to the fallen, takes the head,
     and hurls it across the ring. Then, and only then, the sheathing. */
  const loser=vt.isPlayer?enemy:player;
  const headless=!loser||!loser.parts||loser.severed.head;
  const bare=!!(vt.weapon&&vt.weapon.blunt);
  kc.sheathAt=(headless||kc.beheadDone)&&!bare
    ?Math.max(kc.sheathAt||1.1,kc.thrownAt?kc.thrownAt+1.7:1.1):99;
  if(!headless&&loser.dead){
    const hp=loser.parts.head.position;
    if(kc.ritual>1.2&&!kc.released){
      TMP1.set(hp.x-vt.pos.x,0,hp.z-vt.pos.z);
      const d=TMP1.length();
      if(d>.85&&!kc.chopT){                       // walk to the body
        TMP1.divideScalar(d);
        vt.vel.x=lerp(vt.vel.x,TMP1.x*1.1,clamp(dt*4,0,1));
        vt.vel.z=lerp(vt.vel.z,TMP1.z*1.1,clamp(dt*4,0,1));
        vt.yaw=vt.bodyYaw=Math.atan2(TMP1.x,TMP1.z);
        vt.tipTarget.copy(vt.pos).addScaledVector(DIRY(vt.bodyYaw),.9).setY(1.1);
      } else {
        vt.vel.x*=Math.pow(.001,dt); vt.vel.z*=Math.pow(.001,dt);
        vt.yaw=vt.bodyYaw=Math.atan2(hp.x-vt.pos.x,hp.z-vt.pos.z);
        if(!kc.chopT)kc.chopT=kc.ritual;
        const ph=kc.ritual-kc.chopT;
        const grabDur=bare?.9:.5;
        if(!kc.beheadDone){
          if(ph<grabDur){                          /* THE GRAB */
            vt._ritualGrabL=vt._ritualGrabL||hp.clone();
            vt._ritualGrabL.copy(hp);
            if(bare){                              /* both hands; straining */
              vt._ritualGrabR=vt._ritualGrabR||hp.clone();
              vt._ritualGrabR.copy(hp);
              vt._ritualGrabR.x+=.09; vt._ritualGrabL.x-=.09;
              if(ph>grabDur*.4){ const j=Math.sin(ph*40)*.015;
                vt._ritualGrabL.y+=j; vt._ritualGrabR.y-=j; }
            } else {                               /* blade poised behind */
              vt.tipTarget.copy(vt.pos)
                .addScaledVector(DIRY(vt.bodyYaw+1.1),.7).setY(1.35);
            }
          } else {                                 /* SEVER — or TEAR */
            kc.beheadDone=true; kc.thrownAt=kc.ritual;
            loser.wakeCorpse&&loser.wakeCorpse();
            TMP2.set(-hp.x,0,-hp.z);
            if(TMP2.lengthSq()<.01)TMP2.set(1,0,0);
            TMP2.normalize();
            if(!bare)vt.tipTarget.copy(hp).addScaledVector(DIRY(vt.bodyYaw+2.6),.8);
            loser.decapitate(hp.clone(),TMP2.clone());
            if(bare){ emitBlood(hp,V3(0,1,0),5,40);
              vt.pain=Math.min(100,vt.pain+4); }
            const piece=(loser.severedPieces||[])
              .find(p=>p.mesh===loser.parts.head);
            /* the stump ERUPTS — a fountain no one can miss */
            addSquirt(loser,'neck',hp.clone(),6.5,3.6);
            addSquirt(loser,'chest',hp.clone().setY(hp.y-.2),4,2.2);
            emitBlood(hp,V3(0,1,0),7,90);
            game.timeScale=.28; game.slowT=.7;
            if(piece){                             /* carried until THROWN */
              piece.held=vt; piece.heldT=9; piece.vel=null;
              kc.headPiece=piece; kc.throwDir=TMP2.clone();
              piece.ang.set(rand(-14,14),rand(-14,14),rand(-14,14));
            }
            game.shake=Math.max(game.shake,.9);
            log(bare?'the head is TORN FREE \u2014 and hurled'
                    :'the head is taken \u2014 and thrown across the snow',false);
          }
        } else {                                   /* RAISE — WINDUP — THROW */
          const t2=kc.ritual-kc.thrownAt;
          const fwd2=DIRY(vt.bodyYaw);
          if(!vt._ritualGrabL)vt._ritualGrabL=vt.pos.clone();
          const G=vt._ritualGrabL;
          if(t2<1.15){                             /* the head, held HIGH */
            const e=minJerk?minJerk(clamp(t2/.7,0,1)):clamp(t2/.7,0,1);
            G.copy(vt.pos).addScaledVector(fwd2,.28)
              .setY(lerp(1.15,2.05,e));            // full overhead extension
            vt.tipTarget.copy(vt.pos).addScaledVector(fwd2,.7).setY(.6);
          } else if(t2<1.5){                       /* the windup: back and down */
            const e=(t2-1.15)/.35;
            G.copy(vt.pos).addScaledVector(fwd2,lerp(.28,-.34,e))
              .setY(lerp(2.05,1.25,e));
          } else if(!kc.released){                 /* THE THROW */
            const e=clamp((t2-1.5)/.22,0,1);
            G.copy(vt.pos).addScaledVector(fwd2,lerp(-.34,.72,e))
              .setY(lerp(1.25,1.95,e));
            if(e>=.75&&kc.headPiece&&kc.headPiece.held){   // release at the apex
              const hpP=kc.headPiece;
              hpP.held=null;
              hpP.vel=V3(kc.throwDir.x*(bare?6.8:8.2),bare?5.2:4.6,
                         kc.throwDir.z*(bare?6.8:8.2));
              Sound.swing&&Sound.swing(1);
            }
            if(e>=1){ kc.released=true;
              vt._ritualGrabL=null; vt._ritualGrabR=null; }
          }
          if(bare&&vt._ritualGrabR&&vt._ritualGrabL)
            vt._ritualGrabR.copy(vt._ritualGrabL).x+=.14;
        }
      }
    }
  }
  /* procedural victor: puppet performs the noto */
  if(!vt.model&&MODELPIPE.clips&&MODELPIPE.clips.sheath){
    if(!kc.clipStarted&&kc.ritual>(kc.sheathAt||1.1)){ kc.clipStarted=true;
      MODELPIPE.playPuppet(vt,'sheath'); }
    if(kc.clipStarted&&vt._pupPlay)return;   // updateAlive renders the puppet
  }
  /* mocap noto: the clip owns the body; the sim stands aside */
  if(vt.model&&MODELPIPE.clips&&MODELPIPE.clips.sheath){
    if(!kc.clipStarted&&kc.ritual>(kc.sheathAt||1.1)){ kc.clipStarted=true;
      MODELPIPE.playClip(vt,'sheath',.25); }
    if(kc.clipStarted){ vt.vel.multiplyScalar(Math.pow(.001,dt));
      MODELPIPE.tickClips(vt,dt); return; }
  }
  vt.vel.multiplyScalar(Math.pow(.001,dt));          // stillness after the cut
  const fwd=DIRY(vt.bodyYaw), right=V3(fwd.z,0,-fwd.x);
  const r=kc.ritual;
  if(r<1.3){        // zanshin — the blade stays on the fallen
    vt.tipTarget.copy(kc.victim.pos).setY(1.02);
    vt.thrust=false; vt.guarding=false;
  } else if(r<1.6){ // chiburi — one sharp flick, blood off the steel
    vt.tipTarget.copy(vt.pos).addScaledVector(right,1.15).setY(.5);
    if(!kc.flicked&&vt.bladeB){ kc.flicked=true;
      if(kc.victim.blood<4900)
        emitBlood(vt.bladeB,V3(right.x*.7,-.5,right.z*.7),3,7);
    }
  } else {          // lower the blade; the snow keeps falling
    vt.tipTarget.copy(vt.pos).addScaledVector(fwd,.55).setY(.85);
  }
}
const camTarget=V3(0,1.2,0);
function updateCamera(dt){
  if(!player)return;
  /* MENU TABLEAU: fixed shot, no feedback with the fighters */
  if(game.state==='menu'){
    TMP1.set(0,1.05,0);
    camTarget.lerp(TMP1,clamp(dt*3,0,1));
    TMP2.set(0,1.55,5.7);
    camera.position.lerp(TMP2,clamp(dt*3,0,1));
    camera.lookAt(camTarget);
    return;
  }
  /* kill cam: drop low, push in, hold the stillness */
  if(killCam&&killCam.t<6){
    killCam.t+=dt;
    const kc=killCam, k=clamp(kc.t/2.6,0,1), e=k*k*(3-2*k);
    const v=kc.victim;
    if(v.physDead&&v.physJoint('chestB',TMP1)){}
    else TMP1.copy(v.J?v.J.chestB.p:v.pos);
    const tgt=TMP1; tgt.y=Math.max(tgt.y,.35);
    camTarget.lerp(tgt,clamp(dt*2.5,0,1));
    kc.orbit+=dt*.12;
    const d=lerp(4.2,2.7,e), h=lerp(1.9,.85,e);
    TMP2.set(Math.cos(kc.orbit)*d,0,Math.sin(kc.orbit)*d);
    const desired=TMP4.copy(camTarget).add(TMP2).setY(h);
    camera.position.lerp(desired,clamp(dt*1.8,0,1));
    if(game.shake>0){ camera.position.x+=rand(-1,1)*game.shake*.05;
      camera.position.y+=rand(-1,1)*game.shake*.05;
      game.shake=Math.max(0,game.shake-dt*2.2); }
    camera.lookAt(camTarget);
    return;
  }
  if(killCam&&killCam.t>=6){ killCam=null; document.body.classList.remove('cine'); }
  const mid=TMP1.addVectors(player.pos,enemy.pos).multiplyScalar(.5); mid.y=1.15;
  /* maai: when both wait, the camera settles into a long wide */
  const calm=player.bladeSpeed<4&&enemy.bladeSpeed<4&&player.pos.distanceTo(enemy.pos)>3;
  game.calmT=calm?(game.calmT||0)+dt:0;
  camTarget.lerp(mid,clamp(dt*3,0,1));
  const span=player.pos.distanceTo(enemy.pos);
  /* side-on duel framing that drifts with the player's flank */
  const axis=TMP2.subVectors(enemy.pos,player.pos).setY(0).normalize();
  const side=TMP3.set(axis.z,0,-axis.x);
  const dist=clamp(3.2+span*.75,4,7.5)-(game.bind?0.9:0)
    +Math.min((game.calmT||0)*.3,1.1);
  const desired=TMP4.copy(mid).addScaledVector(side,dist).setY(1.75+span*.12);
  desired.x+=Math.sin(performance.now()*.00013)*.25;
  desired.y+=Math.sin(performance.now()*.00021)*.1;
  if(game.snapCut&&game.state==='fight'){ game.snapCut=false;
    camera.position.copy(desired).addScaledVector(side,-dist*1.9); // hard cut: reverse angle
    camera.position.y=1.3+Math.random()*.7;
  } else camera.position.lerp(desired,clamp(dt*(game.calmT>1.5?.9:2.2),0,1));
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

  if(game.state==='menu'&&typeof process==='undefined'&&typeof player!=='undefined'&&player&&enemy){
    /* RESPONSIVE TABLEAU: marks derive from the camera frustum, and the
       fighters WALK to them — resize the window and they stroll to their
       new spots, spreading on wide screens, drawing in on narrow ones. */
    const viewD=Math.max(camera.position.z-3.0,1.2);
    const halfW=Math.tan((camera.fov||50)*Math.PI/360)*viewD*(camera.aspect||1.6);
    const lat=clamp(halfW*.62,.95,2.7);
    const depth=3.0-clamp(1.25-lat,0,1)*1.5;   // recede when squeezed
    for(const f of [player,enemy]){
      try{
        const spot=TMP3.set(f.isPlayer?-lat:lat,0,depth);
        TMP4.subVectors(spot,f.pos); TMP4.y=0;
        const dist=TMP4.length();
        if(dist>6){                     // absurd displacement: just appear
          f.pos.copy(spot);
          f.vel.set(0,0,0);
          f.yaw=f.bodyYaw=Math.atan2(camera.position.x-spot.x,
                                     camera.position.z-spot.z);
          if(f.feet){
            const fr=DIRY(f.bodyYaw), rt=TMP1.set(fr.z,0,-fr.x);
            f.feet.R.p.set(spot.x+rt.x*.13,0,spot.z+rt.z*.13);
            f.feet.L.p.set(spot.x-rt.x*.13,0,spot.z-rt.z*.13);
            f.feet.R.yaw=f.feet.L.yaw=f.bodyYaw;
            f.feet.R.swing=f.feet.L.swing=0;
          }
        } else if(dist>.09){            // walk there — the feet do the work
          TMP4.divideScalar(dist);
          const sp=Math.min(1.35,dist*2.2);
          f.vel.x=lerp(f.vel.x,TMP4.x*sp,clamp(dt*5,0,1));
          f.vel.z=lerp(f.vel.z,TMP4.z*sp,clamp(dt*5,0,1));
          const wy=Math.atan2(TMP4.x,TMP4.z);
          f.bodyYaw+=angDiff(wy,f.bodyYaw)*clamp(dt*7,0,1);
          f.yaw=f.bodyYaw;
        } else {                        // arrived: settle, face the lens
          f.vel.x*=Math.pow(.002,dt); f.vel.z*=Math.pow(.002,dt);
          const cy=Math.atan2(camera.position.x-f.pos.x,
                              camera.position.z-f.pos.z);
          f.bodyYaw+=angDiff(cy,f.bodyYaw)*clamp(dt*6,0,1);
          f.yaw=f.bodyYaw;
        }
        f.previewT=(f.previewT||0)+dt;
        const still=clamp(1-Math.hypot(f.vel.x,f.vel.z)*1.6,0,1);
        f.previewBob=Math.abs(Math.sin(f.previewT*2.6+(f.isPlayer?0:1.35)))*.05*still;
        if(f.tipTarget)f.tipTarget.copy(f.pos)
          .addScaledVector(DIRY(f.bodyYaw),.95)
          .setY(1.15+Math.sin(f.previewT*1.5+(f.isPlayer?0:.8))*.1);
        f.updateAlive(dt,f.isPlayer?enemy:player);
        f.updateLoose&&updateLoose(f,dt);
      }catch(e){ pickdbg('menu-anim: '+e.message); }
    }
  }
  if(game.state==='fight'||game.state==='over'){
    game.state==='fight'&&(game.duelTime+=dt);
    if(game.introT>0)game.introT-=dt;
    const introHold=game.introT>0;
    const ritualHold=(killCam&&killCam.victor===player&&
      killCam.ritual<(killCam.beheadDone?killCam.thrownAt+2.6:5.2))||introHold;
    if(player.alive&&game.state==='fight'&&!introHold)playerIntent(player,enemy);
    else if(player.alive&&!ritualHold)playerIntent(player,enemy);
    updateKillRitual(dt);
    enemyAI.update(dt,player);
    updateBind(dt);

    for(const f of [player,enemy]){
      if(f.physDead)f.updateDeadPhys(dt);
      else if(f.ragdoll)f.updateRagdoll(dt);
      else{ f.updateAlive(dt,f===player?enemy:player); f.updatePhysiology(dt,log); }
      updateLoose(f,dt);
      if(!f.dead&&f.arterialWound&&f.bleedRate>15){
        if(f.pulseT>60/(100+(1-f.bloodFrac)*80)){ f.pulseT=0;
          const c=f.capsules[f.arterialWound.part];
          TMP1.addVectors(c.a,c.b).multiplyScalar(.5);
          emitBlood(TMP1,V3(rand(-.5,.5),1,rand(-.5,.5)),2.6,5); }
      }
      if(!f.dead&&f.pool){ f.pool.r=Math.min(2.4,f.pool.r+f.bleedRate*dt*.0026);
        f.pool.mesh.position.set(f.pos.x,.007,f.pos.z); }
    }

    if(game.state==='fight'){
      bladeVsBlade(player,enemy);
      bladeVsBody(player,enemy,log);
      bladeVsBody(enemy,player,log);
      if(player.dead||enemy.dead)endDuel();
    }
  }

  if(PHYS.enabled&&player&&player.phys)PHYS.engine.step(Math.min(dt,.033));
  for(const f of [player,enemy]){
    if(!f)continue;
    /* moon glint when steel rises */
    if(!f.glint)f.glint=mkGlint();
    const up=f.hasSword&&f.bladeB&&f.bladeB.y>1.6&&f.alive;
    const tgt=up?(f.telegraph?.95:.45):0;
    f.glint.material.opacity=lerp(f.glint.material.opacity,tgt,dt*8);
    if(f.bladeA&&f.bladeB)f.glint.position.lerpVectors(f.bladeA,f.bladeB,.72);
    const gs=.3+f.glint.material.opacity*.5+Math.sin(performance.now()*.02)*.04;
    f.glint.scale.set(gs,gs,1);
    /* breath: faster when spent; the dead do not breathe */
    if(f.alive){
      f.breathT=(f.breathT||rand(0,2))-dt;
      if(f.breathT<=0){
        const exert=1-clamp(f.stamina/100,0,1);
        f.breathT=lerp(3.0,1.0,Math.max(exert,1-clamp(f.bloodFrac,0,1)));
        breathe(f,f===player?enemy:player);
      }
    }
  }
  updateSquirts(dt);
  if(player){ updateBlobs(player); updateBlobs(enemy); }
  updatePuffs(dt); updateFlares(dt);
  if(groundMark)groundMark.flush();
  /* dying from the inside: sight narrows, colour drains, sound sinks,
     the sword grows heavy in the hands */
  if(player&&POST&&POST.comp){
    const bf=clamp(player.bloodFrac,0,1), cs=clamp(player.consciousness/100,0,1);
    const fade=clamp((0.86-bf)*2.4,0,1)*(player.dead?1.4:1);
    const U=POST.comp.uniforms;
    U.uTime.value=(performance.now()%1000)*.001;
    U.uDesat.value=lerp(U.uDesat.value,clamp(fade*.75+(1-cs)*.4,0,.92),dt*2);
    U.uVig.value=lerp(U.uVig.value,clamp(fade*.8+(1-cs)*.5,0,1),dt*2);
    game.adrenaline=Math.max(0,(game.adrenaline||0)-dt);
    U.uAdren.value=lerp(U.uAdren.value,game.adrenaline>0?.5:0,dt*1.5);
    Sound.setMuffle(clamp(fade*.9+(player.dead?1:0),0,1));
  }
  Sound.tickWind(dt);
  if(player&&!player.dead&&game.state==='fight')
    Sound.tickHeart(dt,clamp((0.8-player.bloodFrac)*2.2,0,1));
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
  if(POST){ try{ POST.render(); }catch(e){ renderer.render(scene,camera); } }
  else renderer.render(scene,camera);
}
setup();
requestAnimationFrame(frame);
