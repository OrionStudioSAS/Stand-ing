import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveSizingCatalog, reserveSizingRule, reserveWallUnitPrice } from '../src/reserveSizing.js';

const assets = [
  { type: 'wall', label: 'Cloison 1x2.5m', model_url: '/wall.obj', dimensions: { size: [1, 2.5, 0.06] } },
  { type: 'door', label: 'Porte gauche', model_url: '/door.obj', dimensions: { size: [1, 2.5, 0.25] } },
];
const included = { type: 'included', label: 'Réserve 2m² arrière gauche', dimensions: {} };
const rule = { id: 'medium', includedType: 'included', includedLabel: included.label, options: [] };

test('only Signature and Equipe get reserve-only assemblies, with true 1m panels and unchanged source assets', () => {
  const original = JSON.stringify(assets);
  assert.equal(reserveWallUnitPrice, 111);
  for (const pack of ['Signature', 'Équipé']) {
    const entries = reserveSizingCatalog([included], assets, pack);
    assert.equal(entries.length, 25);
    for (const entry of entries.slice(1)) {
      assert.ok(entry.children.every((child) => child.modelUrl && child.modelSize[0] === 1));
      assert.equal(entry.children.filter((child) => child.type === 'door').length, 1);
      assert.equal(entry.children.find((child) => child.type === 'door').dimensions.depthLocked6cm, true);
      assert.equal(entry.dimensions.reserveSizingOnly, true);
      assert.equal(entry.dimensions.reserveAreaM2, entry.groupSize[0] > 1.1 ? Math.round(entry.groupSize[0]) : Math.round(entry.groupSize[2]));
    }
  }
  const entries = [included];
  assert.equal(reserveSizingCatalog(entries, assets, 'Confort'), entries);
  assert.equal(reserveSizingCatalog(entries, [], 'Signature'), entries);
  assert.equal(JSON.stringify(assets), original);
});

test('2 to 1m2 is free, 2 to 3/4/5m2 adds 2/4/6 walls at 111 EUR, never the whole reserve price', () => {
  for (const pack of ['Signature', 'Équipé']) {
    const entries = reserveSizingCatalog([included], assets, pack);
    const result = reserveSizingRule(rule, entries, pack, 'left', 8, 4);
    assert.deepEqual(result.options.map((option) => option.price), [0, 222, 444, 666]);
    assert.deepEqual(result.options.map((option) => option.type), ['reserve-sized-left-1m2', 'reserve-sized-left-3m2', 'reserve-sized-left-4m2', 'reserve-sized-left-5m2']);
    assert.equal(result.includedType, rule.includedType);
    assert.equal(rule.options.length, 0);
    assert.equal(reserveSizingRule(rule, entries, 'Confort'), rule);
    const emptyRule = { ...rule, includedType: '' };
    assert.equal(reserveSizingRule(emptyRule, entries, pack), emptyRule);
  }
});

test('central reserves extend in depth and impossible upgrades do not protrude outside the stand', () => {
  const entries = reserveSizingCatalog([included], assets, 'Signature');
  const result = reserveSizingRule(rule, entries, 'Signature', 'back', 4, 3.5);
  assert.deepEqual(result.options.map((option) => option.type), ['reserve-sized-back-1m2', 'reserve-sized-back-3m2']);
  const reserve = entries.find((entry) => entry.type === 'reserve-sized-back-3m2');
  assert.equal(reserve.children.filter((child) => child.type === 'wall').length, 6);
  assert.ok(reserve.children.filter((child) => child.type === 'wall').every((child) => Math.abs(child.x) === 0.5));
  assert.deepEqual(reserve.groupSize, [1.06, 2.5, 3.06]);
});
