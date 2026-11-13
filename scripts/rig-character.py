"""Rig the CC-BY Thomas Walker OBJ-derived GLB. Requires numpy and Pillow.
Usage: python rig-character.py source.glb models/ronin.glb
Authored neutral-pose landmarks; four normalized influences per vertex.
"""
import json,struct,sys,io
from pathlib import Path
import numpy as np
from PIL import Image
raw=Path(sys.argv[1]).read_bytes();jlen=struct.unpack_from('<I',raw,12)[0]
g=json.loads(raw[20:20+jlen]);old=raw[28+jlen:];binary=bytearray();views=[];access=[]
def view(data):
 while len(binary)%4:binary.append(0)
 i=len(views);views.append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)});binary.extend(data);return i
def acc(a,typ,ct):
 a=np.asarray(a,dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[ct]);i=len(access);d={'bufferView':view(a.tobytes()),'componentType':ct,'count':len(a),'type':typ}
 if typ=='VEC3':d.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
 access.append(d);return i
def read(i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[a['componentType']]
 return np.frombuffer(old,dtype=dtype,count=a['count']*n,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n).copy()
# Coordinates in centimetres after the author's Z-up export is transformed Y-up.
landmarks=[]
def bone(name,parent,xyz):landmarks.append((name,parent,np.array(xyz,dtype=float)/100));return name
bone('Hips',None,[0,88,0]);bone('Spine','Hips',[0,104,0]);bone('Spine1','Spine',[0,119,0]);bone('Spine2','Spine1',[0,134,0]);bone('Neck','Spine2',[0,145,0]);bone('Head','Neck',[0,154,0]);bone('HeadTop','Head',[0,178,0])
for side,sign in [('Right',1),('Left',-1)]:
 def B(n,p,x,y,z=0):return bone(side+n,side+p if p else 'Spine2',[sign*x,y,z])
 B('Shoulder',None,9,137);B('Arm','Shoulder',20,136);B('ForeArm','Arm',34,118,1);B('Hand','ForeArm',45,103,8.5)
 # Fingers have separate chains so grip flexion is visible at the hilt.
 for fn,z in [('Index',12.6),('Middle',10.0),('Ring',7.5),('Pinky',5.2)]:
  for seg,x,y in [(1,48,95),(2,49,90.5),(3,49,86.5)]:B('Hand'+fn+str(seg),'Hand' if seg==1 else 'Hand'+fn+str(seg-1),x,y,z)
 for seg,x,y,z in [(1,44,98,12),(2,44,94,13.5),(3,44,90.5,13.7)]:B('HandThumb'+str(seg),'Hand' if seg==1 else 'HandThumb'+str(seg-1),x,y,z)
 bone(side+'UpLeg','Hips',[sign*11,85,0]);B('Leg','UpLeg',13,47,1.5);B('Foot','Leg',13,4,0);B('ToeBase','Foot',13,-2,12)
ids={n:i for i,(n,p,v) in enumerate(landmarks)};positions=np.array([v for n,p,v in landmarks]);nodes=[]
for n,p,v in landmarks:
 nodes.append({'name':n,'translation':(v-(positions[ids[p]] if p else 0)).tolist(),'children':[]})
for i,(n,p,v) in enumerate(landmarks):
 if p:nodes[ids[p]]['children'].append(i)
segments=[]
for i,(n,p,v) in enumerate(landmarks):
 children=nodes[i]['children'];end=positions[children[0]] if children else v+np.array([0,-.025,0]);segments.append((v,end))
def weights(P,material):
 # Distance to anatomical segments. Branch separation prevents a hand from
 # being weighted to the nearby hip and one leg from pulling the other.
 D=[]
 for i,(a,b) in enumerate(segments):
  ab=b-a;t=np.clip(((P-a)@ab)/(ab@ab+1e-10),0,1);d=np.linalg.norm(P-a-t[:,None]*ab,axis=1)
  n=landmarks[i][0];x=P[:,0];y=P[:,1]
  if 'Right' in n:d+=np.where(x<-.01,2,0)
  if 'Left' in n:d+=np.where(x>.01,2,0)
  if any(k in n for k in ['Shoulder','Arm','Hand']):d+=np.where((abs(x)<.18)|(y<.77),2,0)
  if any(k in n for k in ['Leg','Foot','Toe']):d+=np.where(y>.96,2,0)
  if 'Hand' in n:d+=np.clip((.36-abs(x))/.08,0,1)*2
  # Finger flexion starts at the knuckle, not across the back of the hand.
  # Feather the transition so neighboring triangles cannot cross a hard mask.
  if 'Hand' in n and any(k in n for k in ['Index','Middle','Ring','Pinky','Thumb']):
   base=.975 if 'Thumb' in n else .94
   d+=np.clip((y-base)/.055,0,1)*.35
  if n in ['Head','HeadTop']:d+=np.where(y<1.46,2,0)
  if n=='HeadTop':d+=.2
  # Distal hands extend below the waist in the supplied A-pose. Never
  # classify them as legs by height; this caused the long hip-to-finger spikes.
  hand_region=(abs(x)>.395)&(y<1.065)
  if not any(k in n for k in ['Hand','ForeArm']):d+=np.where(hand_region,10,0)
  D.append(d)
 D=np.array(D).T
 I=np.argsort(D,axis=1)[:,:4];d=np.take_along_axis(D,I,axis=1);W=1/(d+.018)**5
 # Helmet, mask, face and hair remain rigid with the head.
 head=P[:,1]>1.515;I[head]=ids['Head'];W[head]=[1,0,0,0]
 # Upper cuirass should not fold like skin when the shoulders rotate.
 chest=(P[:,1]>1.18)&(P[:,1]<1.43)&(abs(P[:,0])<.17)
 I[chest]=ids['Spine2'];W[chest]=[1,0,0,0]
 W/=W.sum(axis=1)[:,None];return I,W
meshes=[]
for mesh in g['meshes']:
 prims=[]
 for p in mesh['primitives']:
  A={};P=None
  for key,i in p['attributes'].items():
   a=read(i);typ=g['accessors'][i]['type'];ct=g['accessors'][i]['componentType']
   if key in ['POSITION','NORMAL']:
    a=a[:,[0,2,1]];a[:,2]*=-1
    if key=='POSITION':a/=100;P=a
   if key=='TANGENT':
    a=a[:,[0,2,1,3]];a[:,2]*=-1
   A[key]=acc(a,typ,ct)
  I,W=weights(P,p.get('material',0));A['JOINTS_0']=acc(I,'VEC4',5123);A['WEIGHTS_0']=acc(W,'VEC4',5126)
  prims.append({'attributes':A,'indices':acc(read(p['indices']),'SCALAR',g['accessors'][p['indices']]['componentType']),'material':p['material']})
 meshes.append({'name':mesh.get('name','Samurai'),'primitives':prims})
meshNodes=[]
for i,m in enumerate(meshes):meshNodes.append(len(nodes));nodes.append({'name':'SamuraiSurface'+str(i),'mesh':i,'skin':0})
ibm=np.tile(np.eye(4),(len(landmarks),1,1));ibm[:,:3,3]=-positions
ibmidx=acc(ibm.transpose(0,2,1).reshape(-1,16),'MAT4',5126)
images=[]
for i,img in enumerate(g['images']):
 v=g['bufferViews'][img['bufferView']];b=old[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];im=Image.open(io.BytesIO(b));limit=4096 if i in [0,3] else 2048;im.thumbnail((limit,limit),Image.Resampling.LANCZOS)
 out=io.BytesIO()
 if i in [0,1,3,4]:im.save(out,format='JPEG',quality=95,subsampling=0,optimize=True);mime='image/jpeg'
 else:im.save(out,format='PNG',optimize=True);mime='image/png'
 images.append({'bufferView':view(out.getvalue()),'mimeType':mime,'name':'SamuraiTexture'+str(i)})
result={'asset':{'version':'2.0','generator':'ZAN neutral-pose landmark rig'},'scene':0,'scenes':[{'nodes':[0]+meshNodes,'extras':{'intendedHeight':1.86,'character':'Thomas Walker Samurai Inspired Character'}}],'nodes':nodes,'meshes':meshes,'skins':[{'joints':list(range(len(landmarks))),'inverseBindMatrices':ibmidx,'skeleton':0}],'materials':g['materials'],'textures':g['textures'],'samplers':g.get('samplers',[]),'images':images,'accessors':access,'bufferViews':views,'buffers':[{'byteLength':len(binary)}]}
js=json.dumps(result,separators=(',',':')).encode();js+=b' '*((-len(js))%4);binary+=b'\0'*((-len(binary))%4)
Path(sys.argv[2]).write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary)
print('Rigged',len(landmarks),'bones,',sum(access[p['attributes']['POSITION']]['count'] for m in meshes for p in m['primitives']),'vertices;',len(binary),'bytes')
