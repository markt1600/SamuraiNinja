const assert=require('node:assert/strict');const {loadGame}=require('./harness.cjs');
(async()=>{
 const {run}=await loadGame();
 const r=JSON.parse(run(`(()=>{
  setup();game.state='fight';for(const k of Object.keys(Sound))Sound[k]=()=>{};
  const f=player,t=new ZCombatMotion.Technique();let spontaneous=false;
  for(let i=0;i<120;i++){f.tipTarget.set(Math.sin(i)*2,1.5,1);t.update(f,1/60);spontaneous=spontaneous||t.state!=='guard';}
  f.tipTarget.copy(f.pos).add(V3(0,1.3,1));f._requestStrike=true;let states=[],peak=0,last=null,twist=0;
  for(let i=0;i<100;i++){
   t.update(f,1/60);const p=t.weapon(f,V3(0,.88,0));const tip=p.handle.clone().addScaledVector(p.dir,.93);
   if(last)peak=Math.max(peak,tip.distanceTo(last)*60);last=tip;twist=Math.max(twist,Math.abs(t.pose.twist));
   if(states.at(-1)!==t.state)states.push(t.state);
  }
  f._requestStrike=true;t.update(f,1/60);f.stun=.5;t.update(f,1/60);const interrupted=t.state;f.stun=0;
  t.lastVelocity=V3(0,0,8);f.tipVel.set(0,0,-4);t.update(f,1/60);const deflected=t.deflection.length();
  return JSON.stringify({spontaneous,states,peak,twist,interrupted,deflected});})()`));
 assert.equal(r.spontaneous,false);assert.deepEqual(r.states,['prepare','strike','recover','guard']);
 assert.ok(r.peak>8&&r.peak<22,JSON.stringify(r));assert.ok(r.twist>.15);
 assert.equal(r.interrupted,'recover');assert.ok(r.deflected>.05);
 const duel=JSON.parse(run(`(()=>{
  setup();game.state='fight';game.introT=0;for(const k of Object.keys(Sound))Sound[k]=()=>{};
  const ai=new AI(player,{skill:.9,reaction:.15,engage:[1.1,1.7],atkCircle:.7,atkBlock:.4,windupT:[.2,.35],strikeT:[.3,.5],speedMul:.9,parry:.2,maai:1.4,tempo:[.6,.9]});
  player.isPlayer=false;for(let i=0;i<1800;i++){ai.update(1/60,enemy);simulate(1/60);if(player.dead||enemy.dead)break;}
  return JSON.stringify({wounds:player.wounds.length+enemy.wounds.length,blood:player.blood+enemy.blood,fatal:player.dead||enemy.dead,contacts:game.bladeContacts||0,finite:PHYS.engine.bodies.every(b=>b.pos.toArray().every(Number.isFinite))});})()`));
 assert.ok(duel.wounds>0,JSON.stringify(duel));assert.ok(duel.blood<10000||duel.fatal,JSON.stringify(duel));assert.ok(duel.contacts>0);assert.equal(duel.finite,true);
 console.log('Coordinated techniques: commitment, recovery, injury interruption, contact deflection and live injury simulation passed.',r,duel);
})().catch(e=>{console.error(e);process.exit(1)});
