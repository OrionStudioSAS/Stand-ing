import assert from 'node:assert/strict';
import test from 'node:test';
import { includedCounterPowerItems } from '../src/includedCounterPower.js';
import { electricalPictoPoint, normalizeBatElectricalPicto } from '../src/batElectricalPicto.js';

const catalog = [{ type: 'triplette', label: 'Triplette', modelUrl: '/triplette.obj', modelSize: [.23, .05, .13], dimensions: { category: 'Électricité' } }];
const base = { id: 'included', label: 'Comptoir accueil 1m', included: true, x: 1, z: 2, y: 0, modelSize: [1, 1, .5], rotation: 0 };

test('only step-2 base counters receive a derived, free countertop power strip', () => {
  const extra = { ...base, id: 'shop', included: false, priceMode: 'billable' };
  const items = [base, extra];
  const before = JSON.stringify(items);
  const result = includedCounterPowerItems(items, catalog);
  assert.equal(result.length, 1);
  assert.equal(result[0].surfaceHostId, base.id);
  assert.equal(result[0].y, 1.002);
  assert.equal(result[0].x, 1);
  assert.equal(result[0].z, 1.85);
  assert.equal(result[0].options.unitPrice, 0);
  assert.equal(result[0].collisionEnabled, false);
  assert.equal(JSON.stringify(items), before, 'No change to the saved scene or its shopping/pricing items');
  assert.equal(includedCounterPowerItems([...items, ...result], catalog).length, 0);
});

test('power strips follow counter rotations and all supported base flags, not shop quantities', () => {
  for (const flag of [{ priceMode: 'included' }, { price_mode: 'included' }, { basePresetId: 'base' }]) {
    const [power] = includedCounterPowerItems([{ ...base, included: false, ...flag, rotation: 90 }], catalog);
    assert.ok(Math.abs(power.x - .85) < 1e-10);
    assert.ok(Math.abs(power.z - 2) < 1e-10);
  }
  assert.equal(includedCounterPowerItems([{ ...base, options: { prestigeHidden: true } }], catalog).length, 0);
  assert.equal(includedCounterPowerItems([], catalog).length, 0);
  assert.equal(includedCounterPowerItems([base], []).length, 0);
});

test('electrical anchors can sit outside a TV without changing its center or dimensions', () => {
  const frame = { x: 100, y: 100, width: 200, height: 20, angle: 0 };
  const before = JSON.stringify(frame);
  const icon = normalizeBatElectricalPicto({ batElectricalPictoY: -.5 });
  assert.deepEqual(electricalPictoPoint(frame, icon), { x: 100, y: 80 });
  const rotated = electricalPictoPoint({ ...frame, angle: Math.PI / 2 }, icon);
  assert.equal(rotated.x, 120);
  assert.equal(rotated.y, 100);
  assert.equal(JSON.stringify(frame), before);
  assert.equal(normalizeBatElectricalPicto({ batElectricalPictoSize: .6 }).size, .2, 'Old object-relative sliders do not inflate the new symbol');
  assert.equal(normalizeBatElectricalPicto({ batElectricalPictoSizeMeters: .3 }).size, .3);
});
