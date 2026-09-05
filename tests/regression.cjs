const assert=require('node:assert/strict');
const {loadGame}=require('./harness.cjs');
const {FixedClock,PoseBuffer}=require('../motion.js');
(async()=>{
 let passed=0;
 const test=async(name,fn)=>{await fn();console.log('PASS',name);passed++;};
 const {run,THREE}=await loadGame();
 global.THREE=THREE;
 const physical=require('../physics.js');
 // The compact physics module reads THREE at construction, like the browser.
 global.THREE=THREE;
 await test('fixed cadence is identical at 30, 60, 120 and 144 Hz',()=>{
  for(const hz of [30,60,120,144]){
   const clock=new FixedClock();let ticks=0,time=0;
   for(let i=0;i<hz*10;i++)clock.advance(1/hz,1,dt=>{ticks++;time+=dt});
   assert.equal(ticks,600);assert.ok(Math.abs(time-10)<1e-9);
  }
 });
 await test('slow motion and long-frame recovery remain bounded',()=>{
  const c=new FixedClock();let ticks=0;
  for(let i=0;i<120;i++)c.advance(1/60,.25,()=>ticks++);
  assert.equal(ticks,30);ticks=0;c.advance(3,1,()=>ticks++);
  assert.equal(ticks,8);assert.ok(c.accumulator<c.step);c.reset();assert.equal(c.accumulator,0);
 });
 await test('render interpolation cannot alter authoritative poses',()=>{
  const p=new PoseBuffer(),o=new THREE.Object3D();p.capture([o]);o.position.x=1;
  o.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),1);p.capture([o]);
  p.interpolate(.5);assert.equal(o.position.x,.5);p.restore();assert.equal(o.position.x,1);
  assert.ok(o.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),1))<1e-7);
  o.position.x=10;p.capture([o]);p.interpolate(0);assert.equal(o.position.x,10);
  p.capture([]);assert.equal(p.entries.size,0);
 });
 await test('footwork force ramps, reverses continuously, and preserves knockback',()=>{
  const r=JSON.parse(run(`(()=>{
   setup();const f=player;f.vel.set(0,0,0);f._moveForce=V3();
   f.driveFootwork(V3(1,0,0),1,13,2.6,1/60);const first=f._moveForce.x;
   for(let i=0;i<60;i++)f.driveFootwork(V3(1,0,0),1,13,2.6,1/60);
   const running=f._moveForce.x;
   f.driveFootwork(V3(-1,0,0),1,13,2.6,1/60);const reversal=f._moveForce.x;
   for(let i=0;i<90;i++)f.driveFootwork(V3(),0,13,2.6,1/60);
   const released=f._moveForce.length();f.vel.set(7,0,0);f._moveForce.set(0,0,0);
   f.driveFootwork(V3(1,0,0),1,13,2.6,1/60);
   return JSON.stringify({first,running,reversal,released,knockback:f.vel.x});})()`));
  assert.ok(r.first>0&&r.first<4);assert.ok(r.running>12);
  assert.ok(r.reversal>0&&r.reversal<r.running);assert.ok(r.released<1e-5);
  assert.ok(Math.abs(r.knockback-7)<1e-8);
 });
 await test('gravity and contact settling obey physical scale',()=>{
  const e=new physical.Engine();e.groundY=-100;
  const b=e.add(new physical.Body({pos:new THREE.Vector3(0,10,0),mass:2,r:.1,len:.3,damping:0}));
  for(let i=0;i<60;i++)e.step(1/60);
  assert.ok(Math.abs(b.pos.y-(10-4.905))<.02,`fall ${b.pos.y}`);
  e.groundY=0;for(let i=0;i<180;i++)e.step(1/60);
  assert.ok(b.pos.y>=.24&&b.pos.y<.28,`ground ${b.pos.y}`);
  e.step(0);assert.ok(Number.isFinite(b.pos.y));
 });
 await test('joint swing limit applies inverse inertia exactly once',()=>{
  const a=new physical.Body({pos:new THREE.Vector3(0,3,0),mass:0,r:.1,len:.5});
  const b=new physical.Body({pos:new THREE.Vector3(0,3,0),mass:2,r:.05,len:.3});
  const limit=new physical.SwingLimit(a,b,.4);
  b.q.setFromAxisAngle(new THREE.Vector3(1,0,0),1.2);limit.solve(1/600);
  assert.ok(Math.abs(b.q.angleTo(a.q)-.4)<1e-6);
 });
 await test('ground friction is independent of body mass',()=>{
  const travel=mass=>{
   const e=new physical.Engine();const b=e.add(new physical.Body({pos:new THREE.Vector3(0,.25,0),mass,r:.1,len:.3,damping:0}));
   b.vel.x=2;for(let i=0;i<60;i++)e.step(1/60);return b.pos.x;
  };
  assert.ok(Math.abs(travel(1)-travel(10))<1e-6);
 });
 run(`for(const k of Object.keys(Sound))Sound[k]=()=>{};`);
 await test('sharp alignment, thrust and bone resistance remain intact',()=>{
  const x=JSON.parse(run(`JSON.stringify({sharp:cutDepth(140,1,false,[]),flat:cutDepth(140,.1,false,[]),
    thrust:cutDepth(140,1,true,[]),bone:cutDepth(140,1,false,ANATOMY.head.layers)})`));
  assert.equal(x.sharp,10);assert.equal(x.thrust,18);assert.ok(x.flat<.3);assert.ok(x.bone<x.sharp);
 });
 await test('parry freshness expires on the simulation clock',()=>{
  const x=run(`setup();game.state='fight';player.guarding=true;
    player.updateAlive(1/60,enemy);const fresh=player.guardFresh;
    simulationTime+=.19;player.updateAlive(1/60,enemy);fresh&&!player.guardFresh`);
  assert.equal(x,true);
 });
 await test('feet alternate and planted support does not slide',()=>{
  const result=JSON.parse(run(`(()=>{
   setup();game.state='fight';let r=0,l=0,slide=0,air=0,kneeError=0;
   for(let i=0;i<300;i++){
    player.vel.set(0,0,.9);const ft=player.feet;
    const pr=ft.R.p.clone(),pl=ft.L.p.clone(),sr=ft.R.swing,sl=ft.L.swing;
    player.updateAlive(1/60,enemy);PHYS.engine.step(1/60);
    if(sr===0&&ft.R.swing>0)r++;if(sl===0&&ft.L.swing>0)l++;
    if(sr===0&&ft.R.swing===0)slide=Math.max(slide,pr.distanceTo(ft.R.p));
    if(sl===0&&ft.L.swing===0)slide=Math.max(slide,pl.distanceTo(ft.L.p));
    if(ft.R.swing>0&&ft.L.swing>0)air++;
    kneeError=Math.max(kneeError,Math.abs(player._K.hipR.distanceTo(player._K.knR)-player.dims.thigh));
   }
   return JSON.stringify({r,l,slide,air,kneeError});
  })()`));
  assert.ok(result.r>=5&&result.l>=5,JSON.stringify(result));assert.ok(Math.abs(result.r-result.l)<=1);
  assert.equal(result.slide,0);assert.equal(result.air,0);assert.ok(result.kneeError<1e-7);
 });
 await test('frame schedule does not change movement or anatomy state',()=>{
  const results=[];
  for(const hz of [30,60,144])results.push(JSON.parse(run(`(()=>{
    setup();game.state='fight';const clock=new ZMotion.FixedClock();
    player.breath=0;player.idleT=0;
    for(let i=0;i<${hz*2};i++)clock.advance(1/${hz},1,dt=>{
      player.vel.set(0,0,.8);player.updateAlive(dt,enemy);PHYS.engine.step(dt);
    });return JSON.stringify({pos:player.pos.toArray(),blood:player.blood,steps:player._lastStep});})()`)));
  assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
 });
 await test('arterial wounds bleed and impaired legs reduce mobility',()=>{
  const x=JSON.parse(run(`(()=>{setup();game.state='fight';const f=player;const mobility=f.mobility;
    f.applyEffect({effect:'arteryLeg',rate:42,limb:'legR',name:'test artery'},'thighR',V3(),V3(1,0,0),100,()=>{});
    for(let i=0;i<120;i++)f.updatePhysiology(1/60,()=>{});
    return JSON.stringify({blood:f.blood,disabled:f.disabled.legR,mobility:f.mobility,before:mobility});})()`));
  assert.ok(x.blood<5000);assert.equal(x.disabled,true);assert.ok(x.mobility<x.before);
 });
 await test('extended AI duel, death and restart keep physics finite',()=>{
  const result=JSON.parse(run(`(()=>{setup();game.state='fight';
    for(let i=0;i<1200;i++)simulate(1/60);
    const bad=PHYS.engine.bodies.some(b=>!b.pos.toArray().concat(b.q.toArray()).every(Number.isFinite));
    const dead=player.dead||enemy.dead;setup();game.state='fight';simulate(1/60);
    return JSON.stringify({bad,dead,bodies:PHYS.engine.bodies.length,blood:player.blood});})()`));
  assert.equal(result.bad,false);assert.equal(result.bodies,22);assert.equal(result.blood,5000);
 });
 await test('injury recoil compresses the body and settles without persistent shaking',()=>{
  const r=JSON.parse(run(`(()=>{
   setup();game.state='fight';player.bodyImpact(V3(1,0,0),240);
   const impulse=player.flinchV.x;let peak=0,dip=0;
   for(let i=0;i<180;i++){player.updateAlive(1/60,enemy);peak=Math.max(peak,player.flinch.length());dip=Math.min(dip,player._bodyBounce);}
   return JSON.stringify({impulse,peak,dip,residual:player.flinch.length(),breath:player._breathRate});})()`));
  assert.ok(r.impulse>.2);assert.ok(r.peak>.005&&r.peak<.1);
  assert.ok(r.dip<0&&r.dip>=-.035);assert.ok(r.residual<1e-6);
  assert.ok(r.breath>=1&&r.breath<=1.65);
 });
 await test('blood droplets expire, emitters remain bounded, and severed tissue is finite',()=>{
  const result=JSON.parse(run(`(()=>{
    setup();emitBlood(V3(0,1,0),V3(1,1,0),4,100);
    const burst=Array.from(sprayLife).filter(x=>x>0).length;
    for(let i=0;i<180;i++)updateBloodFX(1/60);
    for(let i=0;i<20;i++)addSquirt(player,'forearmR',player._K.elR.clone(),2,1);
    const cap=jaggedCap(.05),meshes=[];cap.traverse(o=>{if(o.isMesh)meshes.push(o);});
    return JSON.stringify({burst,active:Array.from(sprayLife).filter(x=>x>0).length,emitters:SQUIRTS.filter(s=>s.f===player&&s.part===player.parts.forearmR).length,meshes:meshes.length,finite:meshes.every(m=>Array.from(m.geometry.attributes.position.array).every(Number.isFinite))});})()`));
  assert.equal(result.burst,180);assert.equal(result.active,0);assert.equal(result.emitters,1);assert.ok(result.meshes>=18);assert.equal(result.finite,true);
 });
 console.log(`${passed} regression checks passed.`);
})().catch(e=>{console.error(e);process.exit(1)});
