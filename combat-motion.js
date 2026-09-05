/* Coordinated character motion. Captured gait supplies anatomical timing;
   planted contacts, weapon constraints and injury response remain authoritative. */
const ZCombatMotion=(()=>{
 const V=()=>new THREE.Vector3(),Q=()=>new THREE.Quaternion();
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),ease=t=>{t=clamp(t,0,1);return t*t*t*(10+t*(-15+6*t));};
 function sample(name,phase){
  const c=ZMotionData.clips[name],frames=c.frames,n=frames.length-1;
  const t=((phase%1)+1)%1*n,i=Math.floor(t),a=frames[i],b=frames[(i+1)%(n+1)],w=t-i,out={};
  ZMotionData.joints.forEach((k,j)=>{out[k]=new THREE.Vector3(a[j*3]*(1-w)+b[j*3]*w,a[j*3+1]*(1-w)+b[j*3+1]*w,a[j*3+2]*(1-w)+b[j*3+2]*w)});
  return out;
 }
 class Locomotion{
  constructor(){this.phase=0;this.idlePhase=0;this.mix=0;this.contacts={};this.pose=null;this.mode='walk';}
  update(f,dt){
   const fw=new THREE.Vector3(Math.sin(f.bodyYaw),0,Math.cos(f.bodyYaw)),rt=new THREE.Vector3(fw.z,0,-fw.x);
   const speed=Math.hypot(f.vel.x,f.vel.z),forward=f.vel.dot(fw),side=f.vel.dot(rt);
   const mode=Math.abs(side)>Math.abs(forward)*1.2?'strafe':speed>1.9?'run':'walk';
   this.mode=mode;const clip=ZMotionData.clips[mode];
   const sign=mode==='strafe'?(side>0?-1:1):(forward<0?-1:1);
   this.phase+=dt*speed/Math.max(.1,clip.speed)/clip.duration*sign;
   this.idlePhase+=dt/(ZMotionData.clips.idle.duration)*(f._breathRate||1);
   this.mix+=(clamp(speed/.55,0,1)-this.mix)*(1-Math.exp(-10*dt));
   let moving=sample(mode,this.phase);
   // Crossfade changes of gait; selecting a different clip must not teleport knees.
   if(this.previousMode&&this.previousMode!==mode){this.transitionPose=this.lastMoving;this.transitionT=0;}
   this.previousMode=mode;
   if(this.transitionPose){
    this.transitionT+=dt;const blend=ease(this.transitionT/.22);
    for(const k of ZMotionData.joints)moving[k]=this.transitionPose[k].clone().lerp(moving[k],blend);
    if(blend===1)this.transitionPose=null;
   }
   this.lastMoving=Object.fromEntries(Object.entries(moving).map(([k,v])=>[k,v.clone()]));
   const idle=sample('idle',this.idlePhase),out={};
   const scale=f.dims.pelvisY/.915;
   for(const k of ZMotionData.joints){
    const p=idle[k].lerp(moving[k],this.mix).multiplyScalar(scale);
    out[k]=f.pos.clone().addScaledVector(rt,p.x).addScaledVector(fw,p.z);out[k].y=p.y;
   }
   // Blend into a staggered fighting stance at rest. Retain this stance through
   // recovery so the lead foot is not immediately pulled back by the idle clip.
   const stance=(1-this.mix)*clamp(1-speed/.25,0,1)*(f.hasSword&&!f.begging?1:0);
   for(const side of ['R','L']){
    const sign=side==='R'?1:-1;
    const target=f.pos.clone().addScaledVector(rt,sign*.17).addScaledVector(fw,side==='L'?.23:-.18).setY(.045);
    out['ank'+side].lerp(target,stance);
   }
   // A prepared strike sets the lead foot before the torso follows through.
   if(f._technique&&this.attackSerial!==f._technique.serial){
    this.attackSerial=f._technique.serial;
    if(this.attackSerial>0&&speed<.7){
     const lead='L',c=this.contacts[lead];
     if(c&&!f.disabled.legL&&!this.contacts.R?.step){
      const to=f.pos.clone().addScaledVector(fw,.30).addScaledVector(rt,-.17).setY(.045);
      if(c.p.distanceTo(to)>.055)c.step={from:c.p.clone(),to,t:0};
     }
    }
   }
   const lifts={R:Math.max(0,out.ankR.y-.087*scale),L:Math.max(0,out.ankL.y-.087*scale)};
   if(!this.support)this.support=lifts.R<lifts.L?'R':'L';
   const alternate=this.support==='R'?'L':'R';
   if((lifts[alternate]<.024&&lifts[this.support]>.04)||this.contacts[this.support]?.step)this.support=alternate;
   if(mode!=='run')lifts[this.support]=0;
   for(const s of ['R','L']){
    const foot=f.feet[s],desired=out['ank'+s];
    const lift=lifts[s]*(1-f.legDamage[s]*.35);
    desired.y=.045+lift;
    let c=this.contacts[s];if(!c)c=this.contacts[s]={p:foot.p.clone().setY(.045),locked:true,yaw:f.bodyYaw};
    const wasLocked=c.locked;
    const other=this.contacts[s==='R'?'L':'R'];
    // A stationary pivot repositions one foot at a time instead of skating.
    if(!c.step&&speed<.25&&c.p.distanceTo(desired)>.14&&(!f._technique||f._technique.state==='guard')&&(!other||other.locked))c.step={from:c.p.clone(),to:desired.clone(),t:0};
    if(c.step){
     c.step.t+=dt;const t=clamp(c.step.t/.26,0,1);
     desired.lerpVectors(c.step.from,c.step.to,ease(t));desired.y=.045+Math.sin(t*Math.PI)*.055;
     c.locked=false;if(t===1){c.p.copy(desired);c.step=null;c.locked=true;c.yaw=f.bodyYaw;}
    }else if(lift<.022){
     if(!c.locked){c.p.copy(desired);c.p.y=.045;c.yaw=f.bodyYaw;f._motionLanding=true;}
     c.locked=true;
     // Large impulses may displace the support polygon; permit a catch step.
     if(c.p.distanceTo(desired)>.38&&(!other||other.locked)){c.step={from:c.p.clone(),to:desired.clone(),t:0};c.locked=false;}
     else desired.copy(c.p);
    }else c.locked=false;
    const oldLift=foot.lift||0;
    foot.landed=!wasLocked&&c.locked;
    if(f.disabled['leg'+s]){
     const previous=foot.p.clone();desired.lerpVectors(previous,desired,1-Math.exp(-6*dt));desired.y=.045;
     foot.dragFrom=previous;foot.landed=false;c.p.copy(desired);c.locked=true;
    }else foot.dragFrom=null;
    foot.p.copy(desired);foot.p.y=0;foot.lift=desired.y-.045;
    foot.swing=c.locked?0:clamp(foot.lift/.14,.02,.99);
    const yawDelta=Math.atan2(Math.sin(f.bodyYaw-c.yaw),Math.cos(f.bodyYaw-c.yaw));
    // The rear foot pivots around its planted contact during hip drive.
    const pivot=f._technique?(f._technique.body?.hip||0)*(s==='R'?.65:.22):0;
    foot.yaw=c.yaw+yawDelta*(c.locked?0:.4)+pivot;foot.roll=c.locked?0:clamp((oldLift-foot.lift)/Math.max(dt,.001)*.18,-.22,.28);
   }
   if(f._technique){
    const follow=f._technique.body?.shift||0;
    for(const k of ZMotionData.joints)if(!k.startsWith('ank'))out[k].addScaledVector(fw,follow);
   }
   this.pose=out;return out;
  }
 }
 // Authored two-hand technique poses, in metres relative to the pelvis.
 // yaw/pitch describe a rigid blade; roll describes the cutting plane.
 const poses={
  guard:{h:[.035,.29,.37],pitch:.32,yaw:0,roll:0,twist:0,sink:0},
  high:{h:[.12,.74,.08],pitch:2.1,yaw:.12,roll:0,twist:.16,sink:-.015},
  low:{h:[-.10,.13,.43],pitch:-.60,yaw:-.06,roll:0,twist:-.16,sink:.065},
  side:{h:[.34,.47,.12],pitch:.28,yaw:1.30,roll:-1.57079632679,twist:.48,sink:.015},
  across:{h:[-.34,.26,.28],pitch:.06,yaw:-1.20,roll:-1.57079632679,twist:-.48,sink:.065},
  chamber:{h:[.10,.29,.20],pitch:.05,yaw:0,roll:0,twist:.12,sink:.025},
  thrust:{h:[.02,.34,.56],pitch:.06,yaw:0,roll:0,twist:-.12,sink:.06}
 };
 const mixPose=(a,b,t)=>({h:a.h.map((x,i)=>x+(b.h[i]-x)*t),pitch:a.pitch+(b.pitch-a.pitch)*t,yaw:a.yaw+(b.yaw-a.yaw)*t,roll:a.roll+(b.roll-a.roll)*t,twist:a.twist+(b.twist-a.twist)*t,sink:a.sink+(b.sink-a.sink)*t});
 // Cubic trajectories preserve velocity across preparation, impact and follow-through.
 // The middle key describes passing through the target, not stopping at it.
 const duration={prepare:.28,strike:.34,recover:.46};
 const copy=p=>({...p,h:p.h.slice()});
 function curve(keys,t){
  let i=0;while(i<keys.length-2&&t>keys[i+1][0])i++;
  const [ta,a]=keys[i],[tb,b]=keys[i+1],span=tb-ta,u=clamp((t-ta)/span,0,1);
  const prev=keys[Math.max(0,i-1)],next=keys[Math.min(keys.length-1,i+2)];
  const interpolate=(av,bv,pv,nv)=>{
   const ma=i===0?0:(bv-pv)/(tb-prev[0]),mb=i+1===keys.length-1?0:(nv-av)/(next[0]-ta);
   return (2*u*u*u-3*u*u+1)*av+(u*u*u-2*u*u+u)*span*ma+(-2*u*u*u+3*u*u)*bv+(u*u*u-u*u)*span*mb;
  };
  const out={h:a.h.map((v,j)=>interpolate(v,b.h[j],prev[1].h[j],next[1].h[j]))};
  for(const k of ['pitch','yaw','roll','twist','sink'])out[k]=interpolate(a[k],b[k],prev[1][k],next[1][k]);
  return out;
 }
 function trajectory(type,start,direction=1){
  const wind=copy(type==='thrust'?poses.chamber:type==='across'?poses.side:poses.high);
  const end=copy(type==='thrust'?poses.thrust:type==='across'?poses.across:poses.low);
  if(type==='across'&&direction<0){
   for(const p of [wind,end]){p.h[0]*=-1;p.yaw*=-1;p.roll*=-1;p.twist*=-1;}
  }
  const pass=mixPose(wind,end,.58);pass.h[2]+=(type==='thrust'?.055:.16);
  // Raised arms, hip loading, then extension and a relaxed deceleration arc.
  const settle=mixPose(end,poses.guard,.25);settle.h[2]+=.08;
  return [[0,copy(start)],[.28,wind],[.45,pass],[.62,end],[.79,settle],[1.08,copy(poses.guard)]];
 }
 class Technique{
  constructor(){this.state='guard';this.t=0;this.pose={...poses.guard,h:poses.guard.h.slice()};this.type='down';this.telegraph=false;this.serial=0;this.q=Q();this.deflection=V();this.lastVelocity=null;this.body={hip:0,chest:0,shift:0,lean:0,extension:0};}
  update(f,dt){
   if(this.lastVelocity){
    const impulse=f.tipVel.clone().sub(this.lastVelocity);
    if(impulse.lengthSq()>.2)this.deflection.addScaledVector(impulse,.018).clampLength(0,.35);
   }
   this.deflection.multiplyScalar(Math.exp(-7*dt));
   const incoming=f._requestStrike||(!f.isPlayer&&f.telegraph&&!this.telegraph);
   if(incoming)this.buffer=.16;
   else this.buffer=Math.max(0,(this.buffer||0)-dt);
   const request=this.buffer>0;
   if(f.stun>.28&&(this.state==='prepare'||this.state==='strike')){
    this.recoveryStart={...this.pose,h:this.pose.h.slice()};this.state='recover';this.t=0;
   }
   this.telegraph=!!f.telegraph;f._requestStrike=false;
   if(request&&this.state==='guard'&&!f.guarding&&f.hasSword){
    const fw=new THREE.Vector3(Math.sin(f.bodyYaw),0,Math.cos(f.bodyYaw)),rt=new THREE.Vector3(fw.z,0,-fw.x);
    const offset=f.tipTarget.clone().sub(f.pos);
    this.type=f.thrust?'thrust':Math.abs(offset.dot(rt))>.5?'across':'down';
    this.direction=offset.dot(rt)<0?-1:1;
    this.buffer=0;this.recoveryStart=null;this.state='prepare';this.serial++;this.t=0;this.start=copy(this.pose);this.keys=trajectory(this.type,this.start,this.direction);
   }
   const speed=clamp((f.weapon.speed||1)*(.6+.4*f.swordControl),.35,1.35);
   this.t+=dt*speed;
   let desired;
   if(this.state==='prepare'||this.state==='strike'||(this.state==='recover'&&!this.recoveryStart)){
    const offset=this.state==='prepare'?0:this.state==='strike'?.28:.62;
    const time=offset+this.t;
    desired=curve(this.keys||trajectory(this.type,this.pose),time);
    const lead=ease(time/.18)*ease((1.08-time)/.18);
    const hip=curve(this.keys,Math.min(1.08,time+.055*lead));
    const chest=curve(this.keys,Math.min(1.08,time+.025*lead));
    this.body.hip=hip.twist*.65;this.body.chest=chest.twist*1.15;
    this.body.shift=clamp(desired.sink/.065,0,1)*.105;
    this.body.lean=clamp(desired.sink,-.02,.08)*.65;
    this.body.extension=Math.sin(Math.PI*clamp((time-.28)/.34,0,1));
    if(this.t>=duration[this.state]){this.t-=duration[this.state];this.state=this.state==='prepare'?'strike':this.state==='strike'?'recover':'guard';}
   }else if(this.state==='recover'){
    // Injury interrupts from the current pose, rather than snapping to the end key.
    desired=mixPose(this.recoveryStart,poses.guard,ease(this.t/.46));
    if(this.t>=.46){this.state='guard';this.t=0;this.recoveryStart=null;}
   }else{
    desired={...poses.guard,h:poses.guard.h.slice()};
    const fw=new THREE.Vector3(Math.sin(f.bodyYaw),0,Math.cos(f.bodyYaw)),rt=new THREE.Vector3(fw.z,0,-fw.x),offset=f.tipTarget.clone().sub(f.pos);
    desired.yaw=clamp(offset.dot(rt)*.25,-.32,.32);
    desired.pitch=clamp(.30+(offset.y-1.3)*.20,.12,.58);
    if(f.guarding){desired.h=[.02,.47,.32];desired.pitch=.95;}
   }
   if(this.state==='guard'||this.recoveryStart){
    const fade=1-Math.exp(-10*dt);
    for(const k of Object.keys(this.body))this.body[k]+=(0-this.body[k])*fade;
   }
   // Pose blending is limited to guard changes; committed cuts retain their
   // acceleration and follow-through rather than chasing the cursor each tick.
   this.pose=this.state==='guard'?mixPose(this.pose,desired,1-Math.exp(-14*dt)):desired;
   return this.pose;
  }
  weapon(f,pelvis){
   const p=this.pose,fw=new THREE.Vector3(Math.sin(f.bodyYaw),0,Math.cos(f.bodyYaw)),rt=new THREE.Vector3(fw.z,0,-fw.x);
   const handle=pelvis.clone().addScaledVector(rt,p.h[0]).addScaledVector(fw,p.h[2]);handle.y+=p.h[1];
   const dir=fw.clone().multiplyScalar(Math.cos(p.pitch)*Math.cos(p.yaw)).addScaledVector(rt,Math.cos(p.pitch)*Math.sin(p.yaw));dir.y=Math.sin(p.pitch);dir.add(this.deflection).normalize();
   const q=Q().setFromAxisAngle(new THREE.Vector3(0,1,0),f.bodyYaw+p.yaw)
     .multiply(Q().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2-p.pitch))
     .multiply(Q().setFromAxisAngle(new THREE.Vector3(0,1,0),p.roll));
   const nominal=new THREE.Vector3(0,1,0).applyQuaternion(q);
   q.premultiply(Q().setFromUnitVectors(nominal,dir));
   return {handle,dir,q};
  }
 }
 return {Locomotion,Technique,sample};
})();
