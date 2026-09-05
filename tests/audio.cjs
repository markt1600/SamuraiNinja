const assert=require('node:assert/strict'),fs=require('node:fs');
const {SampleBank,manifest}=require('../audio.js');
const nodes=[];
function node(){const n={gain:{value:0},pan:{value:0},playbackRate:{value:0},connect(){return this},disconnect(){this.disconnected=true},start(){},stop(){this.onended?.()}};nodes.push(n);return n;}
const ctx={state:'running',createBufferSource:node,createGain:node,createStereoPanner:node,decodeAudioData:async x=>x};
(async()=>{
 for(const file of Object.values(manifest).flat()){
  const b=fs.readFileSync('audio/'+file);assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt32LE(24),48000);assert.ok(b.length>4800);
 }
 const bank=new SampleBank(ctx,{},manifest);
 await bank.load(async url=>({ok:true,arrayBuffer:async()=>fs.readFileSync(url)}));
 assert.equal(Object.values(bank.buffers).flat().length,44);
 assert.equal(bank.failed.length,0);
 for(let k=0;k<30;k++){
  const previous=bank.last.steel;assert.equal(bank.play('steel',{gain:9,pan:-9}),true);
  assert.notEqual(bank.last.steel,previous);assert.equal(nodes.at(-2).gain.value,.85);assert.equal(nodes.at(-1).pan.value,-1);bank.stop();assert.equal(bank.voices.size,0);
 }
 for(let i=0;i<100;i++)bank.play('snow');assert.equal(bank.voices.size,24);bank.stop();
 ctx.state='suspended';bank.play('steel');assert.equal(bank.voices.size,0);
 const failed=new SampleBank(ctx,{}, {steel:['absent.wav']});await failed.load(async()=>({ok:false,status:404}));assert.equal(failed.play('steel'),false);assert.deepEqual(failed.failed,['absent.wav']);
 console.log('Audio assets, non-repetition, gain limits, voice cleanup, suspension and missing-file fallback passed.');
})().catch(e=>{console.error(e);process.exit(1)});
