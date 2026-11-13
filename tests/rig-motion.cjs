const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {loadGame}=require('./harness.cjs');
function esm(file){let s=fs.readFileSync(file,'utf8');s=s.replace(/from '(three|\.\.[^']+\.js)'/g,(_,name)=>`from '${esmURL(name==='three'?'vendor/three.module.js':path.join(path.dirname(file),name))}'`);return s;}
const urls=new Map();function esmURL(file){if(!urls.has(file))urls.set(file,'data:text/javascript;base64,'+Buffer.from(esm(file)).toString('base64'));return urls.get(file);}
(async()=>{
 const {GLTFLoader}=await import(esmURL('vendor/addons/loaders/GLTFLoader.js'));
 const SkeletonUtils=await import(esmURL('vendor/addons/utils/SkeletonUtils.js'));
 const bytes=fs.readFileSync('models/ronin.glb'),len=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+len));
 // The geometry and bind matrices are unchanged; the browser separately tests
 // real embedded images. Node doesn't need a canvas to validate skinning.
 delete g.images;delete g.textures;g.materials=g.materials.map(m=>({name:m.name,pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:.8}}));
 g.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(28+len).toString('base64');
 global.ProgressEvent=class{constructor(type,opts){this.type=type;Object.assign(this,opts)}};
 const rig=await new GLTFLoader().parseAsync(JSON.stringify(g),'');
 const {context,THREE,run}=await loadGame({modelPipeline:true});THREE.SkeletonUtils=SkeletonUtils;context.rigFixture=rig;
 const result=JSON.parse(run(`(()=>{
  setup();game.state='fight';for(const k of Object.keys(Sound))Sound[k]=()=>{};
  player.model=MODELPIPE.attach(player,rigFixture);let foot=0,grip=0,facing=1,relativeGrip=0,maxBladeStep=0,peakBladeSpeed=0,velocityError=0,handStretch=0,handWorst=null,chestMatch=1,turnMin=10,turnMax=-10,handMin=10,handMax=-10,elbowMin=10,elbowMax=-10;let lastSword=null,lastTip=null;
  for(let i=0;i<480;i++){
   const phase=i%240,fw=DIRY(player.bodyYaw),rt=V3(fw.z,0,-fw.x);
   if(i%70===0)player._requestStrike=true;
   player.thrust=phase>=120&&phase<180;player.guarding=phase>=180;
   player.tipTarget.copy(player.pos).addScaledVector(fw,player.thrust?1.5:1)
     .addScaledVector(rt,phase<120?Math.sin(phase*.12)*.8:0).setY(phase<120?1.4+Math.cos(phase*.12)*.65:1.3);
   player.vel.set(Math.sin(i*.05)*.8,0,.5);player.updateAlive(1/60,enemy);PHYS.engine.step(1/60);
   const M=player.model;
   const actual=M.bones.RightArm.getWorldPosition(V3()).sub(M.bones.LeftArm.getWorldPosition(V3())).normalize();
   const intended=player._K.shR.clone().sub(player._K.shL).normalize();
   const trunk=player._K.chestT.clone().sub(player._K.chestB).normalize();
   intended.addScaledVector(trunk,-intended.dot(trunk)).normalize();
   chestMatch=Math.min(chestMatch,actual.dot(intended));
   const fwBody=DIRY(player.bodyYaw),rightBody=V3(fwBody.z,0,-fwBody.x);
   const turn=Math.atan2(-actual.dot(fwBody),actual.dot(rightBody));turnMin=Math.min(turnMin,turn);turnMax=Math.max(turnMax,turn);
   const handY=M.bones.RightHand.getWorldPosition(V3()).y-player._K.pelvis.y;
   const elbowY=M.bones.RightForeArm.getWorldPosition(V3()).y-player._K.pelvis.y;
   handMin=Math.min(handMin,handY);handMax=Math.max(handMax,handY);elbowMin=Math.min(elbowMin,elbowY);elbowMax=Math.max(elbowMax,elbowY);
   if(i%60===0)M.root.traverse(o=>{
    if(!o.isSkinnedMesh)return;o.skeleton.update();
    const p=o.geometry.attributes.position,idx=o.geometry.index;
    const hand=v=>Math.abs(p.getX(v))>.395&&p.getY(v)<1.065;
    for(let e=0;e<idx.count;e+=3)for(let j=0;j<3;j++){
     const a=idx.getX(e+j),b=idx.getX(e+(j+1)%3);if(!hand(a)||!hand(b))continue;
     const va=V3().fromBufferAttribute(p,a),vb=V3().fromBufferAttribute(p,b),rest=va.distanceTo(vb);
     if(rest<.004)continue;
     o.applyBoneTransform(a,va);o.applyBoneTransform(b,vb);if(va.distanceTo(vb)/rest>handStretch){handStretch=va.distanceTo(vb)/rest;
      const si=o.geometry.attributes.skinIndex,sw=o.geometry.attributes.skinWeight;
      const info=v=>({v,p:V3().fromBufferAttribute(p,v).toArray(),bones:[si.getX(v),si.getY(v),si.getZ(v),si.getW(v)].map(k=>o.skeleton.bones[k].name),w:[sw.getX(v),sw.getY(v),sw.getZ(v),sw.getW(v)]});
      handWorst={a:info(a),b:info(b),rest,deformed:va.distanceTo(vb)};
     }
    }
   });
   if(lastSword)maxBladeStep=Math.max(maxBladeStep,lastSword.angleTo(player.katana.quaternion));
   lastSword=player.katana.quaternion.clone();
   if(lastTip)velocityError=Math.max(velocityError,player.bladeB.clone().sub(lastTip).multiplyScalar(60).distanceTo(player.bladeVel));
   lastTip=player.bladeB.clone();peakBladeSpeed=Math.max(peakBladeSpeed,player.bladeSpeed);
   for(const side of ['Right','Left']){
    const handQ=M.bones[side+'Hand'].getWorldQuaternion(new THREE.Quaternion());
    const rel=player.katana.quaternion.clone().invert().multiply(handQ);
    relativeGrip=Math.max(relativeGrip,rel.angleTo(M.gripQ[side]));
   }
   facing=Math.min(facing,V3(0,0,1).applyQuaternion(M.bones.Head.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize().dot(DIRY(player.bodyYaw)));
   foot=Math.max(foot,M.bones.RightFoot.getWorldPosition(V3()).distanceTo(player._K.ankR));
   grip=Math.max(grip,M.bones.RightHand.localToWorld(M.gripLoc.Right.clone()).distanceTo(player._K.haR));
  }
  // Applying an identical pose repeatedly must not rotate the rig further.
  MODELPIPE.drive(player,player._K);
  const saved=Object.fromEntries(Object.entries(player.model.bones).filter(([k,b])=>b).map(([k,b])=>[k,b.quaternion.clone()]));
  for(let i=0;i<30;i++)MODELPIPE.drive(player,player._K);
  let repeatDrift=0;for(const [k,q] of Object.entries(saved))repeatDrift=Math.max(repeatDrift,q.angleTo(player.model.bones[k].quaternion));
  const count=()=>{let n=0;player.model.root.traverse(o=>{if(o.isSkinnedMesh)n+=o.geometry.index.count;});return n;};
  const before=count();player.severLimb('armL',player._K.elL.clone(),V3(1,0,0),()=>{});const after=count();
  for(let i=0;i<30;i++)player.updateAlive(1/60,enemy);
  player.model.root.updateMatrixWorld(true);let finite=true;
  player.model.root.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();for(let i=0;i<o.geometry.attributes.position.count;i+=97){const v=V3().fromBufferAttribute(o.geometry.attributes.position,i);o.applyBoneTransform(i,v);finite=finite&&v.toArray().every(Number.isFinite);}}});
  return JSON.stringify({foot,grip,facing,relativeGrip,maxBladeStep,peakBladeSpeed,velocityError,handStretch,handWorst,chestMatch,torsoSweep:turnMax-turnMin,handSweep:handMax-handMin,elbowSweep:elbowMax-elbowMin,repeatDrift,before,after,finite,severed:player.severed.armL});})()`));
 assert.ok(result.chestMatch>.998,JSON.stringify(result));
 assert.ok(result.torsoSweep>.65,JSON.stringify(result));
 assert.ok(result.handSweep>.4,JSON.stringify(result));
 assert.ok(result.elbowSweep>.25,JSON.stringify(result));
 assert.ok(result.handStretch<3.6,JSON.stringify(result));
 assert.ok(result.peakBladeSpeed>4,JSON.stringify(result));
 assert.ok(result.velocityError<1e-8,JSON.stringify(result));
 assert.ok(result.relativeGrip<1e-6,JSON.stringify(result));
 assert.ok(result.repeatDrift<1e-6,JSON.stringify(result));
 assert.ok(result.maxBladeStep<.38,JSON.stringify(result));
 assert.ok(result.foot<1e-6,JSON.stringify(result));assert.ok(result.grip<1e-6,JSON.stringify(result));assert.ok(result.facing>.7,JSON.stringify(result));assert.ok(result.after<result.before);assert.equal(result.finite,true);assert.equal(result.severed,true);
 console.log('Rig motion: foot and grip contacts within 1 micron; skinned severance and subsequent movement finite.',result);
})().catch(e=>{console.error(e);process.exit(1)});
