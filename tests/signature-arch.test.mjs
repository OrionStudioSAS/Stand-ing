import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('Signature scenes expose their dedicated arch controls and hide the generic footprint control', () => {
  assert.match(appSource, /function isSignatureScene\(/);
  assert.match(appSource, /function SignatureArchOptionCard\(/);
  assert.match(appSource, /isSignatureStand \? 'Moquette' : 'Moquette · Empreinte'/);
  assert.match(appSource, /!isSignatureStand && \(\s*<FootprintColorOptionCard/);
  assert.match(appSource, /title="Arche" subtitle="Modèle · Couleur"/);
  assert.match(stylesSource, /\.signature-arch-variants/);
});

test('Signature arch variants replace one another and keep a single scene item', () => {
  assert.match(appSource, /function signatureArchCatalogEntries\(/);
  assert.match(appSource, /Arche Totem|text\.includes\('arche'\).*text\.includes\('totem'\).*text\.includes\('plafond'\)/s);
  assert.match(appSource, /const withoutArches = current\.filter\(\(item\) => !isSignatureArchItem\(item\)\)/);
  assert.match(appSource, /signatureArchVariantType: entry\.type/);
});

test('Signature arch color targets the requested material and its attached carpet strip', () => {
  assert.match(appSource, /Laminate_D02_120cm#1/);
  assert.match(appSource, /signatureArchColorTexture/);
  assert.match(appSource, /function SignatureArchFootprint\(/);
  assert.match(appSource, /Number\(standDepth \|\| 0\) \+ signatureArchFootprintOverflow/);
  assert.match(appSource, /const signatureArchFootprintOverflow = 0\.05/);
  assert.match(appSource, /isSignatureArchItem\(item\) && <SignatureArchFootprint item=\{item\} standDepth=\{depth\}/);
});

test('Signature arch movement stays lateral so the strip keeps touching both stand edges', () => {
  assert.match(appSource, /z: signatureArchCenterZ/);
  assert.match(appSource, /rotation: 0,\s*rotationLocked: true/);
  assert.match(appSource, /isSignatureArchItem\(dragged\)[\s\S]*x: dragCoordinate\(point\.x\), z: signatureArchCenterZ/);
});
