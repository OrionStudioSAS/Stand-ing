import { isSiaePackLabel, siaeReserveRuleBands } from '../src/siaeStandOptions.js';
import { electricalWallClearance, electricalClearanceRect, applyElectricalClearance } from '../src/electricalClearance.js';
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
  const api = vm.createContext({ isSiaePackLabel, siaeReserveRuleBands, electricalWallClearance, electricalClearanceRect, applyElectricalClearance,
    normalizePackLabel: label=>String(label).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),
    isSignaturePackLabel: (label) => label === 'Signature', reserveDoorColorForPack: () => '',
    assetUnitPrice: () => 0, findCatalogEntry: (entries, type) => entries.find((entry) => entry.type === type),
    makeItem: (_type, _width, _depth, _layout, entry) => structuredClone(entry), constrainItem: (item) => item,
  });
  for (const name of ['normalizeReserveRules', 'activeReserveRule', 'normalizeComplementaryOptions', 'configuredReserveAssetTypes', 'configuredReserveOptionType', 'reserveAreaFromText', 'isReserveCatalogEntry', 'reserveRuleWithPackChoices', 'firstPriceValue', 'reserveOptionPrice', 'makeAutomaticReserveItems']) {
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

test('Signature offers only existing reserves referenced in other pack bands, charging 222 per extra square metre', () => {
  const api = runtime();
  const rules = Object.fromEntries(groups.slice(0, 3).map((group, index) => [`signature-${index + 1}m2`, { id: `signature-${index + 1}m2`, includedType: group.type, includedLabel: group.label, options: [] }]));
  const before = JSON.stringify({ rules, groups });
  for (const baseArea of [1, 2, 3]) {
    const baseRule = rules[`signature-${baseArea}m2`];
    const choices = api.reserveRuleWithPackChoices(baseRule, rules, groups, 'Signature');
    assert.equal(choices.includedType, groups[baseArea - 1].type);
    assert.equal(choices.options.length, 2);
    for (const option of choices.options) {
      const expected = groups.find((entry) => entry.type === option.type);
      const expectedArea = api.reserveAreaFromText(expected.label);
      assert.equal(option.price, Math.max(0, expectedArea - baseArea) * 222);
      const [item] = api.makeAutomaticReserveItems(choices, option.type, groups, 8, 4, 'left', 'Signature');
      assert.equal(item.type, expected.type);
      assert.equal(item.options.unitPrice, option.price);
      assert.equal(JSON.stringify(item.children), JSON.stringify(expected.children));
    }
    assert.equal(choices.options.some((option) => option.type === groups[3].type), false);
    assert.equal(api.reserveRuleWithPackChoices(baseRule, rules, groups, 'Équipé').options.length, 2);
    assert.equal(api.reserveRuleWithPackChoices(baseRule, rules, groups, 'Confort'), baseRule);
  }
  const noReserve = { id: 'signature-none', includedType: '', options: [] };
  assert.equal(api.reserveRuleWithPackChoices(noReserve, rules, groups, 'Signature'), noReserve);
  assert.equal(JSON.stringify({ rules, groups }), before);
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

test('SIAE corrects previously configured defaults and retains actual groups across all surface bands', () => {
  const api = runtime();
  const catalog = groups.map((entry, index) => ({
    ...entry, dimensions: { packs: [index === 3 ? 'Confort' : 'SIAE'] },
  }));
  const bands = siaeReserveRuleBands;
  const rules = api.normalizeReserveRules({ medium: { includedType: groups[1].type }, large: { includedType: groups[2].type } }, { bands });
  for (const [area, size] of [[11.9999, 0], [12, 1], [24, 1], [24.9999, 1], [25, 2], [30, 2], [30.9999, 2], [31, 3]]) {
    const rule = api.reserveRuleWithPackChoices(api.activeReserveRule(rules, area, bands), rules, catalog, 'Équipé');
    assert.equal(rule.includedType, size ? groups[size - 1].type : '', `Default reserve at ${area} m²`);
    assert.equal(rule.options.some(option => option.type === groups[3].type), false, 'No group from another pack');
    if (size) {
      const [item] = api.makeAutomaticReserveItems(rule, '', catalog, 5, 5, 'right', 'Équipé');
      assert.equal(item.type, groups[size - 1].type);
      assert.equal(JSON.stringify(item.children), JSON.stringify(groups[size - 1].children));
    }
  }
});

test('SIAE preserves explicit supplements and uses catalog differences for other reserve choices', () => {
  const api = runtime();
  api.assetUnitPrice = entry => Number(entry?.price || 0);
  const catalog = groups.map((entry, index) => ({ ...entry, price: (index + 1) * 100, dimensions: { packs: ['Équipé'] } }));
  const rules = {
    medium: { id: 'medium', includedType: groups[1].type, options: [{ type: groups[2].type, price: 111, label: 'Grande réserve' }] },
    large: { id: 'large', includedType: groups[2].type, options: [] },
  };
  const medium = api.reserveRuleWithPackChoices(rules.medium, rules, catalog, 'SIAE');
  assert.equal(medium.options.find(option => option.type === groups[2].type).price, 111);
  assert.equal(medium.options.find(option => option.type === groups[1].type).price, 100);
  const large = api.reserveRuleWithPackChoices(rules.large, rules, catalog, 'Équipé');
  assert.equal(large.options.find(option => option.type === groups[0].type).price, 0);
});
