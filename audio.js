/* Recorded, local Foley. Missing samples leave the synthesis fallback usable. */
'use strict';
const ZAudio=(()=>{
 class SampleBank{
  constructor(ctx,destination,manifest){this.ctx=ctx;this.destination=destination;this.manifest=manifest;this.buffers={};this.last={};this.voices=new Set();this.failed=[];this.ready=null;}
  load(fetcher=fetch){
   if(this.ready)return this.ready;
   this.ready=Promise.all(Object.entries(this.manifest).map(async([kind,files])=>{
    const decoded=await Promise.all(files.map(async file=>{
     try{const response=await fetcher('audio/'+file);if(!response.ok)throw new Error(response.status);
      return await this.ctx.decodeAudioData(await response.arrayBuffer());
     }catch(e){this.failed.push(file);return null;}
    }));this.buffers[kind]=decoded.filter(Boolean);
   }));return this.ready;
  }
  play(kind,{gain=.3,rate=1,pan=0}={}){
   const clips=this.buffers[kind];if(!clips||!clips.length)return false;
   // Do not queue suspended audio, or pile up old impacts after returning to a tab.
   if(this.ctx.state!=='running'||this.voices.size>=24)return true;
   let i=Math.floor(Math.random()*clips.length);
   if(clips.length>1&&i===this.last[kind])i=(i+1)%clips.length;
   this.last[kind]=i;
   const source=this.ctx.createBufferSource(),level=this.ctx.createGain(),stereo=this.ctx.createStereoPanner();
   source.buffer=clips[i];source.playbackRate.value=Math.max(.7,Math.min(1.4,rate));
   level.gain.value=Math.max(0,Math.min(.85,gain));stereo.pan.value=Math.max(-1,Math.min(1,pan));
   source.connect(level).connect(stereo).connect(this.destination);
   this.voices.add(source);
   source.onended=()=>{source.disconnect();level.disconnect();stereo.disconnect();this.voices.delete(source);};
   source.start();return true;
  }
  stop(){for(const source of this.voices){try{source.stop();}catch(e){}}}
 }
 const numbered=(name,n)=>Array.from({length:n},(_,i)=>`${name}-${i+1}.wav`);
 const manifest={flesh:numbered('flesh',4),impact:numbered('impact',4),steel:numbered('steel',6),parry:numbered('parry',4),snow:numbered('snow',9),
  cloth:numbered('cloth',4),swish:numbered('swish',5),scrape:numbered('scrape',3),voice:numbered('voice',5)};
 return {SampleBank,manifest};
})();
if(typeof module!=='undefined')module.exports=ZAudio;
