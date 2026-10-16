import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const groups = [1, 2, 3, 4].map((area) => ({ type: `group-reserve-${area}m2`, label: `Réserve ${area} m²`, isGroup: true,
  children: [{ id: `custom-door-${area}`, type: 'door', x: 0.13 * area, z: -0.47, rotation: -90, dimensions: { depthLocked6cm: false } },
    { id: `custom-wall-${area}`, type: 'wall', x: -0.62, z: 0.03, rotation: 180 },
    { id: `custom-shelf-${area}`, type: 'shelf', x: -0.21, y: 0.2, z: -0.32 }],
  groupSize: [area, 2.5, 1], dimensions: {} }));
const rule = { id: 'medium', includedType: groups[1].type, includedLabel: groups[1].label,
  options: [{ type: groups[0].type, label: groups[0].label, price: 0 }, { type: groups[2].type, label: groups[2].label, price: 222 }] };
function runtime() {
  const api = vm.createContext({
    isSignaturePackLabel: (label) => label === 'Signature', reserveDoorColorForPack: () => '',
    assetUnitPrice: () => 0, findCatalogEntry: (entries, type) => entries.find((entry) => entry.type === type),
    makeItem: (_type, _width, _depth, _layout, entry) => structuredClone(entry), constrainItem: (item) => item,
  });
  for (const name of ['normalizeComplementaryOptions', 'configuredReserveAssetTypes', 'configuredReserveOptionType', 'firstPriceValue', 'reserveOptionPrice', 'makeAutomaticReserveItems']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
  }
  return api;
}

test('only manual groups explicitly referenced by pack rules are requested, never generated or unconfigured reserves', () => {
  const api = runtime();
  const before = JSON.stringify(rule);
  assert.deepEqual(Array.from(api.configuredReserveAssetTypes({ medium: rule })), [groups[1].type, groups[0].type, groups[2].type]);
  assert.deepEqual(Array.from(api.configuredReserveAssetTypes({ medium: { upgradeType: groups[2].type } })), [groups[2].type]);
  assert.equal(api.configuredReserveAssetTypes({ medium: { ...rule, options: [] } }).size, 1);
  assert.equal(api.configuredReserveAssetTypes({ medium: { includedType: 'reserve-sized-left-2m2' } }).size, 0);
  assert.equal(JSON.stringify(rule), before);
});

test('manual reserve composition, door offsets, accessories and configured supplements are identical across packs', () => {
  const api = runtime();
  const before = JSON.stringify(groups);
  for (const pack of ['Signature', 'Équipé', 'Confort']) {
    for (const [choice, expected, price] of [['', groups[1], 0], [groups[0].type, groups[0], 0], [groups[2].type, groups[2], 222]]) {
      const selected = api.configuredReserveOptionType(rule, choice);
      const [item] = api.makeAutomaticReserveItems(rule, selected, groups, 8, 4, 'left', pack);
      assert.equal(item.type, expected.type);
      assert.equal(item.options.unitPrice, price);
      assert.equal(JSON.stringify(item.children), JSON.stringify(expected.children));
      assert.equal(JSON.stringify(item.groupSize), JSON.stringify(expected.groupSize));
    }
  }
  assert.equal(JSON.stringify(groups), before);
});

test('empty options stay empty; old automatic choices fall back to the configured default without changing a group', () => {
  const api = runtime();
  const onlyDefault = { ...rule, options: [] };
  assert.equal(api.configuredReserveOptionType(rule, 'reserve-sized-left-3m2'), '');
  assert.equal(api.configuredReserveOptionType(rule, groups[3].type), '');
  assert.equal(api.configuredReserveOptionType(rule, '__legacy__'), groups[0].type);
  assert.equal(api.configuredReserveOptionType(onlyDefault, '__legacy__'), '');
  assert.equal(api.configuredReserveOptionType(rule, '__none__'), '__none__');
  const [item] = api.makeAutomaticReserveItems(onlyDefault, '', groups, 8, 4, 'left', 'Signature');
  assert.equal(item.type, groups[1].type);
  assert.equal(api.makeAutomaticReserveItems(rule, '__none__', groups, 8, 4, 'left', 'Signature').length, 0);
  assert.equal(api.makeAutomaticReserveItems({}, '', groups, 8, 4, 'left', 'Signature').length, 0);
});
