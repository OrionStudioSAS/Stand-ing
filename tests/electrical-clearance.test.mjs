import assert from 'node:assert/strict';
import test from 'node:test';
import { electricalWallClearance, applyElectricalClearance } from '../src/electricalClearance.js';

test('only meter covers and the reserve 3-shelf units need the 25mm electrical clearance', () => {
  for(const label of ['Cache Compteur Blanc 500x500x750ht','Cache Compteur Noir','Bloc 3 Étagères']) assert.equal(electricalWallClearance({label}),.025);
  for(const label of ['TV 55','Tête de cloison Signature','Triplette','Réserve 2m²','Chaise']) assert.equal(electricalWallClearance({label}),0);
});

test('meter covers keep 25mm from actual inner wall faces, without adding a margin on open edges', () => {
  for(const layout of ['back','left','right','u']){
    const cover={id:'cover',label:'Cache compteur',x:-2,z:-1.5,dimensions:{size:[.53,.75,.5]}};
    const before=JSON.stringify(cover),[placed]=applyElectricalClearance([cover],4,3,layout);
    assert.ok(Math.abs(placed.z-.25-(-1.5+.06)-.025)<1e-9);
    assert.ok(Math.abs(placed.x-.265-(-2)-(layout==='left'||layout==='u'?.085:0))<1e-9);
    assert.equal(JSON.stringify(cover),before);
  }
});

test('reserve shelf clearance changes only the inner object, leaving the hand-built walls and door unchanged', () => {
  const shelf={id:'shelf',label:'Bloc 3 Étagères',x:.524,z:-.025,rotation:90,dimensions:{size:[.95,1.8,.33]}};
  const wall={id:'wall',label:'Cloison 1x2.5m',x:.2,z:.5,dimensions:{size:[1,2.5,.06]}};
  const door={id:'door',label:'Porte',x:-.36,z:-.03,rotation:90,dimensions:{size:[1,2.5,.24],depthLocked6cm:true,wallCoverFrameBounds:{minX:-.5,maxX:.5,minZ:.058895,maxZ:.118895}}};
  const group={id:'reserve',label:'Réserve',isGroup:true,x:2.24,z:-.91,children:[shelf,wall,door]};
  const before=JSON.stringify(group),[placed]=applyElectricalClearance([group],6,3,'right');
  assert.equal(placed.x,group.x);assert.equal(placed.z,group.z);
  assert.equal(placed.children[1],wall);assert.equal(placed.children[2],door);
  const inner=placed.children[0];
  assert.ok(Math.abs(inner.x-.51)<1e-9);
  assert.ok(Math.abs(inner.z+.03)<1e-9);
  assert.equal(JSON.stringify(group),before);
  assert.deepEqual(applyElectricalClearance([placed],6,3,'right'),[placed],'Repeated reconstruction never drifts the layout');
});
