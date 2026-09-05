const fs=require('fs'),path=require('path');const cache=new Map();
function url(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);let s=fs.readFileSync(file,'utf8').replace(/from ['"](three|\.[^'"]+\.js)['"]/g,(_,n)=>`from '${url(n==='three'?'vendor/three.module.js':path.resolve(path.dirname(file),n))}'`);let u='data:text/javascript;base64,'+Buffer.from(s).toString('base64');cache.set(file,u);return u}
(async()=>{
 global.window={URL};const T=await import(url('vendor/three.module.js'));
 const {FBXLoader}=await import(url('vendor/addons/loaders/FBXLoader.js'));
 const map={pelvis:'Hips',chestB:'Spine',chestT:'Spine2',neckT:'Neck',shR:'RightArm',shL:'LeftArm',elR:'RightForeArm',elL:'LeftForeArm',haR:'RightHand',haL:'LeftHand',hipR:'RightUpLeg',hipL:'LeftUpLeg',knR:'RightLeg',knL:'LeftLeg',ankR:'RightFoot',ankL:'LeftFoot'};
 const data={joints:Object.keys(map),clips:{}};
 for(const [name,file] of Object.entries({idle:'gs/gs_idle',walk:'gs/gs_walk',strafe:'gs/gs_strafe',run:'gs/gs_run'})){
  const b=fs.readFileSync('models/anims/'+file+'.fbx'),rig=new FBXLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
  const clip=rig.animations[0],bones={};rig.traverse(o=>{if(o.isBone)for(const [k,n] of Object.entries(map))if(o.name.endsWith(n))bones[k]=o});
  const mixer=new T.AnimationMixer(rig),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce);action.clampWhenFinished=true;action.play();
  const frames=[],count=Math.ceil(clip.duration*30),root=[];
  for(let i=0;i<=count;i++){
   mixer.setTime(i/count*clip.duration);rig.updateMatrixWorld(true);const hip=bones.pelvis.getWorldPosition(new T.Vector3());root.push(hip.clone());
   frames.push(data.joints.flatMap(k=>{const p=bones[k].getWorldPosition(new T.Vector3());return [-(p.x-hip.x)*.009,p.y*.009,(p.z-hip.z)*.009].map(x=>+x.toFixed(5));}));
  }
  const travel=root[0].distanceTo(root.at(-1))*.009;
  data.clips[name]={duration:clip.duration,speed:travel/clip.duration,frames};
 }
 fs.writeFileSync('motion-data.js','/* Baked from the bundled licensed Mixamo clips; regenerate with node scripts/bake-motion.cjs. */\nconst ZMotionData='+JSON.stringify(data)+';\n');
 console.log(Object.fromEntries(Object.entries(data.clips).map(([k,v])=>[k,{duration:v.duration,speed:v.speed,frames:v.frames.length}])));
})().catch(e=>{console.error(e);process.exit(1)});
