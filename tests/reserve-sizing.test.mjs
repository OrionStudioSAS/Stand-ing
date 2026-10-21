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
    normalizePackLabel: label=>String(label).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),
    isSignaturePackLabel: (label) => label === 'Signature', reserveDoorColorForPack: () => '',
    assetUnitPrice: () => 0, findCatalogEntry: (entries, type) => entries.find((entry) => entry.type === type),
    makeItem: (_type, _width, _depth, _layout, entry) => structuredClone(entry), constrainItem: (item) => item,
  });
  for (const name of ['normalizeComplementaryOptions', 'configuredReserveAssetTypes', 'configuredReserveOptionType', 'reserveAreaFromText', 'isReserveCatalogEntry', 'reserveRuleWithPackChoices', 'firstPriceValue', 'reserveOptionPrice', 'makeAutomaticReserveItems']) {
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

test('Equipped offers both linked 2m² and 3m² groups regardless of the active area band',()=>{
 const api=runtime(), rules={medium:{id:'medium',includedType:groups[1].type,options:[]},large:{id:'large',includedType:groups[2].type,options:[]}};
 for(const band of ['medium','large']){
  const choices=api.reserveRuleWithPackChoices(rules[band],rules,groups,'Équipé');
  assert.equal(choices.options.length,1);const alternative=choices.options[0];
  assert.equal(alternative.type,band==='large'?groups[1].type:groups[2].type);
  const selected=api.configuredReserveOptionType(choices,alternative.type);
  assert.equal(selected,alternative.type);
  const [item]=api.makeAutomaticReserveItems(choices,selected,groups,5,5,'right','Équipé');
  assert.equal(item.type,alternative.type);assert.equal(JSON.stringify(item.children),JSON.stringify(groups.find(g=>g.type===alternative.type).children));
 }
});
test('Equipped preserves explicit supplements and uses catalog differences or allowance prices for newly linked choices',()=>{
 const api=runtime();api.assetUnitPrice=entry=>Number(entry?.price||0);
 const catalog=groups.map((entry,i)=>({...entry,price:(i+1)*100}));
 const rules={medium:{id:'medium',includedType:groups[1].type,options:[{type:groups[2].type,price:111,label:'Grande réserve'}]},large:{id:'large',includedType:groups[2].type,options:[]}};
 const medium=api.reserveRuleWithPackChoices(rules.medium,rules,catalog,'Équipé');assert.equal(medium.options[0].price,111);assert.equal(medium.options[0].label,'Grande réserve');
 assert.equal(api.reserveRuleWithPackChoices(rules.large,rules,catalog,'Équipé').options[0].price,0,'Choosing a smaller reserve does not create a supplement');
 assert.equal(api.reserveRuleWithPackChoices({...rules.medium,options:[]},rules,catalog,'Équipé').options[0].price,100);
 assert.equal(api.reserveRuleWithPackChoices({...rules.large,chargeIncluded:true},rules,catalog,'Équipé').options[0].price,200,'Allowance orders retain the complete catalog price');
});
