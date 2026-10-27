import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { groupStructuralAsset, groupDragPosition, groupNudge, nextGroupRowPosition, groupPlacementBounds } from '../src/groupPlacement.js';

test('only reserve walls and doors use the meter step, not coat hooks or wall accessories', () => {
  for (const label of ['Cloison 1 m', 'Porte réserve poignée droite', 'Porte avec code', 'asset-porte-reserve-gauche']) assert.equal(groupStructuralAsset({label}), true, label);
  for (const label of ['Patère', 'Porte-manteau', 'Porte documents', 'Machine à café', 'Affiche Viscom cloison', 'Spots cloison', 'Tête de cloison']) assert.equal(groupStructuralAsset({label}), false, label);
});

test('meter dragging preserves grab offset and existing six-centimeter offsets without moving on click', () => {
  const origin={x:.56,z:-1.06},start={x:.85,z:-1.07};
  assert.deepEqual(groupDragPosition(origin,start,start,1),origin);
  assert.deepEqual(groupDragPosition(origin,start,{x:1.86,z:-.96},1),{x:1.56,z:-1.06});
  assert.deepEqual(groupDragPosition(origin,start,{x:-.17,z:-2.08},1),{x:-.44,z:-2.06});
  assert.deepEqual(groupDragPosition(origin,start,{x:.973,z:-1.057},.001),{x:.683,z:-1.047});
});

test('6 cm and millimeter nudges do not change the other axes, height, rotation or dimensions', () => {
  const row={x:.5,y:1.823,z:-.97,rotation:90,depthLocked6cm:true};
  const next={...row,...groupNudge(row,'x',.06),...groupNudge(row,'z',-.001)};
  assert.deepEqual(next,{...row,x:.56,z:-.971});
  let x={x:0};for(let i=0;i<100;i++)x={...x,...groupNudge(x,'x',.001)};
  assert.equal(x.x,.1);
});

test('new structural modules are adjacent along the actual rotated local axis', () => {
  assert.deepEqual(nextGroupRowPosition([{type:'wall',x:.56,z:-.97,rotation:90}],'wall',{label:'Cloison 1m'}),{x:.56,z:-1.97,rotation:90});
  assert.deepEqual(nextGroupRowPosition([{type:'wall',x:.56,z:-.97,rotation:0}],'wall',{label:'Cloison 1m'}),{x:1.56,z:-.97,rotation:0});
  assert.deepEqual(nextGroupRowPosition([{type:'coffee',x:0,y:.7,z:0,rotation:0}],'coffee',{label:'Machine à café'}),{x:.2,y:.7,z:0,rotation:0});
  assert.deepEqual(nextGroupRowPosition([{type:'wall',x:0,z:0,rotation:0}],'wall',{label:'Cloison',dimensions:{size:[.06,2.5,1]}}),{x:0,z:1,rotation:0});
});

test('camera framing accounts for rotation and remote objects', () => {
  const box=groupPlacementBounds([{x:10,z:-4,rotation:90,modelSize:[4,2.5,.06]}]);
  assert.equal(box.maxX,10.03);assert.equal(box.minZ,-6);
});

test('existing group rows and saved children retain millimeter precision and door collision metadata', () => {
  const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  const asset={type:'door',label:'Porte',model_url:'/door.glb',dimensions:{size:[1,2.5,.06],depthLocked6cm:true}};
  const api=vm.createContext({inheritGroupChildDepth:children=>children,assetToCatalogEntry:item=>item,assetPlacementMode:()=> 'floor',assetModelSize:item=>item.dimensions.size,defaultWallItemCenterY:()=>0});
  for(const name of ['assetToGroupRows','buildGroupChildren']){const start=source.indexOf(`function ${name}(`);vm.runInContext(source.slice(start,source.indexOf('\n}\n',start)+2),api);}
  const child={id:'door',type:'door',x:.561,y:.003,z:-.971,rotation:90,dimensions:{depthLocked6cm:true}};
  const rows=api.assetToGroupRows({dimensions:{children:[child]}},[asset]);
  const [saved]=api.buildGroupChildren(rows,[asset]);
  for(const key of ['x','y','z','rotation'])assert.equal(saved[key],child[key]);
  assert.equal(saved.dimensions.depthLocked6cm,true);
});
