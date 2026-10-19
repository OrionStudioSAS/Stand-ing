import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');

function loadFunction(name, context) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), context);
}

function colorContext() {
  const context = vm.createContext({
    colorGroupMatchesPack: (group, pack) => group.dimensions?.packs?.includes(pack),
    counterOptionalColorPrice: 79,
    normalizePackLabel: (label) => String(label || '').toLowerCase(),
    assetMatchesPack: (asset, pack) => asset.dimensions?.packs?.includes(pack),
  });
  for (const name of [
    'slugForType', 'normalizeColorId', 'normalizeTextValue', 'moveArrayItem',
    'normalizeColorGroupOptions', 'colorGroupUsages', 'colorGroupAssets', 'colorOptionsForUsage',
    'colorGroupsFromOptions', 'isSignaturePackLabel', 'packColorPalette',
    'colorGroupEntryForOption', 'colorChoicesForConfigOption', 'defaultColorChoiceForConfigOption',
    'selectedColorChoiceForConfigOption', 'counterWoodFinish', 'counterWhiteFinish',
    'normalizeAssetConfigOptions', 'itemConfigColorOptions', 'colorConfigOptionUsesCounterPalette',
    'uniqueTextValues', 'variantOptionLinkedAssetTypes', 'variantPrimaryAssetTypes', 'counterColorOptionsForItem',
    'isHiddenCounterFinish', 'counterFinishOptions',
  ]) loadFunction(name, context);
  return context;
}

const group = {
  type: 'color-group-test', label: 'Moquette', is_active: true,
  dimensions: {
    isColorGroup: true, packs: ['Signature', 'Confort'], colorUsages: ['carpet', 'footprint', 'wallFabric', 'counter'],
    colorGroupPrice: 12, colorGroupReference: 'COLOR-REF',
    colorOptions: [
      { id: 'red', code: 'R1', name: 'Rouge', hex: '#bb2222', image: '/red.jpg', storagePath: 'red.jpg', batPictoUrl: '/red-bat.png' },
      { id: 'gray', code: 'G1', name: 'Gris', hex: '#cccccc', image: '/gray.jpg', isDefault: true, isFree: true },
      { id: 'blue', code: 'B1', name: 'Bleu', hex: '#2222bb', image: '/blue.jpg', isFree: true },
    ],
  },
};
const ids = (colors) => Array.from(colors, (color) => color.id);

test('Color group reordering preserves IDs, base/free flags, files and pack assignments', () => {
  const context = colorContext();
  let draft = structuredClone(group);
  context.setDraft = (update) => { draft = update(draft); };
  const start = source.indexOf('  const reorderColorGroupColor =');
  const end = source.indexOf('  const updateConfigOptionRow =', start);
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext("reorderColorGroupColor('blue', 'red')", context);
  assert.deepEqual(ids(draft.dimensions.colorOptions), ['blue', 'red', 'gray']);
  assert.equal(draft.dimensions.colorOptions[2].isDefault, true);
  assert.equal(draft.dimensions.colorOptions[0].isFree, true);
  assert.equal(draft.dimensions.colorOptions[1].storagePath, 'red.jpg');
  assert.equal(draft.dimensions.colorOptions[1].batPictoUrl, '/red-bat.png');
  assert.deepEqual(draft.dimensions.packs, group.dimensions.packs);
  const unchanged = draft;
  vm.runInContext("reorderColorGroupColor('blue', 'blue'); reorderColorGroupColor('missing', 'red')", context);
  assert.equal(draft, unchanged);
  assert.deepEqual(ids(group.dimensions.colorOptions), ['red', 'gray', 'blue']);
});

test('An explicitly linked counter palette supplies every configured color on Equipe despite its global pack assignments', () => {
  const context = colorContext();
  const palette = { ...group, dimensions: { ...group.dimensions, colorGroupPrice: 79,
    colorOptions: [{ id: 'white', name: 'Blanc craie', image: '/white.jpg' }, { id: 'wood', name: 'Chêne Nebraska', image: '/wood.jpg' }, ...group.dimensions.colorOptions] } };
  const option = { id: 'finish', label: 'Couleurs', type: 'color', colorGroupType: palette.type, price: 0 };
  const counter = { type: 'counter-1m', dimensions: {} };
  const variants = { type: 'counter-group', is_active: true, dimensions: { isVariantGroup: true, packs: ['Équipé'], variantAssetTypes: [counter.type], configOptions: [option] } };
  const assets = [counter, variants, palette];
  const colors = context.counterColorOptionsForItem(counter, assets, 'Équipé', []);
  assert.deepEqual(ids(colors), ['white', 'wood', 'red', 'gray', 'blue']);
  assert.ok(colors.every((color) => color.price === 0 && color.configOptionId === option.id));
  const finishes = context.counterFinishOptions(colors);
  assert.deepEqual(ids(finishes), ids(colors));
  assert.equal(finishes[1].mode, 'color', 'A configured wood texture must be applied, not replaced by the native wood');
  assert.equal(finishes[1].image, '/wood.jpg');
  assert.equal(context.selectedColorChoiceForConfigOption(option, assets, 'Équipé', { id: `${palette.type}:blue` }).id, 'blue');
  const inactive = { ...palette, is_active: false };
  assert.equal(context.counterColorOptionsForItem(counter, [counter, variants, inactive], 'Équipé').length, 0);
  const fallback = [{ id: 'legacy' }];
  assert.equal(context.counterColorOptionsForItem(counter, [counter], 'Équipé', fallback), fallback);
  assert.equal(context.colorOptionsForUsage(assets, 'Équipé', 'counter', []).length, 0, 'Global pack palettes remain pack-filtered');
});

