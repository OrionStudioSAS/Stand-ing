import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const section = (name, next) => app.slice(app.indexOf(`function ${name}(`), app.indexOf(`function ${next}(`));
const variantCreator = section('AssetVariantGroupCreator', 'AssetGroupCreator');
const objectCreator = section('AssetGroupCreator', 'MiniGroupPlan');
const editor = section('AssetDrawer', 'AssetConfigOptionRows');

test('group creation uses the shared drawer design and preserves extra controls', () => {
  for (const creator of [variantCreator, objectCreator]) {
    assert.match(creator, /asset-group-design-content/);
    assert.match(creator, /asset-assignment--pills/);
    assert.match(creator, /asset-group-bat-field/);
    assert.match(creator, /className="asset-save"/);
  }
  assert.match(variantCreator, /AssetConfigOptionRows/);
  assert.match(objectCreator, /MiniGroupPlan/);
  assert.match(objectCreator, /asset-group-precise/);
});

test('existing object and variant groups use the same visual language without dropping their editors', () => {
  assert.match(editor, /asset-group-design asset-group-edit/);
  assert.match(editor, /AssetGroupCompositionSummary rows=\{groupRows\}/);
  assert.match(editor, /AssetVariantSourceRows/);
  assert.match(editor, /asset-assignment--pills/);
  assert.match(editor, /MiniGroupPlan/);
  assert.match(editor, /AssetConfigOptionRows/);
});

test('variant default is the first item and group quantities are backed by real rows', () => {
  const sourceRows = section('AssetVariantSourceRows', 'AssetGroupCompositionSummary');
  const composition = section('AssetGroupCompositionSummary', 'VariantColorTemplateCard');
  assert.match(sourceRows, /index === 0 \? <span className="asset-variant-default"/);
  assert.match(sourceRows, /onReorder\?\.\(index, 0\)/);
  assert.match(composition, /rows\.reduce/);
  assert.match(composition, /onAdd\(type\)/);
  assert.match(composition, /onRemove\(type\)/);
  assert.match(css, /\.asset-group-design\.asset-group-edit/);
  assert.match(css, /\.asset-group-design-content/);
});
