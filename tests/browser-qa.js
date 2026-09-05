/* Opt-in visual QA, loaded only with ?qa=1. No hooks in normal play. */
const qaBox=document.createElement('aside');
qaBox.style.cssText='position:fixed;top:8px;left:8px;z-index:1000;background:#101820ed;color:#eef;padding:12px;max-width:340px;max-height:78vh;overflow:auto;font:12px monospace;pointer-events:auto';
qaBox.innerHTML='<button id="qa-walk">Movement sweep</button> <button id="qa-swing">Sword drill</button> <button id="qa-fight">Live fight</button> <button id="qa-wound">Wound showcase</button> <button id="qa-pause">Pause</button> <button id="qa-close">Hide diagnostics</button><pre id="qa-info"></pre>';
document.body.appendChild(qaBox);
let qaSwing=false,qaWalk=false,qaT=0,qaFrames=[],qaLast=performance.now();
const qaIntent=playerIntent,qaSim=simulate;
playerIntent=function(f,e){if(qaWalk||qaSwing)return;return qaIntent(f,e);};
simulate=function(dt){
  if(qaWalk){
    qaT+=dt;const a=qaT*.5;
    player.driveFootwork(V3(Math.cos(a),0,Math.sin(a)),1,13*player.mobility,2.6*player.mobility,dt);
    enemy.vel.set(0,0,0);enemyAI.update=()=>{};
    player.tipTarget.copy(player.pos).addScaledVector(DIRY(player.bodyYaw),1.1).setY(1.3);
  }
  if(qaSwing){
    const oldT=qaT;qaT+=dt;enemyAI.update=()=>{};
    if(Math.floor(oldT/1.3)!==Math.floor(qaT/1.3))player._requestStrike=true;player.vel.set(0,0,0);enemy.vel.set(0,0,0);
    const t=qaT%8,fw=DIRY(player.bodyYaw),rt=V3(fw.z,0,-fw.x);
    player.thrust=t>=4&&t<6;player.guarding=t>=6;
    player.tipTarget.copy(player.pos).addScaledVector(fw,player.thrust?1.55:1)
      .addScaledVector(rt,t<4?Math.sin(t*3)*.8:0).setY(t<4?1.4+Math.cos(t*3)*.65:1.3);
  }
  qaSim(dt);
};
document.getElementById('qa-swing').onclick=()=>{
  document.getElementById('menu').classList.add('hidden');restart();qaWalk=false;qaSwing=true;qaT=0;
  player._noBeg=true;enemy._noBeg=true;game.introT=0;enemy.pos.z+=1.5;
};
document.getElementById('qa-walk').onclick=()=>{qaSwing=false;
  document.getElementById('menu').classList.add('hidden');restart();qaWalk=true;qaT=0;
  player._noBeg=true;enemy._noBeg=true;game.introT=0;
};
document.getElementById('qa-fight').onclick=()=>{qaSwing=false;qaWalk=false;document.getElementById('menu').classList.add('hidden');restart();};
document.getElementById('qa-wound').onclick=()=>{
  qaSwing=false;qaWalk=false;document.getElementById('menu').classList.add('hidden');restart();game.introT=0;
  enemyAI.update=()=>{};player._noBeg=true;enemy._noBeg=true;
  setTimeout(()=>{const f=enemy,pt=f._K.elL.clone();f.severLimb('armL',pt,V3(.2,.2,1),()=>{});f.addHitMark('chest',f._K.chestT.clone().add(V3(0,0,.13)),V3(1,.3,0),'severe',false);},1200);
};
document.getElementById('qa-pause').onclick=()=>{game.timeScale=game.timeScale===0?1:0;};
document.getElementById('qa-close').onclick=()=>{qaBox.style.display='none';};
function qaSample(now){qaFrames.push(now-qaLast);qaLast=now;if(qaFrames.length>180)qaFrames.shift();requestAnimationFrame(qaSample);}
requestAnimationFrame(qaSample);
setInterval(()=>{
 const mats=[];if(player.model)player.model.root.traverse(o=>{if(o.isMesh)for(const m of (Array.isArray(o.material)?o.material:[o.material]))mats.push({name:m.name,color:m.color.getHexString(),map:!!m.map,rough:m.roughness,normal:!!m.normalMap,texture:m.map&&m.map.image?{w:m.map.image.width,h:m.map.image.height,space:m.map.colorSpace}:null})});
 const ft=player.feet,K=player._K;
 const ankleError=side=>{if(!player.model)return null;const b=player.model.bones[side==='R'?'RightFoot':'LeftFoot'];return b?b.getWorldPosition(V3()).distanceTo(K['ank'+side]):null};
 const values=qaFrames.slice().sort((a,b)=>a-b);
 document.getElementById('qa-info').textContent=JSON.stringify({state:game.state,version:ZAN_VERSION,rigBones:player.model?Object.keys(player.model.bones).filter(k=>player.model.bones[k]).length:0,
  frameMs:{median:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)]},
  calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,physicsBodies:PHYS.engine.bodies.length,audio:Sound.audioStatus(),
  feet:{R:ft.R.swing,L:ft.L.swing},ankleError:{R:ankleError('R'),L:ankleError('L')},
  gripError:player.model&&player.model.gripLoc.Right?player.model.bones.RightHand.localToWorld(player.model.gripLoc.Right.clone()).distanceTo(K.haR):null,
  gripAngle:player.model&&player.model.gripQ.Right?player.katana.quaternion.clone().invert().multiply(player.model.bones.RightHand.getWorldQuaternion(new THREE.Quaternion())).angleTo(player.model.gripQ.Right):null,
  bladeSpeed:player.bladeSpeed,technique:player._technique&&player._technique.state,gait:player._locomotion&&player._locomotion.mode,materials:mats},null,2);
},1000);
