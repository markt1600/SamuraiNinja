const fs=require('node:fs'),assert=require('node:assert/strict');
const b=fs.readFileSync(process.argv[2]||'models/ronin.glb'),jl=b.readUInt32LE(12),g=JSON.parse(b.subarray(20,20+jl)),bin=b.subarray(28+jl);
assert.equal(g.skins.length,1);assert.equal(g.skins[0].joints.length,53);
function read(i){const a=g.accessors[i],v=g.bufferViews[a.bufferView],off=(v.byteOffset||0)+(a.byteOffset||0),n=a.count*({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type]);return Array.from({length:n},(_,k)=>a.componentType===5126?bin.readFloatLE(off+k*4):a.componentType===5123?bin.readUInt16LE(off+k*2):bin.readUInt32LE(off+k*4));}
let verts=0;
for(const m of g.meshes)for(const p of m.primitives){const A=p.attributes,P=read(A.POSITION),J=read(A.JOINTS_0),W=read(A.WEIGHTS_0);verts+=P.length/3;
 assert.equal(P.length/3,J.length/4);assert.ok(P.every(Number.isFinite));assert.ok(J.every(j=>j>=0&&j<53));
 for(let i=0;i<W.length;i+=4)assert.ok(Math.abs(W.slice(i,i+4).reduce((a,b)=>a+b,0)-1)<1e-6);
 for(let v=0;v<P.length/3;v++)if(Math.abs(P[v*3])>.395&&P[v*3+1]<1.065){
  for(let k=0;k<4;k++)if(W[v*4+k]>.005){
   const name=g.nodes[g.skins[0].joints[J[v*4+k]]].name;
   assert.ok(/Hand|ForeArm/.test(name),`Distal hand vertex ${v} follows ${name}`);
  }
 }
 assert.ok(read(p.indices).every(i=>i<P.length/3));
}
const names=new Set(g.nodes.map(n=>n.name));for(const s of ['Right','Left'])for(const n of ['Arm','ForeArm','Hand','UpLeg','Leg','Foot'])assert.ok(names.has(s+n));
for(const im of g.images){const v=g.bufferViews[im.bufferView];assert.ok(v.byteOffset+v.byteLength<=bin.length);assert.ok(v.byteLength>1000);}
console.log(`Character: ${verts} vertices, 53 joints, normalized weights, valid indices and embedded textures passed.`);