test('Imported colors without IDs acquire stable identities before being reordered', () => {
  const context = colorContext();
  const imported = { dimensions: { colorOptions: [{ name: 'Red' }, { name: 'Blue' }, { name: 'Gray' }] } };
  const normalized = context.normalizeColorGroupOptions(imported);
  const moved = context.moveArrayItem(normalized, 2, 0);
  const saved = context.normalizeColorGroupOptions({ dimensions: { colorOptions: moved } });
  assert.deepEqual(ids(saved), [normalized[2].id, normalized[0].id, normalized[1].id]);
});

test('All attached pack palettes and grouped swatches retain the saved order', () => {
  const context = colorContext();
  const saved = { ...group, dimensions: { ...group.dimensions, colorOptions: context.moveArrayItem(group.dimensions.colorOptions, 2, 0) } };
  for (const pack of ['Signature', 'Confort']) {
    for (const usage of ['carpet', 'footprint', 'wallFabric', 'counter']) {
      const palette = context.packColorPalette([saved], pack, usage, []);
      assert.deepEqual(ids(palette), ['color-group-test:blue', 'color-group-test:red', 'color-group-test:gray']);
      assert.deepEqual(ids(context.colorGroupsFromOptions(palette)[0].colors), ids(palette));
      assert.deepEqual(ids(palette.filter((color) => color.included)), ['color-group-test:blue', 'color-group-test:gray']);
      assert.equal(palette[2].isDefault, true);
    }
  }
});

test('Variant color options no longer promote default colors ahead of the group order', () => {
  const context = colorContext();
  const option = { colorGroupType: group.type, defaultColorId: 'gray', includedColorIds: ['gray', 'blue'] };
  const choices = context.colorChoicesForConfigOption(option, [group], 'Signature');
  assert.deepEqual(ids(choices), ['red', 'gray', 'blue']);
  assert.deepEqual(Array.from(choices, (color) => color.displayOrder), [0, 1, 2]);
  assert.equal(choices[0].price, 12);
  assert.equal(choices[1].price, 0);
  assert.equal(context.defaultColorChoiceForConfigOption(option, [group], 'Signature').id, 'gray');
  assert.equal(context.selectedColorChoiceForConfigOption(option, [group], 'Signature', { id: 'red' }).id, 'red');
  assert.deepEqual(ids(context.counterFinishOptions(choices)), ids(choices));
});

test('Direct counter color groups keep their own wood/color order without changing legacy fallback finishes', () => {
  const context = colorContext();
  const colors = [{ id: 'red', name: 'Rouge', groupId: group.type }, { id: 'wood', name: 'Bois', groupId: group.type }, { id: 'blue', name: 'Bleu', groupId: group.type }];
  assert.deepEqual(ids(context.counterFinishOptions(colors)), ['red', 'wood', 'blue', '__counter-white__']);
  assert.deepEqual(ids(context.counterFinishOptions(colors.map(({ groupId, ...color }) => color))), ['wood', '__counter-white__', 'red', 'blue']);
});

test('Saving and reloading a color group round-trips the reordered array through the existing store', async () => {
  const context = colorContext();
  const draft = { ...group, dimensions: { ...group.dimensions, colorOptions: context.moveArrayItem(group.dimensions.colorOptions, 2, 0) } };
  let savedDraft;
  Object.assign(context, {
    draft, isColorGroup: true, assignedPacks: group.dimensions.packs, draftConfigOptions: [],
    onSave: (value) => { savedDraft = value; },
  });
  const start = source.indexOf('  const saveDraft = () => {');
  const end = source.indexOf('    if (isVariantGroup)', start);
  vm.runInContext(`${source.slice(start, end)}\n}; saveDraft();`, context);
  let record;
  context.supabase = {
    from(table) {
      assert.equal(table, 'object_bank');
      return { upsert(payload) { record = JSON.parse(JSON.stringify(payload)); return { select() { return { single: async () => ({ data: record, error: null }) }; } }; } };
    },
  };
  const storeStart = storeSource.indexOf('export async function saveObjectBankItem(');
  const storeEnd = storeSource.indexOf('\n}\n', storeStart) + 2;
  vm.runInContext(storeSource.slice(storeStart, storeEnd).replace('export ', ''), context);
  const saved = await context.saveObjectBankItem(savedDraft);
  assert.deepEqual(ids(context.normalizeColorGroupOptions(saved)), ['blue', 'red', 'gray']);
  assert.equal(saved.dimensions.colorOptions[2].isDefault, true);
  assert.equal(saved.dimensions.colorOptions[1].image, '/red.jpg');
});
