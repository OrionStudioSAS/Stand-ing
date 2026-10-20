import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
export function reserveCoverRuntime() {
 const api=vm.createContext({wallThickness:.06,fixedWallHeight:2.5,wallCoverSurfaceOffset:.008,reserveWallCoverEdgeInset:.02,minWallCoverDisplayWidth:.7,
  isCeilingMountedItem:()=>false,itemPlacementBoundsOverride:()=>null,itemDefaultSize:item=>item.dimensions.size,
  isWallItem:()=>false,isReserveSceneItem:()=>true,objectWallSurfaces:()=>[],wallCoverPartitionHeadBlocker:()=>null,
  availableWalls:layout=>['back',...(layout==='u'?['left','right']:[])].map(id=>({id})),
  roundM2:value=>Math.round(value*100)/100,clamp:(value,min,max)=>Math.min(max,Math.max(min,value)),
 });
 for(const name of ['rotatePoint','itemGroupBounds','childrenBounds','itemPlacementBounds','itemHardCollisionBox','sideWallLength','sideWallStartZ','sideWallEndZ','sideWallCenterZ','wallAxisLimits','reserveWallBlocker','normalizeWallCoverDeductionLength','wallCoverReserveDisplayBlocker','wallCoverDisplayBlockers','freeWallIntervals','wallCoverDisplayIntervals','wallCoverSegmentFromInterval','wallCoverSegmentId','wallCoverSegmentLabel','wallCoverSegmentSuffix','wallCoverDisplaySegments','wallCoverSurfaceOptions']) {
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
  const boundary=api.itemHardCollisionBox(group,0);
  const cover=api.wallCoverSurfaceOptions('back',5,4,[group],{splitForCovers:true}).find(s=>s.wall==='back');
  const edge=cover.position[0]+(rotation===0?-1:1)*cover.width/2;
  assert.ok(Math.abs(edge-(rotation===0?boundary.maxX:boundary.minX))<1e-8,`${fixture.label} rotation ${rotation}: cover edge ${edge}, door wall ${rotation===0?boundary.maxX:boundary.minX}`);
  assert.equal(cover.visibleWidth,fixture.label.includes('1m²')?4:3,'Measured metres keep the configured reserve width');
 }
});
