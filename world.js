/* A deterministic winter environment, instanced to keep draw cost bounded.
   Scenery starts beyond the fighting circle and never changes collision. */
function buildWinterWorld(scene,stdMat,SRGB){
  let seed=1947;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const range=(a,b)=>a+(b-a)*random();
  const group=new THREE.Group();group.name='winter-environment';scene.add(group);
  const matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),pos=new THREE.Vector3(),scale=new THREE.Vector3();
  const up=new THREE.Vector3(0,1,0),dir=new THREE.Vector3();
  const stone=stdMat(0x677078,{roughness:.93});
  const snow=stdMat(0xe6ecee,{roughness:.86});
  const bark=stdMat(0x4d463c,{roughness:1});
  const bough=canTex(512,256,(ctx,w,h)=>{
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='#43453b';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(5,h/2);ctx.lineTo(w-12,h/2);ctx.stroke();
    for(let k=0;k<110;k++){
      const x=range(5,w-18),spread=(1-x/w)*h*.48+8;
      for(const side of [-1,1]){
        const endX=x+range(12,48),endY=h/2+side*spread*range(.5,1);
        ctx.strokeStyle='#39463d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,h/2);ctx.lineTo(endX,endY);ctx.stroke();
        for(let j=0;j<9;j++){
          const t=j/9,px=x+(endX-x)*t,py=h/2+(endY-h/2)*t;
          ctx.strokeStyle=j%3===0?'#76867a':'#40574b';ctx.lineWidth=1.6;
          ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+range(8,18),py+side*range(3,10));ctx.stroke();
        }
        if(k%3!==0){ctx.strokeStyle=k%2?'#e3e9e8':'#b8cbcF';ctx.lineWidth=range(2,5);ctx.beginPath();
          ctx.moveTo(x+5,h/2+side*2);ctx.lineTo(endX-3,endY-side*5);ctx.stroke();}
      }
    }
  });
  const needles=stdMat(0xffffff,{map:bough,roughness:.95,alphaTest:.42,side:THREE.DoubleSide});
  // World-space grain: meter-scale weathering with finer surface variation.
  for(const [mat,amount] of [[stone,.2],[bark,.3],[snow,.045]]){
    mat.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>',
        '#include <common>\nvarying vec3 winterPosition;').replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvec4 wp=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nwp=instanceMatrix*wp;\n#endif\nwinterPosition=(modelMatrix*wp).xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
        '#include <common>\nvarying vec3 winterPosition;\nfloat winterHash(vec3 p){return fract(sin(dot(p,vec3(12.9,78.2,43.7)))*43758.5453);}')
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat grain=winterHash(floor(winterPosition*160.));\nfloat weather=sin(winterPosition.x*7.+sin(winterPosition.z*5.))*sin(winterPosition.y*9.);\ndiffuseColor.rgb*=1.+(weather*.6+grain-.5)*'+amount.toFixed(3)+';');
    };
    mat.customProgramCacheKey=()=>`winter-${amount}`;
  }
  const rockGeo=new THREE.IcosahedronGeometry(1,2);
  const vertices=rockGeo.attributes.position;
  for(let i=0;i<vertices.count;i++){
    const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i);
    const d=1+.13*Math.sin(x*9+z*5)*Math.cos(y*7-z*3);
    vertices.setXYZ(i,x*d,y*d,z*d);
  }
  rockGeo.computeVertexNormals();
  const rocks=new THREE.InstancedMesh(rockGeo,stone,84);
  const caps=new THREE.InstancedMesh(new THREE.SphereGeometry(1,12,8,0,Math.PI*2,0,Math.PI*.48),snow,84);
  for(let i=0;i<84;i++){
    const angle=range(0,Math.PI*2),r=range(7.7,29),h=range(.18,.95),w=range(.3,1.2);
    pos.set(Math.cos(angle)*r,h*.22,Math.sin(angle)*r);quat.setFromAxisAngle(up,range(0,6.28));
    rocks.setMatrixAt(i,matrix.compose(pos,quat,scale.set(w,h,w*.8)));
    pos.y+=h*.28;caps.setMatrixAt(i,matrix.compose(pos,quat,scale.set(w*.93,h*.75,w*.75)));
  }
  rocks.castShadow=true;rocks.receiveShadow=true;caps.receiveShadow=true;group.add(rocks,caps);
  // Branch whorls with individual needle fans break up the old cone skyline.
  const treeCount=72,levels=9,arms=5;
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.055,.16,1,7),bark,treeCount);
  const branches=new THREE.InstancedMesh(new THREE.CylinderGeometry(.008,.032,1,5),bark,treeCount*levels*arms);
  const boughGeo=new THREE.PlaneGeometry(1,1);boughGeo.rotateX(-Math.PI/2);
  const foliage=new THREE.InstancedMesh(boughGeo,needles,treeCount*levels*arms);
  const dust=new THREE.InstancedMesh(boughGeo,needles,treeCount*levels*arms);
  let index=0;
  for(let i=0;i<treeCount;i++){
    const angle=range(0,Math.PI*2),r=range(15,48),h=range(5,12),rotation=range(0,6.28);
    const x=Math.cos(angle)*r,z=Math.sin(angle)*r;
    pos.set(x,h*.5,z);quat.setFromAxisAngle(up,rotation);
    trunks.setMatrixAt(i,matrix.compose(pos,quat,scale.set(1,h,1)));
    for(let l=0;l<levels;l++)for(let j=0;j<arms;j++){
      const phase=l/(levels-1),a=rotation+j*6.283/arms+l*1.71;
      const len=(1-phase*.84)*h*.22*range(.75,1.12),y=h*(.22+phase*.73);
      dir.set(Math.cos(a)*len,-len*.18,Math.sin(a)*len);
      pos.set(x+dir.x*.5,y+dir.y*.5,z+dir.z*.5);quat.setFromUnitVectors(up,dir.clone().normalize());
      branches.setMatrixAt(index,matrix.compose(pos,quat,scale.set(1,dir.length(),1)));
      quat.setFromAxisAngle(up,-a);
      pos.set(x+Math.cos(a)*len*.67,y-len*.1,z+Math.sin(a)*len*.67);
      foliage.setMatrixAt(index,matrix.compose(pos,quat,scale.set(len*1.7,1,len*.92)));
      quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.65));
      dust.setMatrixAt(index,matrix.compose(pos,quat,scale.set(len*1.6,1,len*.86)));index++;
    }
  }
  trunks.castShadow=true;branches.castShadow=true;
  for(const mesh of [trunks,branches,foliage,dust]){mesh.receiveShadow=true;group.add(mesh);}
  // Uneven snow drifts beyond the rope; the playable surface stays level.
  const driftGeo=new THREE.RingGeometry(5.65,60,144,26);driftGeo.rotateX(-Math.PI/2);
  const vp=driftGeo.attributes.position;
  for(let i=0;i<vp.count;i++){
    const x=vp.getX(i),z=vp.getZ(i),r=Math.hypot(x,z);
    const fade=Math.min(1,Math.max(0,(r-5.65)/5));
    vp.setY(i,fade*(.15+.14*Math.sin(x*.43+Math.sin(z*.3))+.12*Math.sin(z*.71+x*.17)));
  }
  driftGeo.computeVertexNormals();const drifts=new THREE.Mesh(driftGeo,snow);drifts.receiveShadow=true;group.add(drifts);
  return group;
}

