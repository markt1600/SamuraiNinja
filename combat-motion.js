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
   const idle=sample('idle',this.idlePhase),moving=sample(mode,this.phase),out={};
   const scale=f.dims.pelvisY/.915;
   for(const k of ZMotionData.joints){
    const p=idle[k].lerp(moving[k],this.mix).multiplyScalar(scale);
    out[k]=f.pos.clone().addScaledVector(rt,p.x).addScaledVector(fw,p.z);out[k].y=p.y;
   }
   // A prepared strike sets the lead foot before the torso follows through.
   if(f._technique&&this.attackSerial!==f._technique.serial){
    this.attackSerial=f._technique.serial;
    if(this.attackSerial>0&&speed<.7){
     const lead='L',c=this.contacts[lead];
     if(c&&!this.contacts.R?.step){
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
    if(!c.step&&speed<.25&&c.p.distanceTo(desired)>.14&&(!other||other.locked))c.step={from:c.p.clone(),to:desired.clone(),t:0};
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
    foot.yaw=c.yaw+(f.bodyYaw-c.yaw)*(c.locked?0:.4);foot.roll=c.locked?0:clamp((oldLift-foot.lift)/Math.max(dt,.001)*.18,-.22,.28);
   }
   if(f._technique){
    const follow=clamp(f._technique.pose.sink/.065,0,1)*.09;
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
 class Technique{
  constructor(){this.state='guard';this.t=0;this.pose={...poses.guard,h:poses.guard.h.slice()};this.type='down';this.telegraph=false;this.serial=0;this.q=Q();this.deflection=V();this.lastVelocity=null;}
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
    this.buffer=0;this.recoveryStart=null;this.state='prepare';this.serial++;this.t=0;this.start={...this.pose,h:this.pose.h.slice()};
   }
   const speed=clamp((f.weapon.speed||1)*(.6+.4*f.swordControl),.35,1.35);
   this.t+=dt*speed;
   const wind=this.type==='thrust'?poses.chamber:this.type==='across'?poses.side:poses.high;
   const end=this.type==='thrust'?poses.thrust:this.type==='across'?poses.across:poses.low;
   let desired;
   if(this.state==='prepare'){
    desired=mixPose(this.start,wind,ease(this.t/.24));if(this.t>=.24){this.state='strike';this.t=0;}
   }else if(this.state==='strike'){
    const phase=clamp(this.t/(this.type==='thrust'?.20:.32),0,1);
    desired=mixPose(wind,end,ease(phase));
    // Hands lead the cut on a convex arc; the blade follows their acceleration.
    // Linear handle interpolation kept horizontal cuts tucked against the chest.
    const hands=ease(clamp(phase*1.18,0,1));
    desired.h=wind.h.map((x,i)=>x+(end.h[i]-x)*hands);
    if(this.type!=='thrust')desired.h[2]+=Math.sin(Math.PI*hands)*.16;
    if(this.t>=(this.type==='thrust'?.20:.32)){this.state='recover';this.t=0;}
   }else if(this.state==='recover'){
    desired=mixPose(this.recoveryStart||end,poses.guard,ease(this.t/.38));
    desired.h[2]+=.065*Math.sin(Math.PI*clamp(this.t/.38,0,1));if(this.t>=.38){this.state='guard';this.t=0;}
   }else{
    desired={...poses.guard,h:poses.guard.h.slice()};
    const fw=new THREE.Vector3(Math.sin(f.bodyYaw),0,Math.cos(f.bodyYaw)),rt=new THREE.Vector3(fw.z,0,-fw.x),offset=f.tipTarget.clone().sub(f.pos);
    desired.yaw=clamp(offset.dot(rt)*.25,-.32,.32);
    desired.pitch=clamp(.30+(offset.y-1.3)*.20,.12,.58);
    if(f.guarding){desired.h=[.02,.47,.32];desired.pitch=.95;}
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
