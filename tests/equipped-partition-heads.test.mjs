import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const context = vm.createContext({
  isSignatureScene: (scene) => scene.offer === 'Signature',
  scenePackBenefits: () => ({ mode: 'included' }),
  normalizePackLabel: (label) => String(label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
  sceneOfferLabel: (scene) => scene.offer,
});
const start = source.indexOf('const partitionHeadRuleBands = [');
vm.runInContext(source.slice(start, source.indexOf('const placementRuleOptions = [', start)), context);
for (const name of [
  'scenePartitionHeadRules', 'normalizePartitionHeadRules', 'normalizePartitionHeadIncludedSides',
  'activePartitionHeadRule', 'partitionHeadRuleIncludedSides', 'defaultIncludedPartitionHeadSides',
  'partitionHeadSelectedSides', 'partitionHeadBillableSides',
]) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), context);
}

test('Equipe exposes the requested four bands, preserving legacy large-band object and price settings', () => {
  const rules = context.scenePartitionHeadRules({ offer: 'Équipé', source_payload: { partitionHeadRules: {
    large: { leftType: 'siae-left', rightType: 'siae-right', leftPrice: 200, rightPrice: 250 },
  } } });
  assert.equal(Object.keys(rules).length, 4);
  assert.equal(rules.large.bandLabel, '25 à 30 m²');
  assert.equal(rules.extraLarge.bandLabel, '31 m² et plus');
  assert.equal(rules.extraLarge.leftType, 'siae-left');
  assert.equal(rules.extraLarge.rightType, 'siae-right');
  assert.equal(rules.extraLarge.leftPrice, 200);
  assert.equal(rules.extraLarge.rightPrice, 250);
  for (const [area, count, band] of [
    [11.9999, 0, 'small'], [12, 1, 'medium'], [24, 1, 'medium'], [24.9999, 1, 'medium'],
    [25, 2, 'large'], [30, 2, 'large'], [30.9999, 2, 'large'], [31, 2, 'extraLarge'], [60, 2, 'extraLarge'],
  ]) {
    const active = context.activePartitionHeadRule(rules, area, 'right');
    assert.equal(active.id, band, String(area));
    assert.equal(active.includedCount, count, String(area));
    assert.equal(active.includedSides.length, count, String(area));
  }
});

test('Equipe keeps each band independently editable and does not bill its two included heads', () => {
  const rules = context.normalizePartitionHeadRules({
    large: { rightPrice: 100 }, extraLarge: { rightPrice: 150 },
  }, { isEquippedPack: true });
  const normalizedAgain = context.normalizePartitionHeadRules(rules);
  assert.equal(normalizedAgain.large.rightPrice, 100);
  assert.equal(normalizedAgain.extraLarge.rightPrice, 150);
  for (const area of [25, 30, 31, 50]) {
    const active = context.activePartitionHeadRule(normalizedAgain, area);
    assert.equal(context.partitionHeadBillableSides(active, { left: true, right: true }).size, 0);
  }
  const active = context.activePartitionHeadRule(rules, 24, 'right');
  assert.deepEqual(Array.from(active.includedSides), ['right']);
  assert.deepEqual(Array.from(context.partitionHeadBillableSides(active, { left: true, right: true })), ['left']);
});

test('Other packs retain their existing bands and Signature still includes two heads everywhere', () => {
  for (const offer of ['Confort', 'Prestige']) {
    const rules = context.scenePartitionHeadRules({ offer });
    assert.equal(Object.keys(rules).length, 3);
    assert.equal(context.activePartitionHeadRule(rules, 31).id, 'large');
    assert.equal(rules.large.bandLabel, '25 m² et plus');
  }
  const signature = context.scenePartitionHeadRules({ offer: 'Signature' });
  assert.equal(Object.keys(signature).length, 3);
  assert.equal(context.activePartitionHeadRule(signature, 9).includedCount, 2);
});
