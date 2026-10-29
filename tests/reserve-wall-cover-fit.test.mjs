import { Box3, Vector3, Matrix4 } from 'three';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { outsideDoorReserve } from './helpers/reserve-outside-door.mjs';
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
export function reserveCoverRuntime() {
 const api=vm.createContext({wallThickness:.06,fixedWallHeight:2.5,wallCoverSurfaceOffset:.008,reserveWallCoverEdgeInset:.02,minWallCoverDisplayWidth:.7,
  Layers:null,effectivePlacementRule:asset=>asset.dimensions.placementRule,isCeilingMountedItem:()=>false,itemPlacementBoundsOverride:()=>null,itemDefaultSize:item=>item.dimensions.size,
  isWallItem:()=>false,isReserveSceneItem:()=>true,objectWallSurfaces:()=>[],wallCoverPartitionHeadBlocker:()=>null,
  availableWalls:layout=>['back',...(layout==='u'?['left','right']:layout==='right'?['right']:layout==='left'?['left']:[])].map(id=>({id})),
  roundM2:value=>Math.round(value*100)/100,clamp:(value,min,max)=>Math.min(max,Math.max(min,value)),
 });
 for(const name of ['inheritGroupChildDepth','assetToCatalogEntry','reserveWallCoverBounds','rotatePoint','itemGroupBounds','childrenBounds','itemPlacementBounds','itemHardCollisionBox','sideWallLength','sideWallStartZ','sideWallEndZ','sideWallCenterZ','wallAxisLimits','reserveWallBlocker','normalizeWallCoverDeductionLength','wallCoverReserveDisplayBlocker','wallCoverDisplayBlockers','freeWallIntervals','wallCoverDisplayIntervals','wallCoverSegmentFromInterval','wallCoverSegmentId','wallCoverSegmentLabel','wallCoverSegmentSuffix','wallCoverDisplaySegments','wallCoverSurfaceOptions']) {
  const start=source.indexOf(`function ${name}(`);assert.ok(start>=0,name);vm.runInContext(source.slice(start,source.indexOf('\n}\n',start)+2),api);
 }
 return api;
}
export const reserveCoverFixtures = [
 {label:'Réserve 1m²',children:[{id:'front',x:-.5,z:0,rotation:180,dimensions:{size:[1,2.5,.06]}},{id:'door',x:.05,z:-.49,rotation:-90,dimensions:{size:[1,2.5,.25],depthLocked6cm:true}}]},
 {label:'Réserve 2m²',children:[{id:'front1',x:.35,z:0,dimensions:{size:[1,2.5,.06]}},{id:'door',x:.92,z:-.49,rotation:-90,dimensions:{size:[1,2.5,.25],depthLocked6cm:true}},{id:'front2',x:-.59,z:0,dimensions:{size:[1,2.5,.06]}}]},
];

test('outside-door reserves retain 6 or 12 cm wall thickness in all pack banner dimensions',()=>{
 const api=reserveCoverRuntime();
 for(const length of [1,2,3])for(const wallCount of [1,2])for(const rotation of [0,180])for(const side of ['left','right']){
  const group={...outsideDoorReserve(length,wallCount),rotation};
  const before=JSON.stringify(group.children);
  const bounds=api.reserveWallCoverBounds(group), reserveDepth=1+wallCount*.06;
  assert.ok(Math.abs(bounds.maxZ-bounds.minZ-reserveDepth)<1e-9);
  group.x=side==='right'?3-.06-bounds.maxX:-3+.06-bounds.minX;
  group.z=api.sideWallStartZ(3.5)-bounds.minZ;
  const surface=api.wallCoverSurfaceOptions(side,6,3.5,[group],{splitForCovers:true}).find(s=>s.wall===side);
  const expected=wallCount===1?2.44:2.38;
  assert.equal(surface.visibleWidth,expected);
  assert.ok(Math.abs(surface.width-expected)<1e-9);
  assert.equal(JSON.stringify(group.children),before,'Measuring a banner never reconfigures the manually assembled reserve');
 }
 for(const length of [1.06,1.12,2.06,2.12,3.06,3.12,2.44])assert.equal(api.normalizeWallCoverDeductionLength(length),length,'Never snap physical centimetres to nominal metres');
});
test('back-wall covers meet the 6 cm door wall and report the same physical length they render',()=>{
 const api=reserveCoverRuntime();
 for(const fixture of reserveCoverFixtures) for(const rotation of [0,180]) {
  const group={...fixture,id:'reserve',isGroup:true,rotation};const local=api.itemPlacementBounds(group);
  group.x=rotation===0?-2.5-local.minX:2.5-local.maxX;group.z=-2+.06-local.minZ;
  const boundary=api.reserveWallCoverBounds(group);
  const cover=api.wallCoverSurfaceOptions('back',5,4,[group],{splitForCovers:true}).find(s=>s.wall==='back');
  const edge=cover.position[0]+(rotation===0?-1:1)*cover.width/2;
  assert.ok(Math.abs(edge-(rotation===0?boundary.maxX:boundary.minX))<1e-8,`${fixture.label} rotation ${rotation}: cover edge ${edge}, door wall ${rotation===0?boundary.maxX:boundary.minX}`);
  assert.equal(cover.visibleWidth,Math.round(cover.width*100)/100,'Reported metres use the actual free wall');
 }
});

