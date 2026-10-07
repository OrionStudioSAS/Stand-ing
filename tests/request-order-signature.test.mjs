import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { packAllowanceLineType, scenePackBenefits, withPackAllowance } from '../supabase/functions/_shared/packBenefits.js';
import { manualOrderRowsToPricingLines } from '../src/manualOrderLines.js';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function loadFunction(context, name) {
  let start = appSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (appSource.slice(start - 6, start) === 'async ') start -= 6;
  vm.runInContext(appSource.slice(start, appSource.indexOf('\n}\n', start) + 2), context);
}

test('SMCL partition heads show aisle before stand number without duplicating an existing prefix', () => {
  const api = vm.createContext({});
  loadFunction(api, 'smclStandCode');
  assert.equal(api.smclStandCode('12', 'C'), 'C12');
  assert.equal(api.smclStandCode('12C', 'C'), 'C12');
  assert.equal(api.smclStandCode('C12', 'C'), 'C12');
  assert.equal(api.smclStandCode('25', 'A'), 'A25');
});

test('Signature wall-cover allowance follows its area bands; SMCL Confort and Prestige stay unchanged', () => {
  const api = vm.createContext({
    scenePackBenefits,
    isSignatureScene: (scene) => scene.offer === 'Signature',
    normalizeTextValue: (value) => String(value).toLowerCase(),
  });
  loadFunction(api, 'wallCoverIncludedLinearMeters');
  for (const [area, expected] of [[8, 0], [9, 2], [14, 2], [15, 3], [23, 3], [24, 3.5], [35, 3.5], [36, 4], [50, 4]]) {
    assert.equal(api.wallCoverIncludedLinearMeters({ offer: 'Signature', dimensions: { width: area, depth: 1 } }), expected);
  }
  assert.equal(api.wallCoverIncludedLinearMeters({ offer: 'Confort', salon: 'SMCL 2026' }), 2);
  assert.equal(api.wallCoverIncludedLinearMeters({ offer: 'Prestige', salon: 'SMCL 2026' }), 4);
});

test('manual admin lines are distinct BDC rows and Signature discount is recalculated after them', () => {
  const api = vm.createContext({
    manualOrderRowsToPricingLines,
    roundCurrency: (value) => Math.round(Number(value) * 100) / 100,
    packAllowanceLineType,
    findCatalogEntry: () => null,
    assetReference: () => '',
    uniqueTextValues: (values) => values,
    purchaseOrderBaseLabel: (value) => value,
    purchaseOrderDisplayLabel: (value) => value,
  });
  for (const name of ['manualPurchaseOrderLines', 'normalizePurchaseOrderLines', 'hasAmcoOrderLines', 'purchaseOrderTemplateRows']) loadFunction(api, name);
  const scene = { source_payload: { manualPurchaseOrderLines: [
    { id: 'one', label: 'Chaise supplémentaire', reference: 'CH-1', quantity: 2, unitPrice: 75 },
    { id: 'two', label: 'Table supplémentaire', quantity: 1, unitPrice: 120 },
  ] } };
  const manual = api.manualPurchaseOrderLines(scene);
  const lines = api.normalizePurchaseOrderLines(withPackAllowance([
    { type: 'desk', label: 'Comptoir', quantity: 1, unitPrice: 900, total: 900 }, ...manual,
  ], { mode: 'allowance', allowanceAmount: 1000 }));
  assert.equal(lines.filter((line) => line.type.startsWith('admin-manual-')).length, 2);
  assert.equal(lines.find((line) => line.type === packAllowanceLineType).total, -1000);
  assert.equal(lines.reduce((sum, line) => sum + line.total, 0), 170);
  assert.equal(api.hasAmcoOrderLines({ lines }), true);
  assert.equal(api.hasAmcoOrderLines({ lines: [] }), false);
  assert.equal(api.hasAmcoOrderLines({ lines: [{ type: packAllowanceLineType, quantity: 1, total: -1000 }] }), false);
  assert.equal(api.hasAmcoOrderLines({ lines: [{ type: 'mandatory-furniture-insurance', quantity: 1, total: 20 }] }), false);
  assert.equal(api.hasAmcoOrderLines({ lines: [{ type: 'other', quantity: 1, total: 20, mandatory: true }] }), false);
  assert.equal(api.purchaseOrderTemplateRows(Array.from({ length: 17 }, (_, index) => ({ label: String(index), total: 10 }))).length, 15);
});

test('admin request action opens a mail draft addressed to the exhibitor', () => {
  const api = vm.createContext({ encodeURIComponent });
  loadFunction(api, 'requestReplyMailto');
  const url = api.requestReplyMailto({ client_email: 'client@example.com', project_name: 'Stand 12' });
  assert.match(url, /^mailto:client@example\.com\?subject=/);
  assert.match(decodeURIComponent(url), /Votre demande pour Stand 12/);
});

test('the generated BDC contains each manual line and the recalculated Signature reduction', async () => {
  const template = readFileSync(new URL('../public/templates/bon-commande-template.pdf', import.meta.url));
  const api = vm.createContext({
    PDFDocument, StandardFonts, rgb, Blob, Uint8Array, console, packAllowanceLineType,
    roundCurrency: (value) => Math.round(Number(value) * 100) / 100,
    uniqueTextValues: (values) => [...new Set(values)],
    fetch: async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from(template).buffer }),
  });
  for (const name of ['fillPurchaseOrderTemplate', 'purchaseOrderTemplateRows', 'purchaseOrderTemplateFieldMap', 'drawPurchaseOrderHeaderLine', 'setPdfFieldAny', 'moneyPdf', 'toPdfWinAnsi', 'truncatePdfText']) loadFunction(api, name);
  const lines = withPackAllowance([
    { type: 'desk', label: 'Comptoir accueil', quantity: 1, unitPrice: 900, total: 900 },
    { type: 'admin-manual-one', label: 'Chaise supplémentaire', quantity: 2, unitPrice: 75, total: 150 },
    { type: 'admin-manual-two', label: 'Table supplémentaire', quantity: 1, unitPrice: 120, total: 120 },
  ], { mode: 'allowance', allowanceAmount: 1000 });
  const blob = await api.fillPurchaseOrderTemplate({ lines, total: 170 });
  const pdf = await PDFDocument.load(await blob.arrayBuffer());
  const form = pdf.getForm();
  const fields = api.purchaseOrderTemplateFieldMap(form);
  assert.match(form.getTextField(fields.rows[1].description).getText(), /Chaise supplementaire/);
  assert.match(form.getTextField(fields.rows[2].description).getText(), /Table supplementaire/);
  assert.match(form.getTextField(fields.rows[3].description).getText(), /Forfait accessoires/);
  assert.equal(form.getTextField(fields.total).getText(), '170,00 €');
});

test('Signature counter editor is absent from step 2 but remains available in the shop', () => {
  assert.match(appSource, /!isSignatureStand && <OptionAccordion[^\n]+\('comptoir'\)/);
  assert.match(appSource, /<FurnitureStepPanel/);
});
