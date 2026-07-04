/* =========================================================================
   ZAN PHYSICS — a compact XPBD articulated rigid-body engine.
   Bodies with real mass and inertia; joints as compliant positional
   constraints; MOTORS as compliant angular constraints (torque drive);
   sphere-ground contacts with friction. Substepped, stable, headless.
   No dependencies beyond THREE math types.
   ========================================================================= */
const ZPhys=(()=>{
  const V=(x,y,z)=>new THREE.Vector3(x||0,y||0,z||0);
  const _a=V(),_b=V(),_c=V(),_d=V(),_n=V(),_r1=V(),_r2=V();
  const _q=new THREE.Quaternion(),_q2=new THREE.Quaternion();

  class Body{
    constructor(o){
      this.pos=o.pos.clone(); this.q=(o.q||new THREE.Quaternion()).clone();
      this.prevPos=this.pos.clone(); this.prevQ=this.q.clone();
      this.vel=V(); this.w=V();                       // linear + angular velocity
      this.invMass=o.mass>0?1/o.mass:0;
      /* solid-capsule-ish inertia about principal axes (body space) */
      const m=o.mass||1, rx=o.r||.06, len=o.len||.3;
      const iLong=.5*m*rx*rx, iTrans=m*(len*len/12+rx*rx/4);
      this.invI=V(1/iTrans,1/iLong,1/iTrans);         // Y = long axis
      if(o.mass<=0)this.invI.set(0,0,0);
      this.r=rx; this.len=len;                        // capsule: ±len/2 along local Y
      this.damping=o.damping!==undefined?o.damping:.35;
      this.name=o.name||'';
    }
    /* world point of a body-local point */
    toWorld(local,out){ return out.copy(local).applyQuaternion(this.q).add(this.pos); }
    toLocal(world,out){ return out.copy(world).sub(this.pos)
      .applyQuaternion(_q.copy(this.q).invert()); }
    /* generalized inverse mass seen at point r (world offset from com) along n */
    wAt(rW,n){
      if(this.invMass===0)return 0;
      _c.crossVectors(rW,n).applyQuaternion(_q.copy(this.q).invert());
      return this.invMass
        +_c.x*_c.x*this.invI.x+_c.y*_c.y*this.invI.y+_c.z*_c.z*this.invI.z;
    }
    /* apply positional correction dp at world offset rW */
    applyCorr(dp,rW){
      if(this.invMass===0)return;
      this.pos.addScaledVector(dp,this.invMass);
      _c.crossVectors(rW,dp).applyQuaternion(_q.copy(this.q).invert());
      _c.multiply(this.invI).applyQuaternion(this.q);   // Δθ world
      const ang=_c.length();
      if(ang>1e-9){
        _q2.setFromAxisAngle(_c.normalize(),ang);
        this.q.premultiply(_q2).normalize();
      }
    }
    /* apply pure angular correction (world rotation vector) scaled by wSelf share */
    applyAngCorr(dth){
      _c.copy(dth).applyQuaternion(_q.copy(this.q).invert())
        .multiply(this.invI).applyQuaternion(this.q);
      const ang=_c.length();
      if(ang>1e-9){ _q2.setFromAxisAngle(_c.normalize(),ang);
        this.q.premultiply(_q2).normalize(); }
    }
    angW(dthDir){ // generalized inverse mass for angular constraint along axis
      _c.copy(dthDir).applyQuaternion(_q.copy(this.q).invert());
      return _c.x*_c.x*this.invI.x+_c.y*_c.y*this.invI.y+_c.z*_c.z*this.invI.z;
    }
  }

  /* ball joint: world anchors coincide. localA on a, localB on b. */
  class Joint{
    constructor(a,b,worldPt,compliance){
      this.a=a; this.b=b;
      this.la=V(); a.toLocal(worldPt,this.la);
      this.lb=V(); b.toLocal(worldPt,this.lb);
      this.compliance=compliance||0;
    }
    solve(h){
      const a=this.a,b=this.b;
      a.toWorld(this.la,_a); b.toWorld(this.lb,_b);
      _n.subVectors(_a,_b); const c=_n.length();
      if(c<1e-9)return;
      _n.divideScalar(c);
      _r1.subVectors(_a,a.pos); _r2.subVectors(_b,b.pos);
      const w=a.wAt(_r1,_n)+b.wAt(_r2,_n)+this.compliance/(h*h);
      if(w<1e-12)return;
      const dl=-c/w;
      _d.copy(_n).multiplyScalar(dl);
      a.applyCorr(_d,_r1);
      _d.negate(); b.applyCorr(_d,_r2);
    }
  }

  /* motor: drive body's WORLD orientation toward target quaternion.
     compliance sets "strength"; maxCorr per substep is the torque limit. */
  class Motor{
    constructor(body){ this.body=body; this.target=new THREE.Quaternion();
      this.compliance=.002; this.enabled=true; this.maxCorr=.35; }
    solve(h){
      if(!this.enabled)return;
      const b=this.body;
      _q.copy(this.target).multiply(_q2.copy(b.q).invert()); // Δq world
      if(_q.w<0){_q.x*=-1;_q.y*=-1;_q.z*=-1;_q.w*=-1;}
      _n.set(_q.x,_q.y,_q.z);
      const s=_n.length();
      if(s<1e-7)return;
      const ang=2*Math.atan2(s,_q.w);
      _n.divideScalar(s);                                 // axis
      const aw=b.angW(_n);
      const w=aw+this.compliance/(h*h);
      if(w<1e-12||aw<1e-12)return;
      let lam=ang/w;
      const cap=this.maxCorr/aw;                 // torque limit: cap resulting angle
      if(lam>cap)lam=cap;
      b.applyAngCorr(_c.copy(_n).multiplyScalar(lam));
    }
  }

  /* soft positional anchor: pull a body point toward a world target (assist) */
  class Anchor{
    constructor(body,local){ this.body=body; this.local=local.clone();
      this.target=V(); this.compliance=.001; this.enabled=true; }
    solve(h){
      if(!this.enabled)return;
      const b=this.body;
      b.toWorld(this.local,_a);
      _n.subVectors(this.target,_a); const c=_n.length();
      if(c<1e-9)return;
      _n.divideScalar(c);
      _r1.subVectors(_a,b.pos);
      const w=b.wAt(_r1,_n)+this.compliance/(h*h);
      if(w<1e-12)return;
      _d.copy(_n).multiplyScalar(c/w);
      b.applyCorr(_d,_r1);
    }
  }

  class Engine{
    constructor(){ this.bodies=[]; this.joints=[]; this.motors=[]; this.anchors=[];
      this.g=V(0,-9.81,0); this.substeps=10; this.iters=3; this.groundY=0;
      this.friction=.85; }
    add(b){ this.bodies.push(b); return b; }
    joint(a,b,pt,comp){ const j=new Joint(a,b,pt,comp||0); this.joints.push(j); return j; }
    motor(b){ const m=new Motor(b); this.motors.push(m); return m; }
    anchor(b,local){ const a=new Anchor(b,local); this.anchors.push(a); return a; }
    step(dt){
      const n=this.substeps, h=dt/n;
      for(let s=0;s<n;s++){
        /* predict */
        for(const b of this.bodies){
          if(b.invMass===0)continue;
          b.prevPos.copy(b.pos); b.prevQ.copy(b.q);
          b.vel.addScaledVector(this.g,h);
          b.pos.addScaledVector(b.vel,h);
          if(b.w.lengthSq()>1e-12){
            _q2.set(b.w.x*h*.5,b.w.y*h*.5,b.w.z*h*.5,0).multiply(b.q);
            b.q.x+=_q2.x; b.q.y+=_q2.y; b.q.z+=_q2.z; b.q.w+=_q2.w;
            b.q.normalize();
          }
        }
        /* constraints */
        for(let it=0;it<this.iters;it++){
          for(const j of this.joints)j.solve(h);
          for(const m of this.motors)m.solve(h);
          for(const a of this.anchors)a.solve(h);
          this.contacts(h);
        }
        /* derive velocities */
        for(const b of this.bodies){
          if(b.invMass===0)continue;
          b.vel.subVectors(b.pos,b.prevPos).divideScalar(h);
          _q.copy(b.q).multiply(_q2.copy(b.prevQ).invert());
          if(_q.w<0){_q.x*=-1;_q.y*=-1;_q.z*=-1;_q.w*=-1;}
          b.w.set(_q.x,_q.y,_q.z).multiplyScalar(2/h);
          const dmp=Math.exp(-b.damping*h);
          b.vel.multiplyScalar(dmp); b.w.multiplyScalar(dmp);
          /* hard sanity clamps */
          if(b.vel.lengthSq()>400)b.vel.clampLength(0,20);
          if(b.w.lengthSq()>2500)b.w.clampLength(0,50);
        }
      }
    }
    contacts(h){
      for(const b of this.bodies){
        if(b.invMass===0)continue;
        /* capsule endpoints vs ground plane */
        for(const sy of [-1,1]){
          _a.set(0,sy*b.len/2,0); b.toWorld(_a,_b);
          const pen=this.groundY+b.r-_b.y;
          if(pen>0){
            _r1.subVectors(_b,b.pos);
            _n.set(0,1,0);
            const w=b.wAt(_r1,_n);
            if(w>1e-12){
              _d.set(0,pen/w,0);
              b.applyCorr(_d,_r1);
              /* Coulomb friction: tangential correction capped by μ·penetration */
              _d.set(-(b.pos.x-b.prevPos.x),0,-(b.pos.z-b.prevPos.z));
              const tl=_d.length(), cap=this.friction*pen;
              if(tl>1e-12){ if(tl>cap)_d.multiplyScalar(cap/tl);
                b.applyCorr(_d,_r1); }
            }
          }
        }
      }
    }
  }
  return {Engine,Body,V};
})();
if(typeof module!=='undefined')module.exports=ZPhys;