test('Signature L-right banners meet the rendered 2m² rear-right door frame, not its open leaf',()=>{
 const api=reserveCoverRuntime();
 const assets=JSON.parse(readFileSync(new URL('./fixtures/signature-reserve-back-right.json',import.meta.url),'utf8'));
 const asset=assets.find(a=>a.dimensions.isGroup);
 const entry=api.assetToCatalogEntry(asset,assets);
 const door=entry.children.find(child=>child.label.startsWith('Porte'));
 assert.equal(door.dimensions.depthLocked6cm,true,'Old group snapshots inherit the source door setting');
 const group={...entry,id:'auto-reserve',rotation:0};const bounds=api.itemPlacementBounds(group);
 group.x=3-.06-bounds.maxX;group.z=-1.5+.06-bounds.minZ;
 // Independent Three.js matrix: this is the fixed rear 6cm frame, after centering the GLB.
 const frame=new Box3(new Vector3(-.5,0,-.125),new Vector3(.5,2.5,-.065));
 const matrix=new Matrix4().makeRotationY(door.rotation*Math.PI/180);
 matrix.setPosition(group.x+door.x,0,group.z+door.z);frame.applyMatrix4(matrix);
 const surfaces=api.wallCoverSurfaceOptions('right',6,3,[group],{splitForCovers:true});
 const cover=surfaces.find(surface=>surface.wall==='back');
 const edge=cover.position[0]+cover.width/2;
 assert.ok(Math.abs(edge-frame.min.x)<1e-9,`Banner ${edge}, rendered frame ${frame.min.x}`);
 assert.ok(frame.min.x-api.itemHardCollisionBox(group,0).minX>.18,'The old placement bound lies across the open door');
 const oldGroup={...group,children:asset.dimensions.children};
 const oldMeasured=api.wallCoverSurfaceOptions('right',6,3,[oldGroup],{splitForCovers:true}).find(surface=>surface.wall==='back').visibleWidth;
 assert.equal(cover.visibleWidth,Math.round(cover.width*100)/100);
 assert.ok(cover.visibleWidth>oldMeasured,'The fixed frame frees the corresponding printable wall length');
});

test('1m² rear-right cover uses the front-side fixed frame of the actual opposite-handle door',()=>{
 const api=reserveCoverRuntime();
 const assets=JSON.parse(readFileSync(new URL('./fixtures/signature-reserve-1m-back-right.json',import.meta.url),'utf8'));
 const entry=api.assetToCatalogEntry(assets.find(a=>a.dimensions.isGroup),assets);
 const door=entry.children.find(child=>child.label.startsWith('Porte'));
 assert.equal(door.dimensions.depthLocked6cm,true);
 const group={...entry,id:'auto-reserve',rotation:0};const bounds=api.itemPlacementBounds(group);
 group.x=3-.06-bounds.maxX;group.z=-1.5+.06-bounds.minZ;
 const frame=new Box3(new Vector3(-.5,0,.058895),new Vector3(.5,2.5,.118895));
 const matrix=new Matrix4().makeRotationY(door.rotation*Math.PI/180);matrix.setPosition(group.x+door.x,0,group.z+door.z);frame.applyMatrix4(matrix);
 const cover=api.wallCoverSurfaceOptions('right',6,3,[group],{splitForCovers:true}).find(surface=>surface.wall==='back');
 assert.ok(Math.abs(cover.position[0]+cover.width/2-frame.min.x)<1e-9);
 const oldGroup={...group,children:entry.children.map(c=>({...c,dimensions:{...c.dimensions,wallCoverFrameBounds:undefined}}))};
 const oldCover=api.wallCoverSurfaceOptions('right',6,3,[oldGroup],{splitForCovers:true}).find(surface=>surface.wall==='back');
 assert.equal(cover.visibleWidth,Math.round(cover.width*100)/100);
 assert.ok(cover.visibleWidth>oldCover.visibleWidth);
 assert.ok((cover.position[0]+cover.width/2)-(oldCover.position[0]+oldCover.width/2)>.17,'The fixed-frame correction removes the overlap at the opening');
 const raw={...door,dimensions:{...door.dimensions,depthLocked6cm:false}};
 assert.deepEqual(JSON.parse(JSON.stringify(api.reserveWallCoverBounds(raw))),JSON.parse(JSON.stringify(api.reserveWallCoverBounds({...raw,dimensions:{...raw.dimensions,wallCoverFrameBounds:undefined}}))),'Explicitly disabling the 6cm option retains the original bounds');
});

