import { BoxGeometry, Matrix4 } from 'three';

function geometry(boxes) {
  const positions=[],normals=[];
  for(const {size,position=[0,0,0],rotation=0} of boxes){const box=new BoxGeometry(...size).toNonIndexed();const matrix=new Matrix4().makeRotationY(rotation);matrix.setPosition(...position);box.applyMatrix4(matrix);positions.push(...box.attributes.position.array);normals.push(...box.attributes.normal.array);box.dispose();}
  return{positions,normals};
}
export function glb(boxes){
  const {positions,normals}=geometry(boxes),p=Buffer.from(new Float32Array(positions).buffer),n=Buffer.from(new Float32Array(normals).buffer),bin=Buffer.concat([p,n]);
  const min=[0,1,2].map(axis=>Math.min(...positions.filter((_,index)=>index%3===axis))),max=[0,1,2].map(axis=>Math.max(...positions.filter((_,index)=>index%3===axis)));
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,name:'Real fixture model'}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.7,.66,.57,1],metallicFactor:0,roughnessFactor:.8}}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:p.length},{buffer:0,byteOffset:p.length,byteLength:n.length}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min,max},{bufferView:1,componentType:5126,count:normals.length/3,type:'VEC3'}]};
  const text=Buffer.from(JSON.stringify(json)),jsonChunk=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+jsonChunk.length+8+bin.length,8);jh.writeUInt32LE(jsonChunk.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,jh,jsonChunk,bh,bin]);
}
