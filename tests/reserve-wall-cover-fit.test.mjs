import { Box3, Vector3, Matrix4 } from 'three';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
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
test('back-wall covers meet the 6 cm door wall of both 1m² and 2m² reserves, without changing commercial metres',()=>{
 const api=reserveCoverRuntime();
 for(const fixture of reserveCoverFixtures) for(const rotation of [0,180]) {
  const group={...fixture,id:'reserve',isGroup:true,rotation};const local=api.itemPlacementBounds(group);
  group.x=rotation===0?-2.5-local.minX:2.5-local.maxX;group.z=-2+.06-local.minZ;
  const boundary=api.reserveWallCoverBounds(group);
  const cover=api.wallCoverSurfaceOptions('back',5,4,[group],{splitForCovers:true}).find(s=>s.wall==='back');
  const edge=cover.position[0]+(rotation===0?-1:1)*cover.width/2;
  assert.ok(Math.abs(edge-(rotation===0?boundary.maxX:boundary.minX))<1e-8,`${fixture.label} rotation ${rotation}: cover edge ${edge}, door wall ${rotation===0?boundary.maxX:boundary.minX}`);
  assert.equal(cover.visibleWidth,fixture.label.includes('1m²')?4:3,'Measured metres keep the configured reserve width');
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
 assert.equal(cover.visibleWidth,oldMeasured,'Commercial metres remain unchanged');
});