function loadWinterMaterials(){
  if(typeof process!=='undefined')return;
  const loader=new THREE.TextureLoader();
  const terrainRepeat=(texture,n,srgb=false)=>{
    const t=texture.clone();t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(n,n);
    t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;
    t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());t.needsUpdate=true;return t;
  };
  loader.load('textures/snow-diffuse.jpg',texture=>{
    groundMat.map=terrainRepeat(texture,80,true);groundMat.needsUpdate=true;
    // Photographed detail overlays the live footprint/blood canvas rather
    // than replacing it. World-space 2 m tiling matches the normal maps.
    const albedo=terrainRepeat(texture,1,true),previous=ringGroundMat.onBeforeCompile;
    ringGroundMat.onBeforeCompile=shader=>{
      previous(shader);shader.uniforms.winterAlbedo={value:albedo};
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
        '#include <common>\nuniform sampler2D winterAlbedo;')
        .replace('#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb*=texture2D(winterAlbedo,vWp.xz*.5).rgb;');
    };
    ringGroundMat.customProgramCacheKey=()=>'winter-scanned-snow';ringGroundMat.needsUpdate=true;
  },undefined,()=>console.warn('Snow photograph unavailable; using procedural snow.'));
  loader.load('textures/snow-normal.jpg',texture=>{
    groundMat.normalMap=terrainRepeat(texture,80);groundMat.normalScale=new THREE.Vector2(.55,.55);
    ringGroundMat.normalMap=terrainRepeat(texture,5.45);ringGroundMat.normalScale.set(.4,.4);
    groundMat.needsUpdate=ringGroundMat.needsUpdate=true;
  });
  loader.load('textures/snow-roughness.jpg',texture=>{
    groundMat.roughnessMap=terrainRepeat(texture,80);ringGroundMat.roughnessMap=terrainRepeat(texture,5.45);
    groundMat.roughness=ringGroundMat.roughness=.92;groundMat.needsUpdate=ringGroundMat.needsUpdate=true;
  });
  if(THREE.RGBELoader)new THREE.RGBELoader().load('textures/winter-forest.hdr',texture=>{
    texture.mapping=THREE.EquirectangularReflectionMapping;
    const pmrem=new THREE.PMREMGenerator(renderer);
    const env=pmrem.fromEquirectangular(texture);
    scene.environment=env.texture;scene.environmentIntensity=.4;
    scene.background=texture;scene.backgroundBlurriness=.012;scene.backgroundIntensity=.55;
    scene.fog.color.copy(SRGB(0xa6b7c4));scene.fog.density=.012;
    for(const mesh of AMB.backdrops||[])mesh.visible=false;
    pmrem.dispose();
  },undefined,()=>console.warn('Winter HDR unavailable; using the procedural sky.'));
}
