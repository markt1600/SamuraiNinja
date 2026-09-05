/* Fixed simulation cadence and render-only pose interpolation.
   Combat always reads authoritative transforms; smoothing never feeds back. */
const ZMotion=(()=>{
  class FixedClock{
    constructor(step=1/60,maxSteps=8){this.step=step;this.maxSteps=maxSteps;this.accumulator=0;this.dropped=0;}
    advance(elapsed,scale,update){
      if(!Number.isFinite(elapsed)||elapsed<=0)return this.accumulator/this.step;
      this.accumulator+=Math.min(elapsed,.25)*Math.max(0,scale);
      let n=0;
      while(this.accumulator+1e-10>=this.step&&n<this.maxSteps){
        update(this.step);this.accumulator-=this.step;n++;
      }
      if(this.accumulator>=this.step){
        const excess=Math.floor(this.accumulator/this.step)*this.step;
        this.dropped+=excess;this.accumulator-=excess;
      }
      this.accumulator=Math.max(0,this.accumulator);
      return this.accumulator/this.step;
    }
    reset(){this.accumulator=0;}
  }
  class PoseBuffer{
    constructor(){this.entries=new Map();}
    capture(objects){
      const active=new Set(objects);
      for(const [o] of this.entries)if(!active.has(o))this.entries.delete(o);
      for(const o of active){
        let e=this.entries.get(o);
        if(!e){e={p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone(),
          cp:o.position.clone(),cq:o.quaternion.clone(),cs:o.scale.clone()};this.entries.set(o,e);}
        e.p.copy(e.cp);e.q.copy(e.cq);e.s.copy(e.cs);
        e.cp.copy(o.position);e.cq.copy(o.quaternion);e.cs.copy(o.scale);
        // Teleports and model changes must appear immediately.
        if(e.p.distanceToSquared(e.cp)>4){e.p.copy(e.cp);e.q.copy(e.cq);e.s.copy(e.cs);}
      }
    }
    interpolate(alpha){for(const [o,e] of this.entries){
      o.position.lerpVectors(e.p,e.cp,alpha);o.quaternion.slerpQuaternions(e.q,e.cq,alpha);
      o.scale.lerpVectors(e.s,e.cs,alpha);
    }}
    restore(){for(const [o,e] of this.entries){o.position.copy(e.cp);o.quaternion.copy(e.cq);o.scale.copy(e.cs);}}
    clear(){this.entries.clear();}
  }
  return {FixedClock,PoseBuffer};
})();
if(typeof module!=='undefined')module.exports=ZMotion;
