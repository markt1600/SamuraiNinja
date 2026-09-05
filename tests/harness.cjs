const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
async function loadGame({modelPipeline=false}={}){
 const source=fs.readFileSync('vendor/three.module.js','utf8');
 const T=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 class Element{
   constructor(){this.style={};this.children=[];this.classList={add(){},remove(){},toggle(){},contains(){return false}};this.innerHTML='';this.userData={};}
   appendChild(x){this.children.push(x);return x}append(x){this.children.push(x)}remove(){}removeChild(x){const i=this.children.indexOf(x);this.children.splice(i<0?0:i,1)}get firstChild(){return this.children[0]}get lastChild(){return this.children[this.children.length-1]}setAttribute(){}getAttribute(){return ''}addEventListener(){}querySelector(){return new Element()}querySelectorAll(){return []}getContext(){return null}getBoundingClientRect(){return {width:1280,height:720,left:0,top:0}}insertBefore(){}
 }
 const document={body:new Element(),documentElement:new Element(),createElement:()=>new Element(),createElementNS:()=>new Element(),getElementById:()=>new Element(),querySelector:()=>new Element(),querySelectorAll:()=>[],addEventListener(){}};
 class Renderer{constructor(){this.domElement=new Element();this.shadowMap={};this.info={reset(){},render:{}};this.capabilities={getMaxAnisotropy:()=>8};}setSize(){}setPixelRatio(){}setRenderTarget(){}render(){}compile(){}}
 const THREE={...T,WebGLRenderer:Renderer,PMREMGenerator:class{fromScene(){return {texture:new T.Texture()}}dispose(){}}};
 if(modelPipeline)THREE.GLTFLoader=class{load(url,ok,progress,fail){fail?.();}};
 let randomSeed=731;
 const math=Object.create(Math);math.random=()=>{randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed/4294967296};
 const context=vm.createContext({THREE,document,window:{},innerWidth:1280,innerHeight:720,devicePixelRatio:1,
  console:{log(){},warn(){},error:console.error},Math:math,process,performance:{now:()=>0},requestAnimationFrame(){},addEventListener(){},setTimeout(){},clearTimeout(){},setInterval(){},localStorage:{getItem(){return null},setItem(){}},URLSearchParams,location:{search:''}});
 for(const f of ['audio.js','motion.js','motion-data.js','combat-motion.js','physics.js','world.js','game.js']){
  let source=fs.readFileSync(f,'utf8');
  // Enable only the real model pipeline, without enabling browser asset fetches.
  if(modelPipeline&&f==='game.js')source=source.replace("typeof process!=='undefined'||typeof THREE.GLTFLoader==='undefined'","typeof THREE.GLTFLoader==='undefined'");
  vm.runInContext(source,context,{filename:f});
 }
 return {context,THREE,run:code=>vm.runInContext(code,context,{timeout:5000})};
}
module.exports={loadGame};
if(require.main===module)loadGame().then(({run})=>{
 console.log(run(`game.state='fight'; for(const k of Object.keys(Sound))Sound[k]=()=>{}; for(let i=0;i<120;i++)simulate(1/60); JSON.stringify({time:simulationTime,state:game.state,player:player.pos.toArray(),enemy:enemy.pos.toArray(),bodies:PHYS.engine.bodies.length})`));
}).catch(e=>{console.error(e);process.exit(1)});
