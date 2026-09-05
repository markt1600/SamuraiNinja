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
  player.model=MODELPIPE.attach(player,rigFixture);let foot=0,grip=0,facing=1;
  for(let i=0;i<180;i++){
   player.vel.set(Math.sin(i*.05)*.8,0,.5);player.updateAlive(1/60,enemy);PHYS.engine.step(1/60);
   const M=player.model;
   facing=Math.min(facing,V3(0,0,1).applyQuaternion(M.bones.Head.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize().dot(DIRY(player.bodyYaw)));
   foot=Math.max(foot,M.bones.RightFoot.getWorldPosition(V3()).distanceTo(player._K.ankR));
   grip=Math.max(grip,M.bones.RightHand.localToWorld(M.gripLoc.Right.clone()).distanceTo(player._K.haR));
  }
  const count=()=>{let n=0;player.model.root.traverse(o=>{if(o.isSkinnedMesh)n+=o.geometry.index.count;});return n;};
  const before=count();player.severLimb('armL',player._K.elL.clone(),V3(1,0,0),()=>{});const after=count();
  for(let i=0;i<30;i++)player.updateAlive(1/60,enemy);
  player.model.root.updateMatrixWorld(true);let finite=true;
  player.model.root.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();for(let i=0;i<o.geometry.attributes.position.count;i+=97){const v=V3().fromBufferAttribute(o.geometry.attributes.position,i);o.applyBoneTransform(i,v);finite=finite&&v.toArray().every(Number.isFinite);}}});
  return JSON.stringify({foot,grip,facing,before,after,finite,severed:player.severed.armL});})()`));
 assert.ok(result.foot<1e-6,JSON.stringify(result));assert.ok(result.grip<1e-6,JSON.stringify(result));assert.ok(result.facing>.7,JSON.stringify(result));assert.ok(result.after<result.before);assert.equal(result.finite,true);assert.equal(result.severed,true);
 console.log('Rig motion: foot and grip contacts within 1 micron; skinned severance and subsequent movement finite.',result);
})().catch(e=>{console.error(e);process.exit(1)});