test('1m² rear-left covers also respect the front-side fixed frame of the legacy door export',()=>{
 const api=reserveCoverRuntime();
 const door={id:'door',x:.05,z:-.49,rotation:-90,dimensions:{size:[1,2.5,.25],depthLocked6cm:true,wallCoverFrameBounds:{minX:-.499300,maxX:.500300,minZ:.061411,maxZ:.121388}}};
 const group={id:'reserve',isGroup:true,rotation:0,children:[{id:'front',x:-.5,z:0,rotation:180,dimensions:{size:[1,2.5,.06]}},door]};
 const placement=api.itemPlacementBounds(group);group.x=-3+.06-placement.minX;group.z=-1.5+.06-placement.minZ;
 const frame=new Box3(new Vector3(-.499300,0,.061411),new Vector3(.500300,2.5,.121388));const matrix=new Matrix4().makeRotationY(-Math.PI/2);matrix.setPosition(group.x+door.x,0,group.z+door.z);frame.applyMatrix4(matrix);
 const cover=api.wallCoverSurfaceOptions('left',6,3,[group],{splitForCovers:true}).find(surface=>surface.wall==='back');
 const edge=cover.position[0]-cover.width/2;
 assert.ok(edge>=frame.max.x && edge-frame.max.x<.02,'The left banner starts at the partition/frame joint and stays out of the opening');
});

test('All catalog reserve door frames follow Three.js in every rotation, across nine groups and four layouts',()=>{
 const api=reserveCoverRuntime();
 const {doors,groups}=JSON.parse(readFileSync(new URL('./fixtures/signature-reserve-door-audit.json',import.meta.url),'utf8'));
 for(const door of doors)for(const rotation of [0,90,180,-90]){
  const f=door.dimensions.wallCoverFrameBounds;
  const expected=new Box3(new Vector3(f.minX,0,f.minZ),new Vector3(f.maxX,2.5,f.maxZ)).applyMatrix4(new Matrix4().makeRotationY(rotation*Math.PI/180));
  const actual=api.reserveWallCoverBounds({...door,rotation});
  for(const [key,value]of Object.entries({minX:expected.min.x,maxX:expected.max.x,minZ:expected.min.z,maxZ:expected.max.z}))assert.ok(Math.abs(actual[key]-value)<1e-9,`${door.label} rotation ${rotation} ${key}`);
 }
 const renderedGroupBounds=(group)=>{
  const union=new Box3();
  for(const child of group.children){
   const [w,h,d]=child.dimensions.size;
   const frame=child.dimensions.depthLocked6cm&&child.dimensions.wallCoverFrameBounds;
   const box=frame?new Box3(new Vector3(frame.minX,0,frame.minZ),new Vector3(frame.maxX,h,frame.maxZ)):new Box3(new Vector3(-w/2,0,-d/2),new Vector3(w/2,h,d/2));
   const matrix=new Matrix4().makeRotationY(Number(child.rotation||0)*Math.PI/180);matrix.setPosition(group.x+Number(child.x||0),0,group.z+Number(child.z||0));box.applyMatrix4(matrix);union.union(box);
  }return union;
 };
 for(const asset of groups)for(const layout of ['back','left','right','u']){
  const entry=api.assetToCatalogEntry(asset,[...doors,...groups]), group={...entry,id:'auto-reserve',rotation:0};const placement=api.itemPlacementBounds(group),side=asset.dimensions.placementRule?.id;
  group.x=side==='back-left'?-4+.06-placement.minX:side==='back-right'?4-.06-placement.maxX:0;group.z=-3+.06-placement.minZ;
  const expected=renderedGroupBounds(group),actual=api.reserveWallCoverBounds(group);
  for(const [key,value]of Object.entries({minX:expected.min.x,maxX:expected.max.x,minZ:expected.min.z,maxZ:expected.max.z}))assert.ok(Math.abs(actual[key]-value)<1e-9,`${asset.label} / ${layout}: ${key}`);
  const covers=api.wallCoverSurfaceOptions(layout,8,6,[group],{splitForCovers:true});
  for(const cover of covers.filter(c=>c.kind==='wall')){
   const axis=cover.wall==='back'?0:2,center=cover.position[axis],min=center-cover.width/2,max=center+cover.width/2;
   const intersectsWall=cover.wall==='back'||(cover.wall==='left'?expected.min.x<=-4+.9:expected.max.x>=4-.9);
   const blockedMin=cover.wall==='back'?expected.min.x:expected.min.z,blockedMax=cover.wall==='back'?expected.max.x:expected.max.z;
   if(intersectsWall)assert.ok(Math.min(max,blockedMax)-Math.max(min,blockedMin)<1e-8,`${asset.label} / ${layout} / ${cover.wall}: banner crosses the reserve`);
   assert.equal(cover.visibleWidth,Math.round(cover.width*100)/100,`${asset.label} / ${layout}: physical and displayed metres agree`);
  }
 }
});
